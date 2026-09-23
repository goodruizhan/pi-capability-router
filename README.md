# Pi 按需能力路由器

语言：[简体中文](README.md) · [English](README.en.md)

`pi-capability-router` 是一个 Pi 扩展。它让不常用的工具默认不出现在模型的工具列表中，并提供统一的 `capability` 入口：需要额外能力时先搜索，再加载完成当前任务所需的部分。

目前支持工具、技能、MCP 服务、记忆检索和项目资料。路由器负责发现与加载；工具执行、MCP 连接和认证、记忆存储仍由原有的 Pi 扩展负责。

## 功能与里程碑

| 里程碑 | 已实现的功能 |
| --- | --- |
| 工具 | 启动时只保留核心工具与 `capability`；其他工具按需启用，直到会话结束 |
| 技能 | 搜索 Pi 已发现的技能，按需读取单个 `SKILL.md`；可选择隐藏启动时的技能目录 |
| MCP | 搜索并启用 `pi-mcp-adapter` 的代理工具或直连工具 |
| 记忆 | 启用已有的记忆检索工具，并限制检索条数与返回长度 |
| 项目资料 | 搜索项目文档，按相关段落加载；可选择隐藏 Pi 默认载入的资料文件 |

各部分的实现与验收记录：[工具](docs/v0.1-architecture-and-acceptance.md) · [技能](docs/milestone-skills.md) · [MCP](docs/milestone-mcp.md) · [记忆](docs/milestone-memory.md) · [项目资料](docs/milestone-context.md)。

## 启动

在项目目录运行以下命令，把本扩展加载到当前 Pi 会话：

```powershell
pi -e D:\Project\AI插件\Pi插件\pi-capability-router\extensions\index.ts
```

请避免在同一会话中同时加载原版 `pi-tool-search`，因为两个扩展都会设置 Pi 的启用工具列表。若需要 MCP 或记忆能力，还须分别安装并配置相应的扩展；本项目不会代替它们安装或登录。

## 如何使用

平时直接向 Pi 描述任务。现有工具足够时，模型可以直接工作；需要其他能力时，可通过 `capability` 搜索并加载。

以下是模型工具调用的示意，实际技能名称以搜索结果为准：

```text
capability({"action":"search","query":"UE5 敌人巡逻行为树","types":["skill"]})
capability({"action":"load","names":["skill:搜索结果中的名称"]})

capability({"action":"search","query":"查询 GitHub 仓库问题","types":["mcp"]})
capability({"action":"load","names":["mcp:mcp"]})
```

搜索结果会给出带类型的能力 ID，例如 `skill:xxx`、`memory:memory_search` 或 `context:文件路径`。加载时优先使用这个 ID。工具、MCP 和记忆检索工具会在**下一次模型请求**中可用；技能和项目资料的选定文本会直接作为本次加载的结果返回。

用户也可以使用以下 Pi 命令检查路由器：

```text
/capability status              查看当前已启用的能力
/capability search <关键词>      搜索可用能力
/capability stats               查看数量与字符统计
```

## 配置

在 Pi 的 `settings.json` 中添加 `capabilityRouter`。以下均为默认值，可只填写需要修改的字段：

```json
{
  "capabilityRouter": {
    "bootstrapTools": ["read", "bash", "edit", "write"],
    "showFooterStatus": true,
    "search": { "limit": 8 },
    "skills": { "mode": "safe", "maxChars": 8000 },
    "providers": { "mcp": true, "memory": true, "context": true },
    "memory": { "maxResults": 5, "maxCharsPerResult": 2000, "maxTotalChars": 6000 },
    "context": { "strictMode": false, "maxInjectedChars": 8000, "maxFiles": 200, "paths": [] }
  }
}
```

**默认模式保留 Pi 原有行为。**`skills.mode` 为 `"safe"` 时，Pi 仍会在初始提示中列出技能目录；`context.strictMode` 为 `false` 时，Pi 仍会载入原有资料文件。

如需进一步缩小初始提示，可把技能模式改为 `"strict"`，或把资料模式改为 `true`。启用严格资料模式后，`AGENTS.md` 等项目规则也不会自动进入模型提示；需要通过 `capability` 搜索并加载相关文件。已有的 `toolSearch.alwaysEnabled` 及状态栏显示设置仍受支持。

## 测试与统计

```powershell
npm test
npm run benchmark
```

`/capability stats` 显示当前 Pi 环境中的工具数量、工具定义字符估算和按需加载情况。仓库中的基准文件记录的是 **JSON 字符数估算**，不能当作模型服务商的实际 Token 计费数据。
