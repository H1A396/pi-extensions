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

/** 本地日期键 YYYY-MM-DD（用于按天用量统计） */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

  /**
   * 校准日（含）之后的按天消耗合计（余额型供应商）。
   * 即：自最近一次校准时刻起，本扩展记录的总消耗。
   * 校准日当天只统计校准时刻之后的消耗（校准前的已包含在校准余额中）。
   */
  private usedSinceCalibration(s: ProviderQuotaState): number {
    if (s.calibratedAt === undefined) return 0;
    const calDay = localDateKey(new Date(s.calibratedAt));
    const baseline = s.calibratedDayUsed ?? 0;
    let sum = 0;
    const daily = s.dailyUsage ?? {};
    for (const [day, v] of Object.entries(daily)) {
      if (day > calDay) sum += v ?? 0;
      else if (day === calDay) sum += Math.max(0, (v ?? 0) - baseline);
    }
    return Math.round(sum * 10000) / 10000;
  }

  /** 供应商是否余额型（Exa，用美元计费） */
  isBalanceBased(id: string): boolean {
    return this.configs.get(id)?.id === "exa";
  }

  /** 获取某供应商的本地额度状态 */
  getState(id: string): ProviderQuotaState {
    return this.state.providers[id] ?? {};
  }

  // ---------- 免费额度模型 ----------

  /**
   * 计算某供应商累计可用的免费额度总量。
   * - 服务端型（Tavily/Firecrawl）：serverQuota.total（官方每月免费额度）
   * - 余额型（Exa）：初始 $20 + 每月 $10 × 已过月数（自账号创建/首次使用起）
   * - 未知：undefined（不参与百分比预警）
   */
  private freeTotal(id: string, s: ProviderQuotaState): number | undefined {
    if (s.serverQuota?.total !== undefined) return s.serverQuota.total;
    if (this.isBalanceBased(id)) {
      // 余额型：免费总额始终按「初始 $20 + 每月 $10 × 已过月数」模型估算显示
      // （校准余额仅作为剩余基准，不改变免费总额展示）
      return this.exaFreeTotal(s);
    }
    return undefined;
  }

  /** Exa 累计免费额度 = 初始 + 每月补充 × 月数 */
  private exaFreeTotal(s: ProviderQuotaState): number | undefined {
    const { exaInitialFreeUsd, exaMonthlyTopUpUsd } = this.quotaCfg;
    const baseline = s.baselineAt;
    if (baseline === undefined) return exaInitialFreeUsd;
    const months = Math.floor((Date.now() - baseline) / (30 * 24 * 3600 * 1000));
    return exaInitialFreeUsd + Math.max(0, months) * exaMonthlyTopUpUsd;
  }

  /** 有效剩余免费额度：优先服务端快照，其次本地估算/校准基准 */
  private effectiveRemaining(id: string, s: ProviderQuotaState): number | undefined {
    if (s.serverQuota?.remaining !== undefined) return s.serverQuota.remaining;
    if (this.isBalanceBased(id)) {
      // 已校准：余额 = 校准余额 − 校准日（含）起的按天消耗
      if (s.calibratedRemaining !== undefined && s.calibratedAt !== undefined) {
        const used = this.usedSinceCalibration(s);
        return Math.max(0, Math.round((s.calibratedRemaining - used) * 10000) / 10000);
      }
      const total = this.exaFreeTotal(s);
      return total !== undefined ? Math.max(0, total - (s.spent ?? 0)) : undefined;
    }
    return s.remaining;
  }

  /** 剩余占比（0-1）；总额未知 → undefined */
  private remainingRatio(id: string, s: ProviderQuotaState): number | undefined {
    const total = this.freeTotal(id, s);
    const rem = this.effectiveRemaining(id, s);
    if (total === undefined || rem === undefined || total <= 0) return undefined;
    return rem / total;
  }

  /** 该供应商当前是否被认为耗尽（剩余 ≤ 免费总额 × exhaustedPercent%） */
  isExhausted(id: string): boolean {
    const s = this.state.providers[id];
    if (!s) return false;
    if (s.exhausted) return true;
    const ratio = this.remainingRatio(id, s);
    if (ratio === undefined) return false; // 未知额度 → 不拦截
    return ratio <= this.quotaCfg.exhaustedThresholdPercent / 100;
  }

  /** 是否低配额（用于排序后移/预警） */
  isLow(id: string): boolean {
    const s = this.state.providers[id];
    if (!s) return false;
    const ratio = this.remainingRatio(id, s);
    if (ratio === undefined) return false;
    const exPercent = this.quotaCfg.exhaustedThresholdPercent / 100;
    return ratio > exPercent && ratio <= this.quotaCfg.lowThresholdPercent / 100;
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
      const ratio =
        quota.remaining !== undefined && quota.total !== undefined && quota.total > 0
          ? quota.remaining / quota.total
          : undefined;
      const exhaustedNow =
        ratio !== undefined && ratio <= this.quotaCfg.exhaustedThresholdPercent / 100;
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
      const ratio =
        quota.remaining !== undefined && quota.total !== undefined && quota.total > 0
          ? quota.remaining / quota.total
          : undefined;
      const exhaustedNow =
        ratio !== undefined && ratio <= this.quotaCfg.exhaustedThresholdPercent / 100;
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
   * - 余额型供应商（Exa）：按精确 costUsd 扣减；**无 costUsd 时不扣**
   *   （Exa 单次搜索仅 ~$0.01，若误记 1 美元会把免费额度快速"耗尽"）
   * - 其他（按次计费）：保守扣 1 单位
   */
  async recordUsage(id: string, costUsd?: number): Promise<void> {
    if (this.isFree(id)) return;
    const s = this.state.providers[id] ?? {};
    if (s.serverQuota?.remaining !== undefined) {
      // 服务端额度：本地仅记录调用次数，不主动扣减
      return;
    }
    // Exa 首次使用时记录计费基准（账号创建时间或首次使用）
    let next = s;
    if (this.isBalanceBased(id) && s.baselineAt === undefined) {
      const created = this.quotaCfg.exaAccountCreatedAt
        ? Date.parse(this.quotaCfg.exaAccountCreatedAt)
        : undefined;
      const baselineAt = created && !Number.isNaN(created) ? created : Date.now();
      next = { ...s, baselineAt };
      this.state.providers[id] = next;
    }
    // 余额型无 costUsd → 增量为 0（宁可漏记，也不误扣大额）；其余无计费信息 → 保守 1 单位
    const increment = this.isBalanceBased(id) ? (costUsd ?? 0) : (costUsd ?? 1);
    // 美元消耗保留 4 位小数，避免浮点误差污染 state 文件
    const spent = Math.round(((next.spent ?? 0) + increment) * 10000) / 10000;
    // 余额型：按天累加消耗历史（持久化，供每日用量报表）
    let dailyUsage = next.dailyUsage ?? {};
    if (this.isBalanceBased(id) && increment > 0) {
      const today = localDateKey();
      dailyUsage = {
        ...dailyUsage,
        [today]: Math.round(((dailyUsage[today] ?? 0) + increment) * 10000) / 10000,
      };
    }
    const remaining =
      this.isBalanceBased(id) && costUsd !== undefined
        ? undefined // Exa 剩余由 effectiveRemaining 动态计算（校准余额/免费总额 - 累计消耗）
        : next.remaining !== undefined
          ? Math.max(0, next.remaining - 1)
          : undefined;
    this.state.providers[id] = { ...next, spent, dailyUsage, remaining };
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

  /**
   * 手动校准本地剩余额度（写入内存 + 磁盘，立即生效）。
   * 用于：余额型供应商（Exa）无服务端接口，以官方 dashboard 读数为准时校准；
   * 或本地估算与真实余额出现偏差（如存在不经本扩展的调用）时修正。
   * @param id 供应商 id
   * @param remaining 权威剩余额度（从 dashboard / 服务商控制台读取）
   */
  async calibrate(id: string, remaining: number): Promise<void> {
    const s = this.state.providers[id] ?? {};
    if (this.isFree(id)) return; // 免费无限供应商无需校准
    const now = Date.now();
    if (this.isBalanceBased(id)) {
      // 余额型（Exa）：以权威余额为基准（calibratedRemaining），
      // 余额从此（校准时刻）起按天扣减；spent 仍换算以便兼容旧展示
      const total = this.exaFreeTotal(s);
      const spent =
        total !== undefined
          ? Math.max(0, Math.round((total - remaining) * 10000) / 10000)
          : s.spent;
      const today = localDateKey(new Date(now));
      this.state.providers[id] = {
        ...s,
        spent,
        calibratedRemaining: remaining,
        calibratedAt: now,
        // 校准时刻当天的消耗快照：该部分已包含在校准余额中，不再重复扣减
        calibratedDayUsed: (s.dailyUsage?.[today] ?? 0),
        exhausted: false,
        exhaustedAt: undefined,
      };
    } else {
      // 服务端型：覆盖本地剩余快照（下次 TTL 刷新会以服务端为准重新校准）
      this.state.providers[id] = {
        ...s,
        remaining,
        calibratedRemaining: remaining,
        calibratedAt: now,
        exhausted: false,
        exhaustedAt: undefined,
      };
    }
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
        // 余额型供应商（Exa）：总额 = 累计免费额度或校准余额，剩余 = 总额 - 消耗
        const total = this.freeTotal(id, s);
        const remaining = this.effectiveRemaining(id, s);
        const ratio = this.remainingRatio(id, s);
        // 已校准余额型：已用 = 校准日（含）起的消耗（与校准余额基准一致）
        const used =
          this.isBalanceBased(id) &&
          s.calibratedRemaining !== undefined &&
          s.calibratedAt !== undefined
            ? this.usedSinceCalibration(s)
            : (s.spent ?? 0);
        out.push({
          provider: id,
          total,
          used,
          remaining,
          unit,
          updatedAt: s.lastCheck ?? 0,
          exhausted: !!s.exhausted || (ratio !== undefined && ratio <= this.quotaCfg.exhaustedThresholdPercent / 100),
        });
      }
    }
    return out;
  }
}