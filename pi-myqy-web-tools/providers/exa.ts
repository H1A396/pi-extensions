// Exa 供应商实现
// ---------------------------------------------------------------
// 搜索：POST https://api.exa.ai/search  (x-api-key 头)
// 提取：POST https://api.exa.ai/contents
// 额度：无服务端可访问接口（dashboard 被安全验证拦截）
//       → 本地累计：搜索响应返回 costDollars.total（美元），从配置余额扣减

import type {
  ExtractOptions,
  ExtractResponse,
  ProviderConfig,
  SearchOptions,
  SearchProvider,
  SearchResponse,
} from "../types.ts";

const BASE = "https://api.exa.ai";

export class ExaProvider implements SearchProvider {
  readonly id: string;

  constructor(private cfg: ProviderConfig) {
    this.id = cfg.id;
  }

  private headers() {
    if (!this.cfg.apiKey) throw new Error("Exa: 缺少 apiKey 配置");
    return {
      "x-api-key": this.cfg.apiKey,
      "Content-Type": "application/json",
    };
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        query: options.query,
        numResults: options.maxResults ?? 5,
        type: "auto",
      }),
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`Exa 搜索失败: HTTP ${res.status} ${await safeText(res)}`);
    const data: any = await res.json();
    const results = Array.isArray(data.results)
      ? data.results.map((r: any) => ({
          title: String(r.title ?? ""),
          url: String(r.url ?? ""),
          snippet: String(r.text ?? r.publishedDate ?? ""),
        }))
      : [];
    const costUsd = typeof data.costDollars?.total === "number" ? data.costDollars.total : undefined;
    return { provider: this.id, results, costUsd };
  }

  async extract(options: ExtractOptions): Promise<ExtractResponse> {
    const res = await fetch(`${BASE}/contents`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ids: [options.url],
        text: { maxCharacters: 50000 },
      }),
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`Exa 提取失败: HTTP ${res.status} ${await safeText(res)}`);
    const data: any = await res.json();
    const item = Array.isArray(data.results) ? data.results[0] : data.results;
    if (!item) throw new Error("Exa 提取失败: 无结果");
    const content = String(item.text ?? item.content ?? "");
    if (!content) throw new Error("Exa 提取失败: 页面无文本内容");
    return {
      provider: this.id,
      title: item.title !== undefined ? String(item.title) : undefined,
      content,
      // 提取同样计费（实测 contents 响应带 costDollars.total，如 $0.001/页）
      costUsd: typeof data.costDollars?.total === "number" ? data.costDollars.total : undefined,
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