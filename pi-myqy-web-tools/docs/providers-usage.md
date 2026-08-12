# 供应商使用说明（免费计划）

> 覆盖本扩展配置的三个"有免费计划"的付费供应商：**Tavily / Firecrawl / Exa**，
> 以及三个免费无限兜底（DuckDuckGo / SearXNG / r.jina.ai）。
> 信息来源：各官方定价/文档页（提取于 2026-08）+ 本扩展实测。修改供应商相关逻辑时同步更新本文档。

## 一、总览

| 供应商 | 免费额度 | 单位 | 是否需信用卡 | 本扩展角色 |
|---|---|---|---|---|
| **Tavily** | 每月 1,000 credits | credits | 否 | 搜索 + 提取（优先级最高） |
| **Firecrawl** | 每月 1,000 credits | credits | 否 | 搜索 + 提取 |
| **Exa** | 注册送 $20 + 每月 $10 | 美元 | 否（额度耗尽前） | 搜索 + 提取（余额型，本地记账） |
| DuckDuckGo | ∞ | — | 否 | 搜索兜底 |
| SearXNG | ∞（自建实例） | — | 否 | 搜索兜底（默认关闭） |
| r.jina.ai | ∞（有限速） | — | 否 | 提取兜底 |

---

## 二、Tavily（`tavily`）

- **官网/控制台**：https://app.tavily.com （key 管理、Billing）
- **注册获取 key**：控制台一键生成，key 形如 `tvly-xxx`，**每月自动送 1,000 credits，无需信用卡**
- **文档**：https://docs.tavily.com

### 本扩展用到的端点

| 能力 | 端点 | 本扩展实现 |
|---|---|---|
| 搜索 | `POST api.tavily.com/search`（`search_depth: basic`） | `providers/tavily.ts` |
| 提取 | `POST api.tavily.com/extract` | 同上 |
| 额度 | `GET api.tavily.com/usage`（`plan_limit / plan_usage`，实时） | `getQuota()` |

### 计费/credit 消耗规则

| 操作 | 消耗 |
|---|---|
| 搜索 `basic` | **1 credit/次** |
| 搜索 `advanced` | 2 credits/次 |
| 提取 `basic` | 每 5 个成功 URL = 1 credit（失败不扣） |
| 提取 `advanced` | 每 5 个成功 URL = 2 credits |
| Map | 每 10 页 = 1 credit |

> 本扩展搜索固定用 `basic`，即 **1 次搜索 = 1 credit**（/web-quota 中 `used=5` 即 5 次 basic 搜索）。

### 注意事项

- 免费层速度受限、额度少，适合测试；超出后 PAYG $0.008/credit 或按月套餐。
- 额度查询接口返回 `plan_limit` / `plan_usage`，本扩展按 TTL 缓存（默认 300s）。

---

## 三、Firecrawl（`firecrawl`）

- **官网/控制台**：https://www.firecrawl.dev （Billing、key 管理）
- **注册获取 key**：控制台生成，key 形如 `fc-xxx`，**每月免费 1,000 credits（1,000 页），无需信用卡**
- **文档**：https://docs.firecrawl.dev

### 本扩展用到的端点

| 能力 | 端点 | 本扩展实现 |
|---|---|---|
| 搜索 | `POST api.firecrawl.dev/v1/search` | `providers/firecrawl.ts` |
| 提取 | `POST api.firecrawl.dev/v1/scrape`（`formats: ["markdown"]`） | 同上 |
| 额度 | `GET api.firecrawl.dev/v2/team/credit-usage`（`planCredits / remainingCredits`，实时） | `getQuota()` |

### 计费/credit 消耗规则

| 功能 | 消耗 |
|---|---|
| Scrape / Crawl / Map / Monitor | **1 credit/页** |
| Search | **2 credits / 10 条结果** |
| Interact | 2 credits/浏览器分钟 |
| Agent | 预览期每天 5 次免费，之后动态定价 |

