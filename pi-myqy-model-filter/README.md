# pi-myqy-model-filter

> `myqy` = 莫语轻言（昵称拼音首字母），本扩展统一使用此前缀命名。

pi 通用供应商模型过滤扩展：通过声明式配置文件，对 pi 内置供应商的模型列表进行白名单/黑名单过滤（例如只保留 OpenCode Zen 的免费模型），未配置的供应商完全不受影响。

## 特性

- **按供应商选择**：只过滤 `pi-myqy-model-filters.json` 中列出的供应商，其余供应商保持 pi 默认
- **白名单 / 黑名单规则**：`only`（仅保留匹配）/ `except`（剔除匹配），支持 glob（`*` `?`）与精确 id，可叠加使用
- **自动热更新**：远程模型目录刷新后，新模型免重启生效；编辑配置文件实时重应用
- **安全兜底**：配置缺失或无效 → fail-open（不过滤任何供应商）；热更新不会中断正在进行的 AI 回复

## 目录结构

```
pi-extensions/
└── pi-myqy-model-filter/
    ├── README.md                    # 本文档
    └── pi-myqy-model-filter.ts         # 扩展本体（唯一代码文件）
```

配置文件位于 pi agent 目录：`~/.pi/agent/pi-myqy-model-filters.json`（**不会自动生成**，需手动创建；缺失时扩展不生效）。

## 安装

### 方式一：自动发现（推荐）

将 `pi-myqy-model-filter.ts` 放入扩展自动发现目录，重启 pi 或 `/reload` 生效：

```bash
# 全局（所有项目）
cp pi-myqy-model-filter.ts ~/.pi/agent/extensions/

# 或项目级（需项目信任）
mkdir -p .pi/extensions && cp pi-myqy-model-filter.ts .pi/extensions/
```

也可以使用符号链接保持单一来源（当前仓库采用此方式）：

```bash
ln -s <repo>/pi-extensions/pi-myqy-model-filter/pi-myqy-model-filter.ts ~/.pi/agent/extensions/
```

### 方式二：作为 pi 包安装

```bash
pi install ./pi-extensions/pi-myqy-model-filter     # 从本目录安装
pi remove ./pi-extensions/pi-myqy-model-filter      # 卸载
```

## 配置

创建 `~/.pi/agent/pi-myqy-model-filters.json`：

```jsonc
{
  "hotReload": true,                    // 热更新开关，默认 true
  "providers": {
    "opencode":     { "only": ["*-free"] },    // 仅保留 id 匹配 *-free 的模型
    "opencode-go":  { "only": ["kimi-*"] },    // 仅保留 kimi 系列
    "other-provider": { "except": ["gpt-5*"] } // 剔除匹配的模型
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `hotReload` | boolean | `true`（默认）：监听远程目录刷新，新模型免重启生效；`false`：需重启或 `/reload` |
| `providers` | object | 需要过滤的供应商 id → 规则；**未列出的供应商不处理** |
| `only` | string[] | 白名单：仅保留 id 匹配的模型（glob 或精确 id） |
| `except` | string[] | 黑名单：剔除 id 匹配的模型 |
| `only` + `except` | — | 同时使用：先 `only` 过滤，再 `except` 剔除 |

### 兜底行为

- 配置文件缺失 / 无效 → fail-open：不处理任何供应商，pi 显示全部模型
- 缓存中无该供应商 → 跳过；热更新开启时，远程目录刷新后自动补上
- 某供应商配置了空规则（无 `only` 无 `except`）→ 不处理

## 使用示例

**只保留 OpenCode Zen 免费模型：**

```json
{ "hotReload": true, "providers": { "opencode": { "only": ["*-free"] } } }
```

**屏蔽某供应商全部模型：**

```json
{ "providers": { "opencode-go": { "except": ["*"] } } }
```

**多供应商 + 混合规则：**

```json
{
  "hotReload": true,
  "providers": {
    "opencode": { "only": ["*-free"] },
    "openai":   { "except": ["gpt-5.6*"] }
  }
}
```

## 热更新开关

```bash
# 开启（默认）
echo '{"hotReload": true}' > ~/.pi/agent/pi-myqy-model-filters.json
# 关闭
echo '{"hotReload": false}' > ~/.pi/agent/pi-myqy-model-filters.json
```

- 编辑**已存在**的配置文件 → 保存后约 0.2s 重新应用（含开关切换）
- **首次创建**配置文件 → 下次会话/重启生效

## 验证

```bash
pi --n --list-models        # 查看过滤后的模型列表
# 交互式 /model 中确认只显示允许的模型
```

## 机制简述

扩展通过 `pi.registerProvider(provider, { models })` **完全替换**该供应商的模型列表（`applyExtension` 语义），从而在 `/model`、`--list-models`、Ctrl+P、认证解析等所有下游链路生效。模型元数据（`api`/`baseUrl` 等）缺失时自动继承原值；认证方式不受影响。

## 常见问题

| 问题 | 说明 |
|---|---|
| 新模型何时可见？ | 开启热更新：远程目录刷新（约每 4h / `pi update --models`）后约 0.3s；关闭：重启或 `/reload` |
| 热更新会中断正在进行的回复吗？ | 不会，仅影响后续请求的模型解析 |
| 配置文件会自动生成吗？ | 不会。缺失时扩展 fail-open（不过滤），需手动创建 |
| 免费模型配额？ | 与过滤无关，超出配额 API 会报错 |
| 升级 pi 后失效？ | 依赖 `models-store.json` 结构与 `registerProvider` 语义；结构变化时扩展静默 fail-open（保留 pi 默认） |
| 缓存缺失（全新机器/离线）？ | 不处理该供应商；热更新开启时，远程刷新写入缓存后自动补上 |
