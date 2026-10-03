# Changelog

## Unreleased (pi-capability-router) — 2026-10-04 round-2 follow-up

- `npm run test:models` without arguments now defaults to the offline `--list` mode instead of exiting with a usage error; any explicit option still requires an explicit `--list`/`--live` mode (round-2 N-7).

## Unreleased (pi-capability-router) — 2026-10-04 test-report batch

Fixes and behaviors from the 2026-10-04 cross-component test report:

- Preserve `exposure: "hidden"` tools that another extension activated: the router's full-list `setActiveTools` no longer drops them on `turn_start` (the host builtin tool-search no longer gets wiped by a router refresh).
- Remove the stale conflict warning that fired on any `tool_search` registration; since 0.3.0 the router's own tool is `capability`, so that warning blamed a third-party package that was not involved. Cooperation with sibling extensions is now expressed by preserving their activations instead.
- `capability` gains an `unload` action: deactivate tools within the session (effective on the next model request); skill/context loads are reported as not unloadable. A router-unloaded tool is not resurrected as an "external" activation before the host list refreshes.
- CJK search recall: Han runs are compared through character bigrams, so `之前提到过什么` matches keywords containing `之前` (previously any Chinese query returned "No lexical matches"). Context-load chunk scoring uses the same bigrams.
- Multi-name queries (`grep, lsp, find`) surface each named capability instead of being filtered by task coverage; a short single-term query now really matches by prefix (`gre` → `grep`) — the old branch required full-token coverage and was unreachable.
- Redacted `memory_search`/`session_search` results keep `details`, `structuredContent`, `isError` and `usage`; only the model-facing text is bounded. `tool_call` clamps `limit` for `session_search` too.
- `SkillProvider.load` and `ContextProvider.load` stat the file before reading (10 MB / 1 MB caps) instead of reading a potentially huge file and slicing afterwards.
- Invalid `capabilityRouter` config values (wrong type/non-finite) are reported through the config status line instead of silently falling back; multiple warnings accumulate. Default `search.limit` raised from 8 to 14 so a first search can list all 14 jev tools.
- `/capability status|stats` prints the router version; a root `tsconfig.json` plus `npm run typecheck` gates the type layer (the missing `details` field TS2322 can no longer pass silently).
- README states savings in measured API tokens (-50.6% in the isolated 17-tool A/B) instead of the schema-character estimate, with the measurement environment disclosed.

## pi-capability-router 0.3.0 - 2026-10-03

- Target Pi Coding Agent 1.0: import the host API from `@earendil-works/pi-coding-agent` and TypeBox from `typebox`, the module names the 1.0 extension docs specify; peer and dev dependencies now require `^1.0.0`.
- Follow the 1.0 tool-result contract: every `capability` result carries the required `details` field (`details: undefined` where there is no structured state).
- Respect 1.0 tool exposure: tools registered with `exposure: "hidden"` are unreachable even when activated, so the router no longer offers them as searchable, loadable capabilities.
- `npm test` mocks and real-host smoke updated for the 1.0 module names; offline suite 20/20 and real-SDK host tests pass against `@earendil-works/pi-coding-agent` 1.0.0 with zero model calls.

## Unreleased (pi-capability-router)

- Clarify that loading tools only changes availability, not authorization: preserve the latest user constraints and stop after load-only requests; retain next-request activation and recovery hint.
- Add isolated current-source Pi SDK multi-model probe with offline real-host regressions, strict staged evidence and sanitized provider-failure categories (including billing and unavailable models).

- Preserve sibling extensions' dynamic tool activations across router refreshes without resurrecting externally revoked tools.
- Recognize lists of exact compound capability names and typed IDs without weakening ordinary lexical task filtering.
- Add deterministic real-host smoke validation of current source, with isolated state and no model calls.

- Add explicit live schema snapshots and isolated token-usage A/B; disclose fixed overhead and cached-token measurement limits.
- Improve lexical ranking and multiword filtering; remove speculative MCP gateway keywords and implicit context query state.
- Warn on invalid configuration (superseded by the accumulating config status warnings above); the `tool_search` conflict warning was removed as stale.

## pi-capability-router 0.2.0 - 2026-09-23

- Skills milestone: index Pi-discovered Skills and load one SKILL.md at a time; add opt-in strict catalog hiding.
- MCP milestone: route pi-mcp-adapter proxy and direct tools through capability search/load.
- Memory milestone: route existing retrieval tools with result-count and output-size limits.
- Context milestone: index allowed project documents and load relevant bounded excerpts; add opt-in strict Context Files hiding.
- Add separate milestone documentation, integration tests, and live Pi discovery checks.

## pi-capability-router 0.1.0 - 2026-09-23

- Replaced the manifest-heavy `tool_search` entry with a compact `capability` search/load/status tool.
- Added a local tool registry, lexical ranking, additive session activation, and live schema character statistics.
- Preserved the next-request activation hint and legacy `toolSearch` bootstrap settings.
- Added unit and lifecycle tests plus an isolated Pi RPC benchmark snapshot.

## Archived pi-tool-search history (separate product and version series)

Entries below are inherited from the predecessor and do not denote pi-capability-router releases.

### [0.3.6] - 2026-04-24

### Bug Fixes
- Clear footer status when `toolSearch.showToolSearchFooterStatus` is `false`, and re-read setting each refresh so settings changes take effect without stale status.
- Add explicit `showToolSearchFooterStatus` config name with backward compatibility for older status keys.

### [0.3.5] - 2026-04-23

### Other
- Add `pi install npm:pi-tool-search` command to README

### [0.3.4] - 2026-04-23

### Other
- Clarify core defaults and token-saving purpose

### [0.3.3] - 2026-04-23

### Bug Fixes
- Refresh active tools on every `turn_start`, not only fresh user prompts, so unlocked tools stay available during agent-loop continuations
- Queue hidden steer hint after successful `tool_search` so agent can continue/retry without waiting for another user message
- Stop showing visible retry guidance in `tool_search` results and narrow hidden retry hint so successful same-turn tool calls are not repeated

### Other
- Document same-response activation caveat and recovery behavior in `README.md`

### [0.3.2] - 2026-04-23

### Bug Fixes
- Split `tool_search` description into "Already active" and "Hidden" sections so LLM skips redundant enable calls
- Add `grep` and `find` to default core tools (always enabled alongside `read`, `write`, `edit`, `bash`)

### [0.3.1] - 2026-04-23

### Other
- Add repository field to package.json

### 0.3.0

- Renamed from `pi-lazy-tools` to `pi-tool-search`
- Config key changed: `lazyTools` → `toolSearch` in `settings.json`
- `showStatus` config option: show/hide `N / total tools` footer status (default: on)
- Provider-agnostic: removed payload-level filtering, relies solely on `setActiveTools`
- `readUserConfig()` consolidates all settings reads into one call

### 0.2.0

- User config: add `"toolSearch": { "alwaysEnabled": ["lsp", "grep"] }` to `settings.json` to pre-unlock tools beyond the defaults
- Reads config at each `session_start` — no reinstall needed after changes

### 0.1.0

- Initial release
- Manifest-aware `tool_search` gate
- `names: string[]` batch enabling
- Per-turn manifest refresh via `before_agent_start`