> 只对**成功请求**收费。credits **不滚动**（每月重置）。

### 限速（免费层）

- **约 20 请求/分钟、2 并发**（官方 pricing 标注 Free 为 "2 concurrent requests / Low rate limits"）。

### 注意事项

- 实测 `credit-usage` 接口偶发 `remainingCredits > planCredits`（如剩余 1021 > 总额 1000），
  本扩展在 /web-quota 显示层已做收敛（clamp 到总额）。
- 搜索接口返回 `data[].description` 作为摘要；提取返回 `data.markdown`。

---

## 四、Exa（`exa`）

- **官网/控制台**：https://dashboard.exa.ai （Billing 页看余额）
- **注册获取 key**：控制台生成，key 形如 UUID；**注册送 $20 + 每月 $10 免费额度，无需信用卡**
- **文档**：https://docs.exa.ai

### 本扩展用到的端点

| 能力 | 端点 | 本扩展实现 |
|---|---|---|
| 搜索 | `POST api.exa.ai/search`（`type: auto`） | `providers/exa.ts` |
| 提取 | `POST api.exa.ai/contents`（`text.maxCharacters`） | 同上 |
| 额度 | **无公开接口**（实测：主 API 404，admin-api 个人 key 无权） | 本地记账 |

### 计费规则（按量付费）

| 功能 | 价格 |
|---|---|
| Search | $7 / 1k 次（**$0.007/次**，基础价含 ≤10 条结果） |
| Contents | $1 / 1k 页（**$0.001/页**） |
| Deep Search | $12–15 / 1k 次 |
| Answer / Monitors | $5 / 1k 次 / $15 / 1k 次 |

### 记账方式（重点）

- 无服务端余额接口 → **本地精确记账**：每次调用成功后解析响应 `costDollars.total` 扣减
  （search 与 contents 响应均实测带该字段）。
- 免费总额模型：`$20 + $10 × 已过月数`（配置 `exaInitialFreeUsd` / `exaMonthlyTopUpUsd`）。
- **盲区**：同一 key 在别处直连 Exa 的消耗无法感知；多入口请统一走本扩展/MCP 并共享 state 文件。
- 详见 `docs/exa-billing.md`。

---

## 五、免费无限兜底（不参与额度管理）

| 供应商 | 说明 |
|---|---|
| **DuckDuckGo**（`duckduckgo`） | 免费无限搜索兜底。本扩展用 HTML 抓取（无 key），稳定性一般，仅作保底。 |
| **SearXNG**（`searxng`） | 免费自建搜索实例（需自托管），配置 `url` 后启用；默认关闭。 |
| **r.jina.ai**（`r.jina.ai`） | 免费网页提取兜底（`https://r.jina.ai/<url>`，有限速无 key）。 |

---

## 六、扩展内配置对应关系

```jsonc
{
  "quota": {
    "refreshTtlSeconds": 300,        // 额度查询缓存（Tavily/Firecrawl 服务端额度）
    "lowThresholdPercent": 20,       // 剩余 ≤ 总额 × 20% 标记低配额
    "exhaustedThresholdPercent": 0,  // 剩余 ≤ 总额 × 0% 标记耗尽
    "exaInitialFreeUsd": 20,         // Exa 初始免费额度
    "exaMonthlyTopUpUsd": 10         // Exa 每月补充
  },
  "searchProviders": [ /* tavily / firecrawl / exa / duckduckgo / searxng */ ],
  "search":  { "order": ["tavily", "firecrawl", "exa", "duckduckgo"] },
  "extract": { "order": ["tavily", "firecrawl", "exa", "r.jina.ai"] }
}
```

- 额度耗尽/失败 → 自动按 `order` 切换下一个，全部失败抛错。
- `/web-quota` 查看实时额度；`/web-quota <provider> --refresh` 强制刷新。
- 状态持久化：`~/.pi/agent/pi-myqy-web-tools-state.json`。
