# pi-capability-router

Pi 的按需工具发现插件。V0.1 在启动时只保留 `read`、`bash`、`edit`、`write` 和 `capability`。其他已注册工具仍由 Pi 管理，但默认不进入模型工具列表。模型需要额外工具时，先搜索，再加载最少的工具。

## 当前阶段

本版本实现架构计划中的 **V0.1 Tool Lazy Router**。Skills、MCP、Memory、Context 的统一索引属于后续阶段；本版本不会改变 Pi 对这些资源的默认处理。搜索索引只保存在插件内存中，`capability` 的描述不包含工具目录。

## 安装

将本项目路径作为 Pi 扩展加载，或在 Pi 配置中加入项目路径。原 `pi-tool-search` 扩展应从同一 Pi 会话的扩展列表中移除，避免两个扩展同时设置 active tools。

```powershell
pi -e D:\Project\AI插件\Pi插件\pi-capability-router\extensions\index.ts
```

## 使用

```text
capability({"action":"search","query":"desktop GUI click screenshot"})
capability({"action":"load","names":["computer_use_click"]})
```

`load` 后在**下一次模型请求**中使用新工具。Pi 的当前模型请求已经固定工具 schema，因此不要把 `load` 和新工具调用放在同一条模型回复里。已加载工具在本会话中保持启用，新会话重新回到初始工具集。

`capability({"action":"status"})` 查看当前启用工具。用户可使用 `/capability status`、`/capability stats`、`/capability search <query>`。`stats` 报告当前 Pi 注册工具的 schema JSON 字符估算；该数值是本机实测估算，不等同于 provider 最终 token 计费。

## 配置

在 Pi 的 `settings.json` 中可选配置：

```json
{
  "capabilityRouter": {
    "bootstrapTools": ["read", "bash", "edit", "write"],
    "showFooterStatus": true,
    "search": { "limit": 8 }
  }
}
```

旧版 `toolSearch.alwaysEnabled` 仍会加入初始工具列表，旧版 footer 隐藏选项仍生效。`bootstrapTools` 可用于保留更多常用工具，但会增加初始 schema 大小。

## 验证

```powershell
npm test
```

测试覆盖工具索引、搜索排序、默认隐藏、重复加载和新会话重置。真实 Pi 环境的验收步骤见 [V0.1 架构与验收](docs/v0.1-architecture-and-acceptance.md)。

`npm run benchmark` 会读取 `benchmark/before.json` 和 `benchmark/after.json` 并输出差值。当前样本来自同一完整扩展环境的启动快照：“全部已注册工具均启用”对照与 Router 实际启用状态。命令也接受两个 JSON 文件路径作为参数。
