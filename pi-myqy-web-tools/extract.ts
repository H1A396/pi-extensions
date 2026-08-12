// pi-myqy-web-tools 提取路由器
// ---------------------------------------------------------------
// 策略 provider-first：
// 1. 按 extract.providers 配置顺序，尝试供应商自带的提取能力
// 2. 全部失败 → 依次尝试 fallbacks 兜底方案（如 r.jina.ai）
// 3. 仍失败 → 抛错

import type {
  ExtractOptions,
  ExtractResponse,
  ProviderConfig,
  SearchProvider,
  WebToolsConfig,
} from "./types.ts";
import { QuotaManager } from "./quota.ts";
import { isQuotaError } from "./search.ts";

export class ExtractRouter {
  private providers = new Map<string, SearchProvider>();

  constructor(
    private quota: QuotaManager,
    private config: WebToolsConfig,
  ) {}

  register(provider: SearchProvider, config: ProviderConfig): void {
    this.providers.set(provider.id, provider);
  }

  /** 依次尝试提取，返回首个成功结果 */
  async extract(options: ExtractOptions): Promise<ExtractResponse> {
    const chain = this.buildChain();
    let lastError: Error | undefined;

    for (const id of chain) {
      const provider = this.providers.get(id);
      if (!provider?.extract) continue;
      if (this.quota.isExhausted(id)) continue;

      try {
        const resp = await provider.extract(options);
        // 传递消耗金额（Exa 的 costDollars；免费供应商内部会跳过）
        await this.quota.recordUsage(id, resp.costUsd).catch(() => {});
        return resp;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (isQuotaError(lastError.message)) {
          await this.quota.markExhausted(id).catch(() => {});
        }
        // 失败 → 尝试下一个
      }
    }
    throw lastError ?? new Error("所有提取方案均失败");
  }

  /** 组装提取链路：优先显式策略 extract.order，否则供应商自带 → fallbacks */
  private buildChain(): string[] {
    const cfg = this.config.extract;
    const chain: string[] = [];

    if (cfg.order && cfg.order.length > 0) {
      // 显式策略：只使用列出的供应商，严格按数组顺序
      for (const id of cfg.order) {
        const p = this.providers.get(id);
        if (!p?.extract || chain.includes(id)) continue;
        // 在 searchProviders 中的需 enabled；r.jina.ai 这类兜底不在列表中直接放行
        const pc = this.config.searchProviders.find((x) => x.id === id);
        if (!pc || pc.enabled) chain.push(id);
      }
      return chain;
    }

    // 回退：配置顺序的供应商（须存在且有 extract 能力）
    for (const id of cfg.providers) {
      const p = this.providers.get(id);
      const pc = this.config.searchProviders.find((x) => x.id === id);
      if (p?.extract && pc?.enabled && !chain.includes(id)) chain.push(id);
    }
    // fallbacks（如 r.jina.ai）
    for (const id of cfg.fallbacks) {
      const p = this.providers.get(id);
      if (p?.extract && !chain.includes(id)) chain.push(id);
    }
    return chain;
  }
}
