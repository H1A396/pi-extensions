// pi-myqy-web-tools 额度管理器
// ---------------------------------------------------------------
// 统一管理所有供应商的额度：
// - 支持服务端实时查询的（Tavily / Firecrawl）→ 按 TTL 缓存刷新
// - 支持按量计费的（Exa）→ 本地 costDollars 累计
// - 免费无限的（DuckDuckGo / SearXNG / r.jina.ai）→ 不参与管理
// 状态持久化到 ~/.pi/agent/pi-myqy-web-tools-state.json

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  ProviderConfig,
  ProviderQuotaState,
  QuotaInfo,
  QuotaStateFile,
  SearchProvider,
  WebToolsConfig,
} from "./types.ts";

export const STATE_PATH = join(homedir(), ".pi/agent/pi-myqy-web-tools-state.json");

const EMPTY_STATE: QuotaStateFile = { providers: {}, updatedAt: 0 };

async function loadState(): Promise<QuotaStateFile> {
  try {
    const raw = JSON.parse(await readFile(STATE_PATH, "utf8"));
    if (raw && typeof raw === "object" && raw.providers && typeof raw.providers === "object") {
      return { providers: raw.providers, updatedAt: raw.updatedAt ?? 0 };
    }
  } catch {}
  return EMPTY_STATE;
}

