// DuckDuckGo 免费搜索兜底
// ---------------------------------------------------------------
// GET https://html.duckduckgo.com/html/?q=...  → HTML 解析
// 无限免费额度，不做 quota 管理。

import type {
  ProviderConfig,
  SearchOptions,
  SearchProvider,
  SearchResponse,
} from "../types.ts";

const BASE = "https://html.duckduckgo.com/html/";

export class DuckDuckGoProvider implements SearchProvider {
  readonly id: string;

  constructor(private cfg: ProviderConfig) {
    this.id = cfg.id;
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: options.query });
    const res = await fetch(`${BASE}?${params}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`DuckDuckGo 搜索失败: HTTP ${res.status}`);
    const html = await res.text();
    const results = parseDdgHtml(html).slice(0, options.maxResults ?? 5);
    if (results.length === 0) throw new Error("DuckDuckGo 搜索失败: 无结果（可能被限流）");
    return { provider: this.id, results };
  }
}

/** 解析 DDG HTML 结果（.result 块：a.result__a + a.result__snippet） */
function parseDdgHtml(html: string): SearchResponse["results"] {
  const out: SearchResponse["results"] = [];
  const blockRe = /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/g;
  let m: RegExpExecArray | null;
  const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/;
  blockRe.lastIndex = 0;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[0];
    const t = titleRe.exec(block);
    const s = snipRe.exec(block);
    if (!t) continue;
    const title = stripTags(t[2]);
    const url = decodeDdgUrl(t[1]);
    const snippet = s ? stripTags(s[1]) : "";
    if (url && title) out.push({ title, url, snippet });
    if (out.length >= 20) break;
  }
  return out;
}

function decodeDdgUrl(href: string): string {
  try {
    const u = new URL(href);
    const target = u.searchParams.get("uddg");
    if (target) return target;
    return href;
  } catch {
    return href;
  }
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
