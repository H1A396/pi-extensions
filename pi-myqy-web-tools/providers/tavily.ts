// Tavily 供应商实现
// ---------------------------------------------------------------
// 搜索：POST https://api.tavily.com/search  (Bearer api_key 或 body api_key)
// 提取：POST https://api.tavily.com/extract
// 额度：GET  https://api.tavily.com/usage    → plan_limit / plan_usage（真实额度）

import type {
  ExtractOptions,
  ExtractResponse,
  ProviderConfig,
  QuotaInfo,
  SearchOptions,
  SearchProvider,
  SearchResponse,
} from "../types.ts";

const BASE = "https://api.tavily.com";

export class TavilyProvider implements SearchProvider {
  readonly id: string;

  constructor(private cfg: ProviderConfig) {
    this.id = cfg.id;
  }

  private get key(): string {
    if (!this.cfg.apiKey) throw new Error("Tavily: 缺少 apiKey 配置");
    return this.cfg.apiKey;
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.key,
        query: options.query,
        max_results: options.maxResults ?? 5,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`Tavily 搜索失败: HTTP ${res.status} ${await safeText(res)}`);
    const data: any = await res.json();
    const results = Array.isArray(data.results)
      ? data.results.map((r: any) => ({
          title: String(r.title ?? ""),
          url: String(r.url ?? ""),
          snippet: String(r.content ?? ""),
        }))
      : [];
    return { provider: this.id, results };
  }

  async extract(options: ExtractOptions): Promise<ExtractResponse> {
    const res = await fetch(`${BASE}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.key, urls: [options.url] }),
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`Tavily 提取失败: HTTP ${res.status} ${await safeText(res)}`);
    const data: any = await res.json();
    const page = Array.isArray(data.results) ? data.results[0] : data.results;
    if (!page) throw new Error("Tavily 提取失败: 无结果");
    return {
      provider: this.id,
      title: page.title !== undefined ? String(page.title) : undefined,
      content: String(page.raw_content ?? page.content ?? ""),
    };
  }

  async getQuota(): Promise<QuotaInfo> {
    const res = await fetch(`${BASE}/usage`, {
      headers: { Authorization: `Bearer ${this.key}` },
    });
    if (!res.ok) throw new Error(`Tavily 额度查询失败: HTTP ${res.status}`);
    const data: any = await res.json();
    const acct = data.account ?? {};
    const limit = acct.plan_limit;
    const used = acct.plan_usage ?? acct.search_usage ?? 0;
    return {
      provider: this.id,
      total: limit !== null && limit !== undefined ? Number(limit) : undefined,
      used: Number(used) ?? 0,
      remaining: limit !== null && limit !== undefined ? Number(limit) - Number(used) : undefined,
      unit: "credits",
      updatedAt: Date.now(),
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}