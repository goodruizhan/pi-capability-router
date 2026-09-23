# Context 里程碑

Context Provider 首次搜索时才索引当前项目的根目录 `README.md`、`AGENTS.md`、`CLAUDE.md`、`docs/` 下的 Markdown/TXT，以及配置的 `context.paths`。也索引 Pi 已载入的 Context Files。默认最多 200 个文件、每个索引最多读取前 32 KiB；文件须为不超过 1 MiB 的常规文件。普通项目路径经 realpath 检查，不跟随跳出允许根目录的链接。

搜索只返回文件名和简短标题；加载时按最近查询挑选相关段落、去重、附来源路径，默认最多 8000 字符。`context.strictMode: false` 保留 Pi 原有 Context Files 提示；显式设置 `true` 后才从初始提示移除 Pi Context Files，项目规则不再自动进入模型，必须按需搜索加载。

验收：测试确认项目文档可按正文关键词检索、相关段落受长度限制、重复加载不会重复注入；严格模式集成测试确认 Pi Context Files 从提示选项中移除而仍可检索。真实 Pi RPC `/capability search architecture` 命中了本项目架构文档。
