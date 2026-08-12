# Exa 计费方式与本地记账模型

> 调研来源：deepseek 网页版查询官方文档 + 本扩展实测验证（2026-08）。
> 维护：修改 Exa 相关记账逻辑时，同步更新本文档。

## 一、计费模式：按量付费（Pay-as-you-go）

- **无订阅费、无最低消费**，仅按实际用量扣费。
- 免费层（Free Tier）对个人用户非常慷慨：
  - **注册即送 $20 免费积分**（一次性）
  - **每月自动赠送 $10 免费积分**（持续）
  - 免费额度耗尽前**无需绑定支付方式**
- 免费额度用完后，从充值的账户余额中按量扣费。

### 官方价格表（按量付费）

| API 产品 | 价格 | 说明 |
|---|---|---|
| **Search**（搜索） | $7 / 1k 请求（$0.007/次） | 实时搜索，返回带页面内容的结果 |
| **Deep Search**（深度搜索） | $12–15 / 1k 请求 | 多步骤研究，结构化输出+引文 |
| **Contents**（内容提取） | $1 / 1k 页面（$0.001/页） | 获取已知 URL 的完整页面文本 |
| **Answer**（问答） | $5 / 1k 请求 | 基于搜索结果的 LLM 生成答案 |
| **Monitors**（监控） | $15 / 1k 请求 | 定时搜索，监控网络新事件 |

> 基础价格默认包含最多 **10 个搜索结果**；超出部分与"AI 页面摘要"等功能额外计费。

### 免费额度估算

- 官方估算：**$20 ≈ 2,800 次搜索**。本扩展实测单次搜索 `costDollars.total ≈ $0.007` → 20 / 0.007 ≈ 2,857 次，基本吻合。
- 另有信息提到每月 1,000 次免费请求，可能针对特定 API（如 MCP 服务），以官方定价页为准。

## 二、余额查询可行性（本扩展实测，2026-08）

**结论：没有面向个人 API key 的余额查询接口。**

| 尝试 | 结果 |
|---|---|
| `GET api.exa.ai/usage` / `/account` / `/billing` | 404，主 API 无余额端点 |
| `GET admin-api.exa.ai/team-management/api-keys` | `Unauthorized`，团队管理接口个人 key 无权 |
| `GET admin-api.exa.ai/team-management/api-keys/{id}/usage` | `Unauthorized`（官方文档确认此端点为**团队管理**功能，个人 key 不可用） |

- Dashboard（[Billing 页面](https://dashboard.exa.ai/billing)）是唯一可靠余额来源，但被安全验证拦截，无法脚本化。
- API 余额耗尽时报 **HTTP 402** + 错误标签：`NO_MORE_CREDITS` / `API_KEY_BUDGET_EXCEEDED` / `TEAM_BUDGET_EXCEEDED`。

## 三、本地记账模型（当前实现）

由于无服务端校准，Exa 采用**本地精确记账 + 校准基准**：

```
未校准：剩余 ≈ 累计免费总额（$20 初始 + $10 × 已过月数） − 本地累计消耗（Σ costDollars）
已校准：剩余 = 校准余额 − 校准日（含）起的按天消耗（Σ 每日 dailyUsage）
```

### 每日用量记录（dailyUsage）

- 每次 Exa 调用成功后按天累加 `dailyUsage["YYYY-MM-DD"]`（本地日期），持久化在 state
- 校准（`/myqy-web-tools-quota exa --set <余额>`）时记录 `calibratedAt` + `calibratedRemaining`，作为新余额基准；
  校准日（含）前的历史保留在 `dailyUsage` 中，但不再参与余额扣减
- 再次校准 → 更新基准，此前的消耗不重复扣减
- 查看报表：`/myqy-web-tools-usage`（按天用量 + 校准历史）

### 调用消耗（costDollars）

- 每次调用成功后解析响应的 `costDollars.total` 精确扣减：
  - **search**（`POST /search`）：实测响应带 `costDollars.total`（如 0.007）✅
  - **extract**（`POST /contents`）：实测响应同样带 `costDollars.total`（如 0.001）✅
- 响应缺失 `costDollars` 时：**不扣减**（宁可漏记，也不误扣大额 —— 曾因 `costUsd ?? 1` 误扣 1 美元/次导致本地额度被快速"耗尽"的 bug，已修复）
- 免费总额：`exaInitialFreeUsd`（默认 20）+ `exaMonthlyTopUpUsd`（默认 10）× 已过月数，计费基准为 `exaAccountCreatedAt` 或首次使用时间
- 状态持久化：`~/.pi/agent/pi-myqy-web-tools-state.json`（`providers.exa.spent` / `dailyUsage` / `calibratedRemaining`）

### 记账盲区（重要）

- 本地记账只统计**经过本扩展/MCP server 的调用**。
- 若同一个 API key 在其他地方直连 Exa（dashboard 试用、其他脚本/工具），消耗**无法感知**。
- 多 agent 场景：只要统一走本扩展/MCP server 单一入口并共享同一份 state 文件，记账即全局准确。

## 四、校准与优化方向

1. ✅ **手动校准命令**：`/myqy-web-tools-quota exa --set <dashboard余额>`（立即生效，写入内存+磁盘，记录 `calibratedAt`）
2. ✅ **按天用量报表**：`/myqy-web-tools-usage`（每日消耗 + 校准历史）
3. 显示层标注 `~`（估算）前缀 —— 未实现
4. 若日后 Exa 开放官方余额 API，或能通过 dashboard 抓包获取 api_key_id，可升级为服务端校准 —— 待跟进

## 五、相关代码位置

| 文件 | 职责 |
|---|---|
| `providers/exa.ts` | search/extract 请求与 `costDollars` 解析 |
| `quota.ts` | `recordUsage` 消耗累计、`exaFreeTotal` 免费总额模型 |
| `search.ts` / `extract.ts` | 调用成功后将 `costUsd` 传入 `recordUsage` |
| `config.ts` | `exaInitialFreeUsd` / `exaMonthlyTopUpUsd` / `exaAccountCreatedAt` 配置 |
