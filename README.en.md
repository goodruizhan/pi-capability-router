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

Search results include type-qualified IDs such as `skill:xxx`, `memory:memory_search`, or `context:<file-path>`. Prefer these IDs when loading. Tools, MCP tools, and memory retrieval tools become available on the **next model request**. Loading a skill or project document returns a bounded excerpt immediately.

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

**The defaults preserve Pi's existing prompt behavior.** With `skills.mode: "safe"`, Pi still lists available skills in its initial prompt. With `context.strictMode: false`, Pi still includes its usual context files.

To reduce the initial prompt further, set `skills.mode` to `"strict"` or `context.strictMode` to `true`. Strict context mode also removes files such as `AGENTS.md` from Pi's automatic prompt; search and load the relevant file through `capability` when needed. Existing `toolSearch.alwaysEnabled` and footer visibility settings remain supported.

## Tests and statistics

```powershell
npm test
npm run benchmark
```

`/capability stats` reports tool counts, estimated tool-schema characters, and on-demand loads in the current Pi environment. The repository benchmarks measure **JSON character counts**, not actual provider-billed tokens.
