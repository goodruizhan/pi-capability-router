# pi-capability-router

Pi 的按需能力路由扩展。默认只让核心工具和一个 `capability` 入口进入模型工具列表；模型可搜索并加载已注册工具、Skills、MCP、Memory 检索工具及项目文档。

## 里程碑

| 里程碑 | 实现 | 说明 |
| --- | --- | --- |
| V0.1 Tools | 已完成 | 非核心工具默认隐藏，按需激活，会话内累加 |
| Skills | 已完成 | 从 Pi 已发现的 Skill 元数据建索引，按需读取单个 `SKILL.md`；可选严格模式隐藏目录 |
| MCP | 已完成 | 发现并激活 `pi-mcp-adapter` 代理或直连工具，由 Adapter 管理连接、搜索和认证 |
| Memory | 已完成 | 发现并激活现有检索工具，限制结果数和返回字符数 |
| Context | 已完成 | 搜索项目文档和 Pi Context Files，按相关段落限量加载；可选严格模式 |

各里程碑的验收与限制见 [Skills](docs/milestone-skills.md)、[MCP](docs/milestone-mcp.md)、[Memory](docs/milestone-memory.md)、[Context](docs/milestone-context.md)。V0.1 的源码分析见 [架构与验收](docs/v0.1-architecture-and-acceptance.md)。

## 安装和使用

将本项目作为 Pi 扩展加载。不要在同一会话中同时加载原 `pi-tool-search`，以免两个扩展同时修改 active tools。

```powershell
pi -e D:\Project\AI插件\Pi插件\pi-capability-router\extensions\index.ts
```

```text
capability({"action":"search","query":"UE5 patrol behavior tree","types":["skill"]})
capability({"action":"load","names":["skill:ue5-patrol"]})

capability({"action":"search","query":"GitHub repository issues","types":["mcp"]})
capability({"action":"load","names":["mcp:mcp"]})
```

搜索结果返回带类型的 ID；加载时使用该 ID。工具、MCP 和 Memory 检索工具在**下一次模型请求**可见；Skill 和 Context 正文由 `capability.load` 作为有限长度的工具结果返回。用户可运行 `/capability status`、`/capability stats`、`/capability search <query>`。

## 配置

在 Pi 的 `settings.json` 中使用 `capabilityRouter`：

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

`skills.mode: "safe"` 和 `context.strictMode: false` 保留 Pi 原有提示内容。严格模式分别移除 Pi 的 Skill 目录或 Context Files 初始提示，并由 Router 按需加载。已有 `toolSearch.alwaysEnabled` 与 footer 设置仍兼容。MCP Adapter 和 Memory 插件须分别安装，Router 不会自动安装或启动它们。

## 验证

```powershell
npm test
npm run benchmark
```

`/capability stats` 在当前 Pi 环境中报告工具 schema 字符估算、Skill 目录大小和按需加载统计。基准文件记录的是 schema JSON 字符估算，不等同于模型提供商的实际 token 计费。
