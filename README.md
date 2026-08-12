# pi-extensions — pi 扩展开发仓库

本仓库用于开发、维护 [pi](https://github.com/earendil-works/pi)（coding-agent）的扩展，统一进行 git 版本管理。

## 仓库结构

```
pi-extensions/
├── AGENTS.md              # 项目规则：扩展/命令命名规范、当前开发中的扩展
├── 开发部署规划.md         # 开发与部署规划（临时规划文档）
├── deploy.sh              # 部署脚本：将 pi-myqy-* 扩展同步到 pi 运行时目录
├── README.md              # 本文档
└── pi-myqy-<扩展名>/       # 每个扩展一个目录
    ├── index.ts           # 扩展入口（注册工具 / 斜杠命令）
    ├── *.ts               # 模块源码
    ├── docs/              # 扩展文档（不部署到运行时）
    ├── example-config.json # 配置示例（不含真实 API key）
    └── README.md          # 扩展说明（含命令列表）
```

## 命名规范

详见 `AGENTS.md`，要点：

| 对象 | 格式 | 示例 |
|---|---|---|
| 扩展目录/文件 | `pi-myqy-<扩展名>`（kebab-case） | `pi-myqy-web-tools` |
| 斜杠命令 | `/myqy-<扩展名>-<命令>`（kebab-case） | `/myqy-web-tools-quota` |

- 命令统一带 `myqy-<扩展名>-` 前缀，保证不同作者/扩展的命令命名空间隔离
- 新增命令时在对应扩展的 `README.md` 中记录命令列表

## 开发与部署流程

```bash
# 1. 在当前开发中的扩展目录内编写代码（见 AGENTS.md「当前开发中的扩展」）
# 2. 本地测试（tsx 直接运行模块，不依赖 pi）
cd pi-myqy-web-tools && npx tsx path/to/module.ts

# 3. 部署到 pi 运行时扩展目录（复制模式，非软链接）
./deploy.sh

# 4. pi 中输入 /reload 使扩展生效

# 5. git 提交
```

> 部署采用**复制模式**：`deploy.sh` 将 `pi-myqy-*` 目录整体复制到
> `~/.pi/agent/extensions/<扩展名>/`，并剔除 `docs/`、`README.md`、
> `example-config.json` 等运行时不需要的文件。修改代码后需重新执行
> `./deploy.sh` + `/reload`。

## 扩展列表

| 扩展 | 功能 | 工具 | 斜杠命令 | 文档 |
|---|---|---|---|---|
| `pi-myqy-web-tools` | 多供应商 Web 搜索 / 网页提取 + 配额管理 | `web_search`、`web_extract` | `/myqy-web-tools-quota`、`/myqy-web-tools-usage` | [README](pi-myqy-web-tools/README.md)、[docs/](pi-myqy-web-tools/docs/) |

## 环境与密钥

- API key **永不入库**：个人配置存放在 `~/.pi/agent/pi-myqy-<扩展名>.json`，仓库内仅保留 `example-config.json`（占位符）
- 运行时 state（配额、用量记录）存放在 `~/.pi/agent/pi-myqy-<扩展名>-state.json`