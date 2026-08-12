# pi-myqy-web-tools — 多供应商 Web 搜索与网页提取扩展

pi 扩展：多供应商网络搜索 + 网页提取，带额度管理与自动切换。

## 功能

- **`web_search` 工具**：多供应商搜索（Tavily / Firecrawl / Exa / DuckDuckGo / SearXNG），按配置优先级自动选择，额度耗尽自动切换下一个
- **`web_extract` 工具**：网页提取为 Markdown。优先供应商自带提取（Tavily `/extract`、Firecrawl `/scrape`、Exa `/contents`），失败回退 r.jina.ai
- **`/web-quota` 命令**：查看各供应商实时/估算剩余额度

## 配置

配置文件：`~/.pi/agent/pi-myqy-web-tools.json`（从 `example-config.json` 复制，填入自己的 API key）

```json
{
  "quota": {
    "refreshTtlSeconds": 300,
    "lowThreshold": 50,
    "exhaustedThreshold": 0,
    "exaBalanceUsd": 10.0
  },
  "searchProviders": [
    { "id": "tavily", "name": "Tavily", "enabled": true, "apiKey": "tvly-xxx", "order": 1, "supports": ["search", "extract"] },
    { "id": "firecrawl", "name": "Firecrawl", "enabled": true, "apiKey": "fc-xxx", "order": 2, "supports": ["search", "extract"] },
    { "id": "exa", "name": "Exa", "enabled": true, "apiKey": "xxx", "order": 3, "supports": ["search", "extract"] },
    { "id": "duckduckgo", "name": "DuckDuckGo", "enabled": true, "order": 90, "supports": ["search"], "free": true },
    { "id": "searxng", "name": "SearXNG", "enabled": false, "url": "https://...", "order": 91, "supports": ["search"], "free": true }
  ],
  "extract": {
    "strategy": "provider-first",
    "providers": ["tavily", "firecrawl", "exa"],
    "fallbacks": ["r.jina.ai"]
  }
}
```

- `order` 越小优先级越高；`free: true` 表示无限免费（不参与额度管理）
- 可随时增删供应商（内置支持：tavily / firecrawl / exa / duckduckgo / searxng / r.jina.ai）

## 额度管理（真实）

| 供应商 | 额度来源 | 说明 |
|---|---|---|
| Tavily | `GET /usage`（官方） | 实时 plan_limit / plan_usage |
| Firecrawl | `GET /v2/team/credit-usage`（官方） | 实时 remainingCredits / planCredits |
| Exa | 本地累计 `costDollars` | 无服务端可访问接口；每次搜索响应返回美元成本，从 `exaBalanceUsd` 扣减 |
| DuckDuckGo / SearXNG / r.jina.ai | 无限 | 永久兜底，保证始终可搜 |

- 额度查询结果按 `refreshTtlSeconds` 缓存（默认 300s），避免每次搜索都打 usage API
- 耗尽/低配额供应商自动排到队尾或跳过；服务端报 429/403/credits 错误自动熔断标记
- 状态持久化：`~/.pi/agent/pi-myqy-web-tools-state.json`

## 开发

```
pi-myqy-web-tools/
├── index.ts            # 入口：注册 web_search / web_extract 工具 + /web-quota 命令
├── types.ts            # 统一类型定义
├── config.ts           # 配置读取（fail-open）
├── quota.ts            # 额度管理器（实时查询 + 本地累计 + 持久化）
├── search.ts           # 搜索路由器（额度感知，自动切换）
├── extract.ts          # 提取路由器（provider-first → r.jina.ai 兜底）
└── providers/          # 各供应商实现（统一 SearchProvider 接口）
    ├── tavily.ts  ├── firecrawl.ts  ├── exa.ts
    ├── duckduckgo.ts  ├── searxng.ts  └── jina.ts
```

新增供应商：在 `providers/` 下实现 `SearchProvider` 接口（`search` / 可选 `extract` / 可选 `getQuota`），在 `index.ts` 的 switch 中注册，配置文件中添加即可。

部署：修改源码后运行 `./deploy.sh`，pi 中 `/reload` 生效。
