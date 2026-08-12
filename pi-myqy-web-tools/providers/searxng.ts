// SearXNG 免费搜索兜底（自建/公共实例）
// ---------------------------------------------------------------
// GET {url}/search?q=...&format=json  → JSON
// 无限免费额度（需用户配置实例 URL），不做 quota 管理。

import type {
  ProviderConfig,
  SearchOptions,
  SearchProvider,
  SearchResponse,
} from "../types.ts";

export class SearXNGProvider implements SearchProvider {
  readonly id: string;

  constructor(private cfg: ProviderConfig) {
    this.id = cfg.id;
  }

  private get base(): string {
    if (!this.cfg.url) throw new Error("SearXNG: 未配置实例 URL");
    return this.cfg.url.replace(/\/+$/, "");
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const params = new URLSearchParams({
      q: options.query,
      format: "json",
    });
    const res = await fetch(`${this.base}/search?${params}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`SearXNG 搜索失败: HTTP ${res.status}`);
    const data: any = await res.json();
    const results = Array.isArray(data.results)
      ? data.results.slice(0, options.maxResults ?? 5).map((r: any) => ({
          title: String(r.title ?? ""),
          url: String(r.url ?? ""),
          snippet: String(r.content ?? ""),
        }))
      : [];
    if (results.length === 0) throw new Error("SearXNG 搜索失败: 无结果");
    return { provider: this.id, results };
  }
}
