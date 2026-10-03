# Pi 按需能力路由器

语言：[简体中文](README.md) · [English](README.en.md)

`pi-capability-router` 是一个 Pi 扩展，面向 Pi Coding Agent 1.0（`@earendil-works/pi-coding-agent` ^1.0.0）。它让不常用的工具默认不出现在模型的工具列表中，并提供统一的 `capability` 入口：需要额外能力时先搜索，再加载完成当前任务所需的部分。

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

capability({"action":"unload","names":["web_search"]})   # 会话内停用已加载的工具
```

搜索结果会给出带类型的能力 ID，例如 `skill:xxx`、`memory:memory_search` 或 `context:文件路径`。加载时优先使用这个 ID。工具、MCP 和记忆检索工具会在**下一次模型请求**中可用；技能和项目资料的选定文本会直接作为本次加载的结果返回；若需按问题挑选资料段落，加载 context 时显式传入 `query`。`unload` 仅作用于工具类能力，停用同样在下一次模型请求生效；技能/资料加载暂不支持卸载。

用户也可以使用以下 Pi 命令检查路由器：

```text
/capability status              查看当前已启用的能力
/capability search <关键词>      搜索可用能力
/capability stats               查看数量与字符统计
```

路由器也保留兄弟扩展通过 `setActiveTools()` 启用的工具（如 `subagents_enable` 的动态工具），不会在下一回合将它们隐藏；这些外部工具被原扩展撤销后也不会被自动恢复。重新启动/加载会话仍重置为启动工具集，暂不持久化历史加载状态。

搜索支持用空格或逗号列出完整复合名称或类型 ID，例如 `memory_search subagents_enable`；普通任务描述仍按词法覆盖率筛选，并非语义检索。中文查询按汉字 bigram 匹配（如「之前提到过什么」可命中含「之前」关键词的记忆检索工具），但仍是词法召回而非语义理解。

## 配置

在 Pi 的 `settings.json` 中添加 `capabilityRouter`。以下均为默认值，可只填写需要修改的字段：

```json
{
  "capabilityRouter": {
    "bootstrapTools": ["read", "bash", "edit", "write"],
    "showFooterStatus": true,
    "search": { "limit": 14 },
    "skills": { "mode": "safe", "maxChars": 8000 },
    "providers": { "mcp": true, "memory": true, "context": true },
    "memory": { "maxResults": 5, "maxCharsPerResult": 2000, "maxTotalChars": 6000 },
    "context": { "strictMode": false, "maxInjectedChars": 8000, "maxFiles": 200, "paths": [] }
  }
}
```

`context.paths` 只扫描所列路径与默认的根目录文件、`docs/`；如果项目资料放在 `计划文档/` 等目录，请显式配置相对项目根目录的路径（例如 `"paths": ["计划文档", "待解决", "参考文档"]`），不要依赖子项目 `docs/` 的测试结果。**默认模式保留 Pi 原有行为。**`skills.mode` 为 `"safe"` 时，Pi 仍会在初始提示中列出技能目录；`context.strictMode` 为 `false` 时，Pi 仍会载入原有资料文件。

如需进一步缩小初始提示，可把技能模式改为 `"strict"`，或把资料模式改为 `true`。启用严格资料模式后，`AGENTS.md` 等项目规则也不会自动进入模型提示；需要通过 `capability` 搜索并加载相关文件。已有的 `toolSearch.alwaysEnabled` 及状态栏显示设置仍受支持。

## 测试与统计

```powershell
npm test            # 纯离线单元/集成测试（mock Pi 与 SDK；不联网）
npm run test:host   # 基础宿主 smoke + 两个真实 SDK 宿主测试（不调用模型）
npm run test:models -- --list # 不联网，列出内置及 models.json 的模型（不加载 provider 扩展）
npm run test:models -- --live --model provider/model-id # 显式付费调用；可重复 --model
npm run benchmark   # 仅读取已保存快照；不会重新测量
npm run benchmark:live            # 真实 RPC 采集，输出结果，不写快照
npm run benchmark:live -- --update # 核对环境后显式更新基准快照（调用模型）
npm run test:live   # 真实 Pi RPC 冒烟测试（需要联网调用模型）
npm run test:race   # 同轮并行调用竞态探针（模型行为相关，结果非确定性）
```

`test:host` 需要可解析的 `@earendil-works/pi-coding-agent`（本轮验证 1.0.0），也可用 `PI_HOST_MODULE` 指向指定宿主的 `dist/index.js` 文件 URL。它先运行基础宿主 smoke，再运行 `tests/*.host.mjs` 中两个真实 SDK 宿主测试；测试使用临时目录/配置，不调用模型、不更新安装副本。真实 SDK 测试不属于默认 `npm test`，后者仅运行离线测试与 mock；host 测试分别覆盖真实工具注册/执行，以及 `--list`/缺失模型预检不会执行环境凭据命令。它们不代表模型端到端行为测试。

`test:models` 直接加载本仓库源码及当前真实 SDK 宿主（默认 `@earendil-works/pi-coding-agent`，或用 `PI_HOST_MODULE=file:///.../dist/index.js` 选择宿主）。每个模型使用隔离临时工作目录/配置、内存会话及只加载 Router、无副作用 echo 与显式指定的 provider 扩展：`--provider-extension /absolute/path/to/index.ts` 可重复；provider 模块是可信代码，务必自行审查。不会自动加载用户其他扩展/代理。真实调用必须显式 `--live --model provider/id`；可选 `--timeout-ms 90000`（1000–300000，单模型含初始化），最多 9 次实际模型请求（第 10 次在 SDK 调用前阻断），关闭自动重试；失败/跳过均返回非零退出码。输出 JSON 含逐模型阶段、实际工具事件参数（含随机 nonce）、使用量和耗时；失败仅提供安全的 HTTP 状态/限定错误代码及类别（如 auth、billing、rate_limit、unsupported_thinking、unsupported、model_unavailable、network 或 unknown），不打印凭据、原始异常文本或响应正文。只接受模型**真的**按顺序 search、另一用户请求 load、下一请求调用已激活 echo 且读到回显中只有工具结果才包含的随机 `RECEIPT` 并回复 `ACK:<RECEIPT>` 的成功结果。任何模型选择变化均失败，不自动换模型。

加载工具仅改变下一次模型请求中的可用性，**不授权自动执行新工具或新增任务**；若用户仅要求加载，应确认后停止，否则只继续用户已要求的任务和限制。测试中若已有代理环境变量而独立 Node SDK 无法走代理，可**仅为测试命令**指定 `NODE_USE_ENV_PROXY=1`（Bash：`NODE_USE_ENV_PROXY=1 npm run test:models -- --live --model provider/id`；PowerShell：`$old=$env:NODE_USE_ENV_PROXY; try { $env:NODE_USE_ENV_PROXY='1'; npm run test:models -- --live --model provider/id } finally { $env:NODE_USE_ENV_PROXY=$old }`）。Pi CLI 的代理分发器不会自动传给独立 SDK；不修改全局代理或环境设置。429 仍如实失败；此探针不做自动重试或请求间节流，需由矩阵执行者控制调用间隔。

认证由 SDK 的 ModelRuntime 处理：仅从用户 auth.json 读取所选 provider 的凭据到**内存**，OAuth 刷新也只写内存；读取用户 models.json、使用内存模型缓存，可使用进程已有的环境变量。不会写用户配置/认证/安装目录。`--list` 不加载 provider 扩展、不检查认证/执行密钥命令、不发模型请求，故不能列出只由 provider 扩展注册的模型；此类模型请在审查扩展后用 `--live --provider-extension ... --model ...` 探测。可选 Jev 联合 `assess_risk` 暂不支持：额外扩展会改变工具池及权限边界，需另行设计隔离方案。此工具不提供计费总额保障；若 provider 扩展自行发请求或持有常驻资源，SDK 的超时不能强制结束其后台 I/O，须人工审查。旧 `test:live` 仍测试已安装环境。

`npm run test:live` 与 `benchmark:live` 使用当前**已安装**的扩展；仅编辑仓库源码不会使它们测试到新代码，须先在测试环境加载或部署新版本。

`npm run test:live` 会启动一个真实的 Pi 会话（`--mode rpc --no-session --offline`），
加载已安装的扩展后依次验证：启动时只激活核心工具、三个 `/capability` 斜杠命令、
模型通过 `capability` 搜索到隐藏工具、跨回合 `load` 激活后页脚计数 +1、
重复加载返回 `Already active` 且计数不变。每行原始 RPC 事件会写入
`scripts/trace/*.jsonl` 以便排查。该测试会真实调用模型，耗时约 1–3 分钟。

`npm run test:race` 针对 [`docs/same-turn-race-bug.md`](docs/same-turn-race-bug.md) 记录的
已知缺陷：强制模型在同一条回复里同时发出 `capability(load)` 与对新加载工具的调用。实测该竞态
未能复现——模型会核对自身工具 schema 并拒绝调用尚未激活的工具，这本身就是提示词缓解生效的证据。
该脚本同时会验证加载后的工具定义确实进入了下一个模型请求（模型能报出该工具的必填参数，
且空参调用返回 schema 校验错误而非 "not found"）。由于依赖模型配合度，结果每次运行可能不同，
仅作为回归探针而非通过/失败门禁。

`/capability stats` 显示当前 Pi 环境中的工具数量、工具定义字符估算和按需加载情况。`npm run benchmark` **只读取历史快照，不测量当前环境**；扩展和 Pi 版本变化后须显式运行 `benchmark:live`，记录采集时间、Pi 版本、模型和工具数，并人工复核后再更新快照。`before.json` 是同一启动时刻的**全量注册工具字符反事实估算**，不是全量激活时的计费 token 实测；`after.json` 额外记录路由器首轮实际 `usage`。`benchmark/isolated-ab.json` 的同模型隔离 A/B 仅验证路由器固定开销，不能当作全量环境节省的 token 数。

`capability` 自身工具 schema 在 2026-09-23 测得约 **1,003 字符**，还会增加少量提示文本；隔离的四工具环境首轮输入实测多 **403 token（+8.3%）**。因此轻量项目可能净亏；隐藏的工具 schema 足够大、且使用回合够多时才划算。不要用字符数直接推算计费 token 或承诺统一的盈亏平衡点。搜索结果为**词法匹配而非语义理解**；加载的工具在本会话内保持激活，长会话的节省会随加载数量减少。

**收益请以 token 实测为准，不要引用字符估算。** 字符口径把最好情况当普遍情况：同一天的三套隔离 fixture 实测（`sensenova/sensenova-6.8-flash-lite`，17 工具环境、只装本路由器 vs 只装 14 个工具的判断层扩展）：

| 口径 | 全量注册 | 启动 active | 节省 |
|---|---|---|---|
| schema 字符（隔离 fixture） | 5941 chars | 3694 chars | 37.8%（字符估算） |
| **真实 API input tokens** | **5743** | **2848** | **-50.6%（token 实测）** |

同组数据里「双装两扩展 = 只装路由器 = 2848 tokens」，即路由器完全吸收了另一扩展工具 schema 的上下文成本。字符估算与 token 实测的差异是系统性的：字符省 37.8% 时 token 实际省 50.6%（反向高估/低估都可能），跨环境不可互相推算，引用时请注明测量环境与日期。
