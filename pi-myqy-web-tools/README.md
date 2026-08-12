# pi-myqy-web-tools — 多供应商 Web 搜索与网页提取扩展

pi 扩展：多供应商网络搜索 + 网页提取，带额度管理与自动切换。

## 功能

- **`web_search` 工具**：多供应商搜索（Tavily / Firecrawl / Exa / DuckDuckGo / SearXNG），按配置优先级自动选择，额度耗尽自动切换下一个
- **`web_extract` 工具**：网页提取为 Markdown。优先供应商自带提取（Tavily `/extract`、Firecrawl `/scrape`、Exa `/contents`），失败回退 r.jina.ai
- **`/myqy-web-tools-quota` 命令**：查看各供应商实时/估算剩余额度

## 配置

配置文件：`~/.pi/agent/pi-myqy-web-tools.json`（从 `example-config.json` 复制，填入自己的 API key）

```json
{
  "quota": {
    "refreshTtlSeconds": 300,
    "lowThresholdPercent": 20,
    "exhaustedThresholdPercent": 0,
    "exaInitialFreeUsd": 20,
    "exaMonthlyTopUpUsd": 10,
    "exaAccountCreatedAt": "2026-07-17"
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
    "order": ["tavily", "firecrawl", "exa", "r.jina.ai"],
    "providers": ["tavily", "firecrawl", "exa"],
    "fallbacks": ["r.jina.ai"]
  }
}
```

### 策略化（推荐）

用 `search.order` / `extract.order` 显式声明供应商顺序，**写了就用、不写就不用**，严格从左到右尝试：

```json
{
  "search":  { "order": ["tavily", "firecrawl", "exa", "duckduckgo"] },
  "extract": { "order": ["tavily", "firecrawl", "exa", "r.jina.ai"] }
}
```

- 未配置 `order` 时回退为旧行为：搜索按 `order` 字段升序；提取按 `providers` + `fallbacks`
- 额度耗尽/失败的供应商自动跳过，继续尝试下一个；全部失败抛错

- `order` 越小优先级越高；`free: true` 表示无限免费（不参与额度管理）
- 可随时增删供应商（内置支持：tavily / firecrawl / exa / duckduckgo / searxng / r.jina.ai）

## 额度管理（真实）

| 供应商 | 免费额度模型 | 预警基准 |
|---|---|---|
| Tavily | 每月 1000 credits（官方 `GET /usage`） | 剩余 / plan_limit 百分比 |
| Firecrawl | 每月 1000 credits（官方 `GET /v2/team/credit-usage`） | 剩余 / planCredits 百分比 |
| Exa | 初始 $20 + 每月 $10（`exaInitialFreeUsd` / `exaMonthlyTopUpUsd`） | 累计免费额度百分比 |
| DuckDuckGo / SearXNG / r.jina.ai | 无限 | 不参与 |

- **预警全部基于免费额度百分比**：`lowThresholdPercent`（默认 20%）标记低配额，`exhaustedThresholdPercent`（默认 0%）标记耗尽
- Exa 的免费额度按「初始 $20 + 每月 $10 × 已过月数」累计计算，消耗从每次搜索响应的 `costDollars` 扣减；`exaAccountCreatedAt` 可选（缺省用首次使用时间）
- 额度查询结果按 `refreshTtlSeconds` 缓存（默认 300s）
- 耗尽/低配额供应商自动排到队尾或跳过；服务端报 429/403/credits 错误自动熔断标记；服务端额度恢复自动解除
- 状态持久化：`~/.pi/agent/pi-myqy-web-tools-state.json`

## 开发

```
pi-myqy-web-tools/
├── index.ts            # 入口：注册 web_search / web_extract 工具 + /myqy-web-tools-quota 命令
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

## 文档

- [`docs/providers-usage.md`](docs/providers-usage.md) — 供应商使用说明（免费计划、注册、端点、计费规则、限速）
- [`docs/exa-billing.md`](docs/exa-billing.md) — Exa 计费方式与本地记账模型（含实测验证）
