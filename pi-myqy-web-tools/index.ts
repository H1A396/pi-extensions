// pi-myqy-web-tools — 多供应商 Web 搜索与网页提取扩展
// ---------------------------------------------------------------
// 功能：
//  - web_search   工具：多供应商搜索（Tavily / Firecrawl / Exa / DuckDuckGo / SearXNG）
//  - web_extract  工具：网页提取（供应商自带 → r.jina.ai 兜底）
//  - /web-quota   命令：查看各供应商实时/估算额度
//
// 配置：~/.pi/agent/pi-myqy-web-tools.json
// 状态：~/.pi/agent/pi-myqy-web-tools-state.json（额度本地持久化）
//
// 供应商按 order 升序尝试；额度耗尽/失败自动切换下一个；
// DuckDuckGo / SearXNG 为免费无限兜底，保证始终可搜。

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { readConfig } from "./config.ts";
import { QuotaManager } from "./quota.ts";
import { SearchRouter } from "./search.ts";
import { ExtractRouter } from "./extract.ts";
import type { SearchItem, SearchProvider } from "./types.ts";

import { TavilyProvider } from "./providers/tavily.ts";
import { FirecrawlProvider } from "./providers/firecrawl.ts";
import { ExaProvider } from "./providers/exa.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import { SearXNGProvider } from "./providers/searxng.ts";
import { JinaExtractProvider } from "./providers/jina.ts";

