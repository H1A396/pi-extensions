# pi-extensions 项目规则

本目录为 pi 扩展开发项目。以下规则对在本目录（及其子目录）运行 pi 时生效。

## 扩展命名规范

pi 扩展统一采用 `pi-myqy-<扩展名>` 命名格式：

| 段 | 含义 |
|---|---|
| `pi` | 表示这是一个 pi 扩展 |
| `myqy` | 作者标识（莫语轻言，昵称拼音首字母） |
| `<扩展名>` | 扩展功能名称（英文，kebab-case） |

规则要点：

1. 扩展文件夹、扩展代码文件、对应配置文件均使用 `pi-myqy-<扩展名>` 前缀命名。
2. `<扩展名>` 需能描述扩展功能，使用英文 kebab-case（小写字母 + 连字符），例如 `model-filter`。
3. 完整命名示例：`pi-myqy-model-filter`（文件夹/文件）、`pi-myqy-model-filters.json`（配置文件）。
4. 新增扩展时，必须先按本格式命名，再创建文件。

## 当前开发中的扩展

记录当前正在开发的扩展，开发过程中所有新增/修改的文件必须位于该扩展目录内。

| 项 | 值 |
|---|---|
| 扩展名称 | `pi-myqy-web-tools` |
| 扩展功能 | Web 搜索与 Web 提取 |
| 扩展路径 | `[当前工作路径]/pi-myqy-web-tools` |

- 当前工作路径：`/home/hjj29/my-project/pi-extensions`
- 扩展绝对路径：`/home/hjj29/my-project/pi-extensions/pi-myqy-web-tools`

> 当开始开发新的扩展时，更新本表；同一时间只维护一个正在开发的扩展。
