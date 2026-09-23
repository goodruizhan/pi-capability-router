# Memory 里程碑

Router 把 Pi 已注册的 `memory_search` 和 `session_search` 归为 `memory` 检索能力。加载 `memory:memory_search` 后，模型在下一请求调用原 Memory 插件；Router 不读取 SQLite 数据库，也不改写 Memory 存储或权限。

对 `memory_search` 调用，Router 将 `limit` 限在配置的 `maxResults`（默认 5）。检索结果经 `tool_result` 钩子去重、按段截断，默认每段最多 2000 字符、整次最多约 6000 字符，并带来源标签。`session_search` 保留原锚点格式，只受总字符限制。结果仅在被检索时进入上下文。

验收：模拟测试确认只索引检索工具、`limit` 被限制、长结果被截断；真实 Pi RPC 会话确认现有 2 个 Memory 检索工具可发现。真实持久化 Memory 内容未在测试中读取。