export default async function (pi: ExtensionAPI): Promise<void> {
  const config = await readConfig();
  const quota = new QuotaManager(config.quota);
  await quota.init();
  const searchRouter = new SearchRouter(quota, config);
  const extractRouter = new ExtractRouter(quota, config);

  // 注册供应商实例（按配置构建）
  const register = (provider: SearchProvider, id: string) => {
    const cfg = config.searchProviders.find((p) => p.id === id);
    if (!cfg) return;
    quota.register(provider, cfg);
    searchRouter.register(provider, cfg);
    extractRouter.register(provider, cfg);
  };

  for (const cfg of config.searchProviders) {
    switch (cfg.id) {
      case "tavily":
        register(new TavilyProvider(cfg), cfg.id);
        break;
      case "firecrawl":
        register(new FirecrawlProvider(cfg), cfg.id);
        break;
      case "exa":
        register(new ExaProvider(cfg), cfg.id);
        break;
      case "duckduckgo":
        register(new DuckDuckGoProvider(cfg), cfg.id);
        break;
      case "searxng":
        register(new SearXNGProvider(cfg), cfg.id);
        break;
      default:
        break;
    }
  }
  // 提取兜底（r.jina.ai）总是注册（配置在 extract.fallbacks 中启用）
  const jinaCfg = config.searchProviders.find((p) => p.id === "r.jina.ai");
  const jina = new JinaExtractProvider(jinaCfg ?? { id: "r.jina.ai", name: "r.jina.ai", enabled: true, order: 999, supports: ["extract"], free: true });
  quota.register(jina, { id: "r.jina.ai", name: "r.jina.ai", enabled: true, order: 999, supports: ["extract"], free: true });
  extractRouter.register(jina, { id: "r.jina.ai", name: "r.jina.ai", enabled: true, order: 999, supports: ["extract"], free: true });

  // ---------------- web_search 工具 ----------------
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "多供应商网络搜索。自动选择有剩余额度的供应商（Tavily/Firecrawl/Exa/DuckDuckGo/SearXNG），额度耗尽自动切换下一个。返回标题、URL、摘要。",
    promptSnippet: "Search the web using available search providers",
    promptGuidelines: [
      "Use web_search when you need current or factual information from the web.",
      "web_search returns results with title, URL and snippet; if you need full page content, call web_extract on a result URL.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "搜索关键词" }),
      maxResults: Type.Optional(Type.Number({ description: "最大结果数（默认 5）" })),
    }),
    execute: async (toolCallId, params, signal): Promise<AgentToolResult<{ provider: string; results?: SearchItem[]; error?: string } | undefined>> => {
      try {
        const resp = await searchRouter.search({
          query: params.query,
          maxResults: params.maxResults ?? 5,
          signal,
        });
        if (resp.results.length === 0) {
          return {
            content: [{ type: "text", text: `[${resp.provider}] 无搜索结果` }],
            details: { provider: resp.provider, results: [] },
          };
        }
        const lines = resp.results.map((r, i) => {
          const snip = r.snippet ? `\n   ${truncate(r.snippet, 200)}` : "";
          return `${i + 1}. [${r.title}](${r.url})${snip}`;
        });
        const header = `搜索完成（来源: ${resp.provider}，${resp.results.length} 条结果）`;
        return {
          content: [{ type: "text", text: header + "\n" + lines.join("\n") }],
          details: { provider: resp.provider, results: resp.results },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `搜索失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { provider: "none", error: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  });

  // ---------------- web_extract 工具 ----------------
  pi.registerTool({
    name: "web_extract",
    label: "Web Extract",
    description:
      "提取网页内容为 Markdown。优先使用供应商自带的提取能力，失败后回退到 r.jina.ai。",
    promptSnippet: "Extract a web page into readable Markdown",
    promptGuidelines: [
      "Use web_extract when you need the full content of a web page, e.g. an article, documentation page, or a search result URL.",
      "web_extract returns the page converted to Markdown, which preserves structure like headings and code blocks.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "要提取的网页 URL" }),
    }),
    execute: async (toolCallId, params, signal): Promise<AgentToolResult<{ provider: string; length?: number; error?: string } | undefined>> => {
      try {
        const resp = await extractRouter.extract({ url: params.url, signal });
        const title = resp.title ? `# ${resp.title}\n\n` : "";
        return {
          content: [{ type: "text", text: `提取完成（来源: ${resp.provider}）\n\n${title}${truncate(resp.content, 20000)}` }],
          details: { provider: resp.provider, length: resp.content.length },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `提取失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { provider: "none", error: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  });

  // ---------------- 额度展示渲染器 ----------------
  // 让 /web-quota 的输出在对话中呈现为好看的表格卡片
  // （表格用 Markdown 组件渲染，TUI 中规整对齐、支持宽度自适应）
  pi.registerMessageRenderer("web-tools/quota", (message, _options, theme) => {
    const md = message.content as string;
    const details = message.details as { providerCount: number; time: string } | undefined;
    const header = details
      ? `📊 供应商额度（${details.providerCount} 个）· ${details.time}`
      : "📊 供应商额度";
    const box = new Box(0, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(header, 0, 0));
    box.addChild(new Markdown(md, 0, 0, getMarkdownTheme()));
    return box;
  });

  // ---------------- /web-quota 命令 ----------------
  pi.registerCommand("web-quota", {
    description: "查看各搜索/提取供应商的剩余额度（web-quota [provider] [--refresh] [--set <余额>]）",
    getArgumentCompletions: (prefix) => {
      const ids = config.searchProviders.map((p) => p.id);
      return ids
        .filter((v) => v.startsWith(prefix))
        .map((v) => ({ value: v, label: v }));
    },
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const refresh = tokens.includes("--refresh");
      const setIdx = tokens.indexOf("--set");
      const setTarget = setIdx > 0 ? tokens[setIdx - 1] : undefined;
      const setValue =
        setIdx >= 0 && setIdx + 1 < tokens.length ? Number(tokens[setIdx + 1]) : NaN;
      // 排除 --refresh / --set 及其前后参数后的供应商目标
      const targets = tokens.filter((t, i) => {
        if (t === "--refresh" || t === "--set") return false;
        if (setIdx >= 0 && (i === setIdx - 1 || i === setIdx + 1)) return false;
        return true;
      });

      // --set：手动校准某供应商剩余额度（Exa 无服务端接口，以 dashboard 读数为准）
      if (setTarget && !Number.isNaN(setValue) && setValue >= 0) {
        await quota.calibrate(setTarget, setValue).catch(() => {});
        ctx.ui.notify(`已校准 ${setTarget} 剩余额度 = ${setValue}（立即生效）`, "info");
      }

      // --refresh：清除 TTL 缓存后重新拉取
      if (refresh) {
        for (const q of await quota.snapshot()) {
          await quota.refreshQuotaForce(q.provider).catch(() => {});
        }
      }

      let snapshot = await quota.snapshot();
      if (targets.length > 0) {
        snapshot = snapshot.filter((q) => targets.includes(q.provider));
      }

      const lines = ["| 供应商 | 免费总额 | 已用 | 剩余 | 单位 | 状态 |", "|---|---|---|---|---|---|"];
      for (const q of snapshot) {
        const isUsd = q.unit === "usd";
        // 数值格式化：usd 保留 2 位小数，credits 取整数
        const fmt = (v: number) => (isUsd ? v.toFixed(2) : Number.isInteger(v) ? String(v) : v.toFixed(2));
        // API 数据不一致时（如剩余 > 总额）收敛显示，避免怪异数字
        const total = q.total !== undefined ? fmt(q.total) : "∞";
        const used = q.used !== undefined && q.total !== undefined ? Math.min(q.used, q.total) : q.used;
        const remaining =
          q.remaining !== undefined && q.total !== undefined ? Math.min(q.remaining, q.total) : q.remaining;
        const usedStr = used !== undefined ? fmt(used) : "—";
        const remStr = remaining !== undefined ? fmt(remaining) : "—";
        let status = "正常";
        if (q.exhausted) {
          status = "⚠️ 耗尽";
        } else if (remaining !== undefined && q.total !== undefined && q.total > 0) {
          const ratio = remaining / q.total;
          if (ratio <= config.quota.exhaustedThresholdPercent / 100) status = "⚠️ 耗尽";
          else if (ratio <= config.quota.lowThresholdPercent / 100) status = "低配额";
        }
        lines.push(`| ${q.provider} | ${total} | ${usedStr} | ${remStr} | ${q.unit} | ${status} |`);
      }
      const text = lines.join("\n");

      if (snapshot.length === 0) {
        ctx.ui.notify("未找到匹配的供应商", "warning");
        return;
      }

      // 非交互模式（print/rpc/json）：直接输出到 stdout
      if (ctx.mode !== "tui") {
        console.log(text);
        return;
      }

      // TUI 模式：注入对话为自定义消息（display: true，LLM 不可见），并弹通知
      try {
        pi.sendMessage({
          customType: "web-tools/quota",
          content: text,
          display: true,
          details: { providerCount: snapshot.length, time: new Date().toLocaleTimeString() },
        });
      } catch {}
      ctx.ui.notify(`已更新额度（${snapshot.length} 个供应商）`, "info");
    },
  });

  // 会话启动时：刷新一次全部额度（异步，不阻塞）
  pi.on("session_start", () => {
    setTimeout(() => {
      quota.snapshot().catch(() => {});
    }, 1000);
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n…（内容已截断）" : s;
}
