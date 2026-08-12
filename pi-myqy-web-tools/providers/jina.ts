// r.jina.ai 网页提取兜底
// ---------------------------------------------------------------
// GET https://r.jina.ai/<url>  → Markdown
// 免费无限额度（限流敏感），不做 quota 管理。

import type {
  ExtractOptions,
  ExtractResponse,
  ProviderConfig,
  SearchOptions,
  SearchProvider,
  SearchResponse,
} from "../types.ts";

const BASE = "https://r.jina.ai/";

export class JinaExtractProvider implements SearchProvider {
  readonly id: string;

  constructor(private cfg: ProviderConfig) {
    this.id = cfg.id;
  }

  // 无搜索能力（仅提取兜底）
  async search(_options: SearchOptions): Promise<SearchResponse> {
    throw new Error("r.jina.ai 不提供搜索能力");
  }

  async extract(options: ExtractOptions): Promise<ExtractResponse> {
    const res = await fetch(`${BASE}${options.url}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/markdown, text/plain",
      },
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`r.jina.ai 提取失败: HTTP ${res.status}`);
    const text = await res.text();
    if (!text) throw new Error("r.jina.ai 提取失败: 无内容");
    // 解析头部（Title / URL Source 等）与正文
    const lines = text.split("\n");
    let title: string | undefined;
    const bodyStart = lines.findIndex(
      (l) => l.startsWith("Markdown Content:") || l.trim() === ""
    );
    for (const l of lines.slice(0, 20)) {
      if (l.startsWith("Title:")) {
        title = l.slice(6).trim();
        break;
      }
    }
    const body =
      bodyStart >= 0
        ? lines.slice(bodyStart + (lines[bodyStart].startsWith("Markdown") ? 1 : 0)).join("\n").trim()
        : text;
    return { provider: this.id, title, content: body };
  }
}
