# Pi Capability Router

Language: [简体中文](README.md) · [English](README.en.md)

`pi-capability-router` is a Pi extension that keeps infrequently used tools out of the model's tool list by default. It exposes one `capability` entry point: search for what a task needs, then load only the relevant capabilities.

It supports tools, skills, MCP services, memory retrieval, and project documents. The router handles discovery and activation. Existing Pi extensions remain responsible for executing tools, connecting to and authenticating with MCP servers, and storing memory.

## Features and milestones

| Milestone | Implemented behavior |
| --- | --- |
| Tools | Start with core tools and `capability`; activate other tools on demand for the rest of the session |
| Skills | Search skills discovered by Pi and load one `SKILL.md` at a time; optionally hide the startup skill catalog |
| MCP | Find and activate the `pi-mcp-adapter` proxy or its direct tools |
| Memory | Activate existing retrieval tools and limit the number and size of returned results |
| Context | Search project documents and load relevant excerpts; optionally hide Pi's default context files |

Implementation and acceptance notes are available in Chinese: [Tools](docs/v0.1-architecture-and-acceptance.md) · [Skills](docs/milestone-skills.md) · [MCP](docs/milestone-mcp.md) · [Memory](docs/milestone-memory.md) · [Context](docs/milestone-context.md).

## Start Pi with the extension

From the project directory, load the extension for the current Pi session:

```powershell
pi -e D:\Project\AI插件\Pi插件\pi-capability-router\extensions\index.ts
```

Do not load the original `pi-tool-search` in the same session: both extensions set Pi's active tool list. MCP and memory capabilities also require their respective extensions to be installed and configured. This router does not install them or handle their sign-in flows.

## Usage

Normally, just describe your task to Pi. The model can use its current tools directly. When it needs another capability, it can search and load it through `capability`.

These are examples of model tool calls. Use the IDs returned by search in your environment:

```text
capability({"action":"search","query":"UE5 enemy patrol behavior tree","types":["skill"]})
capability({"action":"load","names":["skill:name-from-search-results"]})

capability({"action":"search","query":"find GitHub repository issues","types":["mcp"]})
capability({"action":"load","names":["mcp:mcp"]})
```

Search results include type-qualified IDs such as `skill:xxx`, `memory:memory_search`, or `context:<file-path>`. Prefer these IDs when loading. Tools, MCP tools, and memory retrieval tools become available on the **next model request**. Loading a skill or project document returns a bounded excerpt immediately. Pass `query` explicitly when loading context to rank excerpts by topic.

You can inspect the router with Pi commands:

```text
/capability status              Show active capabilities
/capability search <query>      Search available capabilities
/capability stats               Show counts and character estimates
```

## Configuration

Add `capabilityRouter` to Pi's `settings.json`. The values below are defaults, so you only need to specify fields you want to change:

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

`context.paths` is needed for project documents outside the root files and `docs/` tree (for example `"paths": ["计划文档", "待解决", "参考文档"]` when running from this workspace root). **The defaults preserve Pi's existing prompt behavior.** With `skills.mode: "safe"`, Pi still lists available skills in its initial prompt. With `context.strictMode: false`, Pi still includes its usual context files.

To reduce the initial prompt further, set `skills.mode` to `"strict"` or `context.strictMode` to `true`. Strict context mode also removes files such as `AGENTS.md` from Pi's automatic prompt; search and load the relevant file through `capability` when needed. Existing `toolSearch.alwaysEnabled` and footer visibility settings remain supported.

## Tests and statistics

```powershell
npm test            # unit + integration tests (mock Pi, no network)
npm run benchmark               # reads saved snapshots only; does not remeasure
npm run benchmark:live          # live RPC collection, prints without modifying snapshots
npm run benchmark:live -- --update # explicitly refresh snapshots after reviewing the environment
npm run test:live   # live Pi RPC smoke test (calls a real model, needs network)
npm run test:race   # same-turn parallel-call race probe (model-dependent, non-deterministic)
```

`npm run test:live` and `benchmark:live` exercise the **installed** router; editing repository sources alone does not deploy them. Load or deploy the changed version in a test environment before treating these runs as validation of new code.

`npm run test:live` starts a real Pi session (`--mode rpc --no-session --offline`) with the
installed extensions and verifies in order: startup activates only the core tools, the three
`/capability` slash commands, a model turn that finds a hidden tool via `capability`, the
footer count rising by exactly one after `load` across a turn boundary, and a duplicate load
returning `Already active` with the count unchanged. Every raw RPC line is written to
`scripts/trace/*.jsonl` for inspection. This test calls a real model and takes about 1–3 minutes.

`npm run test:race` targets the known limitation recorded in
[`docs/same-turn-race-bug.md`](docs/same-turn-race-bug.md): it forces the model to emit
`capability(load)` together with a call to the newly loaded tool in a single assistant message.
The race does not reproduce in practice — the model checks its own tool schema and refuses to
call a tool that has not been activated, which is itself evidence that the prompt mitigation
works. The script also verifies that a loaded tool definition actually reaches the next model
request (the model can name the tool's required parameters, and an empty-argument call returns a
schema validation error rather than "not found"). Because it depends on model compliance the
outcome varies between runs, so treat it as a regression probe, not a pass/fail gate.

`/capability stats` reports tool counts, estimated tool-schema characters, and on-demand loads. `npm run benchmark` **only compares saved snapshots**, not the current environment. Re-run `benchmark:live` when Pi or installed extensions change, then review the environment before updating snapshots. `before.json` represents an **all-registered-tools character counterfactual**, not billed tokens for an all-active run. `after.json` additionally records actual first-turn model usage. The same-model isolated A/B in `benchmark/isolated-ab.json` measures fixed overhead only, **not** full-environment token savings.

The `capability` tool schema measured about **1,003 characters** on 2026-09-23, plus a short prompt snippet. In an isolated four-tool environment it cost **403 additional first-turn input tokens (+8.3%)**. Small tool sets may therefore be a net loss; there is no universal break-even token number. Search uses **lexical matching, not semantic retrieval**. Loaded tools remain active through the session, reducing savings in long sessions.
