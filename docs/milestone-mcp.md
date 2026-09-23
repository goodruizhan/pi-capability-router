# MCP 里程碑

Router 通过 Pi 已注册工具的来源识别 `pi-mcp-adapter` 的直连工具和 `mcp` 代理，作为 `mcp` 类型搜索结果。搜索命中代理时加载 `mcp:mcp`；下一模型请求由 Adapter 的 `mcp({search: ...})` 继续发现服务器工具，或直接调用已激活的直连工具。

Router 不连接 MCP server、不读取 Adapter 私有缓存、不复制 MCP 协议，也不处理认证。服务器启动、缓存、搜索和权限沿用 Adapter 的设置；若 Adapter 未安装，MCP 搜索没有候选。当前安装的 Adapter 2.11.0 在真实 Pi RPC 会话中被发现为 2 个可路由工具。

验收：模拟测试确认代理与 Adapter 直连工具归入 MCP，其他工具不误归类；集成测试确认加载 `mcp:mcp` 后 Pi active tools 包含 `mcp`；真实 Pi 启动统计确认 Adapter 工具被索引。
