// Firecrawl 供应商实现
// ---------------------------------------------------------------
// 搜索：POST https://api.firecrawl.dev/v1/search  (Authorization: Bearer)
// 提取：POST https://api.firecrawl.dev/v1/scrape
// 额度：GET  https://api.firecrawl.dev/v2/team/credit-usage → remainingCredits / planCredits

import type {
  ExtractOptions,
  ExtractResponse,
  ProviderConfig,
  QuotaInfo,
  SearchOptions,
  SearchProvider,
  SearchResponse,
} from "../types.ts";

const BASE = "https://api.firecrawl.dev";

export class FirecrawlProvider implements SearchProvider {
  readonly id: string;

  constructor(private cfg: ProviderConfig) {
    this.id = cfg.id;
  }

  private get key(): string {
    if (!this.cfg.apiKey) throw new Error("Firecrawl: 缺少 apiKey 配置");
    return this.cfg.apiKey;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
    };
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const res = await fetch(`${BASE}/v1/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        query: options.query,
        limit: options.maxResults ?? 5,
        // slim result: only title/url/description
      }),
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`Firecrawl 搜索失败: HTTP ${res.status} ${await safeText(res)}`);
    const data: any = await res.json();
    const results = Array.isArray(data.data)
      ? data.data.map((r: any) => ({
          title: String(r.title ?? ""),
          url: String(r.url ?? ""),
          snippet: String(r.description ?? ""),
        }))
      : [];
    return { provider: this.id, results };
  }

  async extract(options: ExtractOptions): Promise<ExtractResponse> {
    const res = await fetch(`${BASE}/v1/scrape`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ url: options.url, formats: ["markdown"] }),
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`Firecrawl 提取失败: HTTP ${res.status} ${await safeText(res)}`);
    const data: any = await res.json();
    const md = data.data?.markdown ?? data.data?.content ?? "";
    if (!md || !data.success) throw new Error("Firecrawl 提取失败: 页面无内容");
    return {
      provider: this.id,
      title: data.data?.metadata?.title !== undefined ? String(data.data.metadata.title) : undefined,
      content: String(md),
    };
  }

  async getQuota(): Promise<QuotaInfo> {
    const res = await fetch(`${BASE}/v2/team/credit-usage`, {
      headers: { Authorization: `Bearer ${this.key}` },
    });
    if (!res.ok) throw new Error(`Firecrawl 额度查询失败: HTTP ${res.status}`);
    const data: any = await res.json();
    const d = data.data ?? {};
    const remaining = d.remainingCredits;
    const plan = d.planCredits;
    return {
      provider: this.id,
      total: plan !== undefined ? Number(plan) : undefined,
      used: remaining !== undefined && plan !== undefined ? Math.max(0, Number(plan) - Number(remaining)) : 0,
      remaining: remaining !== undefined ? Number(remaining) : undefined,
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