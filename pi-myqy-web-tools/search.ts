// pi-myqy-web-tools 搜索路由器
// ---------------------------------------------------------------
// 按配置 order 依次尝试各供应商：
// 1. 跳过 disabled / 未启用 / 已耗尽
// 2. 调用前刷新额度（TTL 内走缓存）
// 3. 成功 → 记录消耗并返回（附实际使用的 provider）
// 4. 失败 / 额度耗尽 → 标记并自动切换下一个
// 全部失败 → 抛错（由上层决定是否兜底）

import type {
  ProviderConfig,
  SearchOptions,
  SearchProvider,
  SearchResponse,
  WebToolsConfig,
} from "./types.ts";
import { QuotaManager } from "./quota.ts";

export class SearchRouter {
  private providers = new Map<string, SearchProvider>();
  private configs = new Map<string, ProviderConfig>();

  constructor(
    private quota: QuotaManager,
    private config: WebToolsConfig,
  ) {}

  register(provider: SearchProvider, config: ProviderConfig): void {
    this.providers.set(provider.id, provider);
    this.configs.set(config.id, config);
  }

  /** 获取搜索候选供应商：优先显式策略 search.order，否则按 order 升序 */
  private orderedSearchProviders(): ProviderConfig[] {
    const cfg = this.config.search;
    if (cfg?.order && cfg.order.length > 0) {
      const byId = new Map(this.config.searchProviders.map((p) => [p.id, p]));
      const out: ProviderConfig[] = [];
      for (const id of cfg.order) {
        const p = byId.get(id);
        if (p && p.enabled && p.supports.includes("search")) out.push(p);
      }
      return out;
    }
    return this.config.searchProviders
      .filter((p) => p.enabled && p.supports.includes("search"))
      .sort((a, b) => a.order - b.order);
  }

  /**
   * 执行搜索：按优先级尝试所有供应商，返回首个成功的结果。
   * 返回附带 provider 标识，供上层展示来源。
   */
  async search(options: SearchOptions): Promise<SearchResponse> {
    const candidates = this.orderedSearchProviders();
    if (candidates.length === 0) throw new Error("未配置任何可用的搜索供应商");

    let lastError: Error | undefined;
    for (const cfg of candidates) {
      const provider = this.providers.get(cfg.id);
      if (!provider) continue;
      // 已标记耗尽 → 跳过
      if (this.quota.isExhausted(cfg.id)) continue;

      // 尝试刷新额度（TTL 缓存）
      await this.quota.refreshQuota(cfg.id).catch(() => {});
      if (this.quota.isExhausted(cfg.id)) continue;

      try {
        const resp = await provider.search(options);
        // 记录消耗（Exa 的 costUsd；其他无计费信息时保守扣 1）
        await this.quota.recordUsage(cfg.id, resp.costUsd).catch(() => {});
        return resp;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // 配额类错误 → 标记耗尽后切换
        if (isQuotaError(lastError.message)) {
          await this.quota.markExhausted(cfg.id).catch(() => {});
        }
        // 其他错误：继续尝试下一个
      }
    }
    throw lastError ?? new Error("所有搜索供应商均失败");
  }
}

/** 识别配额/权限类错误信息（各家 API 的典型报错） */
export function isQuotaError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("quota") ||
    m.includes("credit") ||
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("no_more_credits") ||
    m.includes("insufficient") ||
    m.includes("billing") ||
    m.includes("403")
  );
}