async function saveState(state: QuotaStateFile): Promise<void> {
  try {
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch {}
}

export class QuotaManager {
  private providers = new Map<string, SearchProvider>();
  private configs = new Map<string, ProviderConfig>();
  private state: QuotaStateFile = EMPTY_STATE;
  private quotaCfg: WebToolsConfig["quota"];

  constructor(quotaCfg: WebToolsConfig["quota"]) {
    this.quotaCfg = quotaCfg;
  }

  /** 注册供应商实例与配置 */
  register(provider: SearchProvider, config: ProviderConfig): void {
    this.providers.set(provider.id, provider);
    this.configs.set(config.id, config);
  }

  async init(): Promise<void> {
    this.state = await loadState();
  }

  /** 供应商是否免费（不参与额度管理） */
  isFree(id: string): boolean {
    return this.configs.get(id)?.free === true;
  }

  /** 供应商是否余额型（Exa，用美元计费） */
  isBalanceBased(id: string): boolean {
    return this.configs.get(id)?.id === "exa";
  }

  /** 获取某供应商的本地额度状态 */
  getState(id: string): ProviderQuotaState {
    return this.state.providers[id] ?? {};
  }

  /** 有效剩余额度：优先服务端快照，其次本地估算 */
  private effectiveRemaining(id: string, s: ProviderQuotaState): number | undefined {
    if (s.serverQuota?.remaining !== undefined) return s.serverQuota.remaining;
    return s.remaining;
  }

  /** 该供应商当前是否被认为耗尽 */
  isExhausted(id: string): boolean {
    const s = this.state.providers[id];
    if (!s) return false;
    if (s.exhausted) return true;
    const rem = this.effectiveRemaining(id, s);
    if (rem === undefined) return false; // 未知额度 → 不拦截
    return rem <= this.quotaCfg.exhaustedThreshold;
  }

  /** 是否低配额（用于排序后移） */
  isLow(id: string): boolean {
    const s = this.state.providers[id];
    if (!s) return false;
    const rem = this.effectiveRemaining(id, s);
    if (rem === undefined) return false;
    return rem > this.quotaCfg.exhaustedThreshold && rem <= this.quotaCfg.lowThreshold;
  }

  /**
   * 尝试刷新某供应商的服务端额度（有 getQuota 实现的才刷新）。
   * 遵守 TTL 缓存；免费供应商直接跳过。查询失败不阻塞（沿用本地状态）。
   */
  async refreshQuota(id: string): Promise<QuotaInfo | undefined> {
    const provider = this.providers.get(id);
    if (!provider?.getQuota) return undefined;
    if (this.isFree(id)) return undefined;

    const s = this.state.providers[id] ?? {};
    const ttl = this.quotaCfg.refreshTtlSeconds;
    // 缓存命中：未过期、有快照、且未被标记耗尽（耗尽状态必须重新验证）
    if (s.lastCheck && Date.now() - s.lastCheck < ttl * 1000 && s.serverQuota && !s.exhausted) {
      return s.serverQuota;
    }

    try {
      const quota = await provider.getQuota();
      const exhaustedNow =
        quota.remaining !== undefined && quota.remaining <= this.quotaCfg.exhaustedThreshold;
      this.state.providers[id] = {
        ...s,
        serverQuota: quota,
        lastCheck: Date.now(),
        remaining: quota.remaining,
        spent: quota.used,
        // 服务端额度恢复正常 → 自动解除耗尽标记
        exhausted: exhaustedNow ? true : false,
        exhaustedAt: exhaustedNow ? Date.now() : undefined,
      };
      await saveState(this.state);
      return quota;
    } catch {
      return undefined;
    }
  }

  /** 强制刷新某供应商的服务端额度（忽略 TTL 缓存） */
  async refreshQuotaForce(id: string): Promise<QuotaInfo | undefined> {
    const provider = this.providers.get(id);
    if (!provider?.getQuota) return undefined;
    if (this.isFree(id)) return undefined;

    const s = this.state.providers[id] ?? {};
    try {
      const quota = await provider.getQuota();
      const exhaustedNow =
        quota.remaining !== undefined && quota.remaining <= this.quotaCfg.exhaustedThreshold;
      this.state.providers[id] = {
        ...s,
        serverQuota: quota,
        lastCheck: Date.now(),
        remaining: quota.remaining,
        spent: quota.used,
        exhausted: exhaustedNow ? true : false,
        exhaustedAt: exhaustedNow ? Date.now() : undefined,
      };
      await saveState(this.state);
      return quota;
    } catch {
      return undefined;
    }
  }

  /**
   * 记录一次成功调用消耗。
   * - 有服务端快照的供应商：不主动扣减（下次 TTL 刷新自动校准）
   * - 无服务端快照但提供 costUsd（Exa）：本地按美元累计
   * - 其他：保守扣 1 单位
   */
  async recordUsage(id: string, costUsd?: number): Promise<void> {
    if (this.isFree(id)) return;
    const s = this.state.providers[id] ?? {};
    if (s.serverQuota?.remaining !== undefined) {
      // 服务端额度：本地仅记录调用次数，不主动扣减
      return;
    }
    const spent = (s.spent ?? 0) + (costUsd ?? 1);
    let remaining = s.remaining;
    if (costUsd !== undefined) {
      // 余额型（Exa）：剩余 = 初始余额 - 累计消耗
      const balance = this.isBalanceBased(id) ? this.quotaCfg.exaBalanceUsd : undefined;
      remaining = balance !== undefined ? Math.max(0, balance - spent) : undefined;
    } else if (remaining !== undefined) {
      remaining = Math.max(0, remaining - 1);
    }
    this.state.providers[id] = { ...s, spent, remaining };
    await saveState(this.state);
  }

  /** 标记供应商耗尽（服务端报 429 / 403 / 余额不足时调用） */
  async markExhausted(id: string): Promise<void> {
    const s = this.state.providers[id] ?? {};
    this.state.providers[id] = {
      ...s,
      exhausted: true,
      exhaustedAt: Date.now(),
      remaining: 0,
      // 清除缓存时间戳 → 下次 refreshQuota 必然强制重新查询服务端验证
      lastCheck: 0,
    };
    await saveState(this.state);
  }

  /** 清除耗尽标记（用户充值/重置后，或刷新到新额度时）。恢复为服务端快照的真实剩余。 */
  async clearExhausted(id: string): Promise<void> {
    const s = this.state.providers[id] ?? {};
    this.state.providers[id] = {
      ...s,
      exhausted: false,
      exhaustedAt: undefined,
      remaining: s.serverQuota?.remaining ?? s.remaining,
    };
    await saveState(this.state);
  }

  /** 汇总所有已注册供应商的额度视图（供 /web-quota 展示） */
  async snapshot(): Promise<QuotaInfo[]> {
    const out: QuotaInfo[] = [];
    for (const [id, _provider] of this.providers) {
      if (this.isFree(id)) {
        out.push({ provider: id, used: 0, unit: "unlimited", updatedAt: Date.now() });
        continue;
      }
      const quota = await this.refreshQuota(id);
      const s = this.state.providers[id] ?? {};
      if (quota) {
        out.push(quota);
      } else {
        const unit = this.isBalanceBased(id) ? "usd" : "credits";
        // 余额型供应商（Exa）：剩余 = 初始余额 - 累计消耗
        const remaining =
          s.remaining !== undefined
            ? s.remaining
            : this.isBalanceBased(id)
              ? Math.max(0, this.quotaCfg.exaBalanceUsd - (s.spent ?? 0))
              : undefined;
        out.push({
          provider: id,
          total: this.isBalanceBased(id) ? this.quotaCfg.exaBalanceUsd : undefined,
          used: s.spent ?? 0,
          remaining,
          unit,
          updatedAt: s.lastCheck ?? 0,
          exhausted: !!s.exhausted,
        });
      }
    }
    return out;
  }
}