import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockPi = `export const getAgentDir = () => process.env.TEST_PI_AGENT_DIR || process.cwd();`;
const mockTypebox = `
  const wrap = (type, value) => ({ type, value });
  export const Type = {
    Object: value => wrap("object", value),
    Union: value => wrap("union", value),
    Literal: value => wrap("literal", value),
    Optional: value => wrap("optional", value),
    String: value => wrap("string", value),
    Number: value => wrap("number", value),
    Array: value => wrap("array", value),
  };
`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-coding-agent") {
      return { url: `data:text/javascript,${encodeURIComponent(mockPi)}`, shortCircuit: true };
    }
    if (specifier === "typebox") {
      return { url: `data:text/javascript,${encodeURIComponent(mockTypebox)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { default: capabilityRouter } = await import("../extensions/index.ts");

function makePi(extraTools = []) {
  const handlers = new Map();
  const tools = new Map();
  const activeHistory = [];
  const messages = [];
  const baseTools = [
    { name: "read", description: "Read files", parameters: {} },
    { name: "bash", description: "Run commands", parameters: {} },
    { name: "edit", description: "Edit files", parameters: {} },
    { name: "write", description: "Write files", parameters: {} },
    { name: "web_search", description: "Search the internet", parameters: {} },
  ];
  return {
    handlers, tools, activeHistory, messages,
    on(name, handler) { handlers.set(name, handler); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    getAllTools() { return [...baseTools, ...extraTools, ...tools.values()]; },
    getActiveTools() { return activeHistory.at(-1) ?? baseTools.map((tool) => tool.name); },
    setActiveTools(names) { activeHistory.push([...names]); },
    sendMessage(message) { messages.push(message); },
  };
}

test("Pi lifecycle hides non-core tools, then activates one on load", async () => {
  const pi = makePi();
  capabilityRouter(pi);
  const ctx = { cwd: process.cwd(), ui: { setStatus() {} }, isIdle: () => false };
  pi.handlers.get("session_start")({}, ctx);
  assert.deepEqual(pi.activeHistory.at(-1), ["capability", "read", "bash", "edit", "write"]);

  const capability = pi.tools.get("capability");
  assert.ok(!capability.description.includes("web_search"));
  const search = await capability.execute("1", { action: "search", query: "internet" }, undefined, undefined, ctx);
  assert.match(search.content[0].text, /web_search/);

  const load = await capability.execute("2", { action: "load", names: ["web_search"] }, undefined, undefined, ctx);
  assert.match(load.content[0].text, /Loaded tools: web_search/);
  assert.ok(pi.activeHistory.at(-1).includes("web_search"));
  assert.equal(pi.messages.length, 1);
  pi.handlers.get("turn_start")({}, ctx);
  assert.ok(pi.activeHistory.at(-1).includes("web_search"));

  const duplicate = await capability.execute("3", { action: "load", names: ["web_search"] }, undefined, undefined, ctx);
  assert.match(duplicate.content[0].text, /Already active: web_search/);
  assert.equal(pi.messages.length, 1);

  pi.handlers.get("session_start")({}, ctx);
  assert.ok(!pi.activeHistory.at(-1).includes("web_search"));
});

test("tool load hint is bounded, preserves user authorization, and duplicate loads send no hint", async () => {
  const pi = makePi();
  capabilityRouter(pi);
  const ctx = { cwd: process.cwd(), ui: { setStatus() {} }, isIdle: () => false };
  pi.handlers.get("session_start")({}, ctx);
  const capability = pi.tools.get("capability");
  assert.match(capability.description, /not (?:authorize|authorization|an instruction)/i);
  assert.match(capability.promptSnippet, /only.*load|load.*only/i);
  await capability.execute("load", { action: "load", names: ["web_search"] }, undefined, undefined, ctx);
  assert.equal(pi.messages.length, 1);
  const hint = pi.messages[0].content;
  assert.ok(hint.length < 500, "hint must remain bounded");
  assert.match(hint, /next model request/i);
  assert.match(hint, /latest user.*constraints/i);
  assert.match(hint, /activation.*(?:not authorize|does not authorize)/i);
  assert.match(hint, /only.*load.*stop/i);
  assert.match(hint, /retry only.*inactive/i);
  await capability.execute("duplicate", { action: "load", names: ["web_search"] }, undefined, undefined, ctx);
  assert.equal(pi.messages.length, 1);
});

test("external activation survives turns and router loads without undoing external revocation", async () => {
  const extras = [];
  const pi = makePi(extras);
  capabilityRouter(pi);
  const ctx = { cwd: process.cwd(), ui: { setStatus() {} }, isIdle: () => false };
  pi.handlers.get("session_start")({}, ctx);
  extras.push({ name: "subagent", description: "Delegate work", parameters: {} });
  pi.setActiveTools([...pi.getActiveTools(), "subagent"]);
  pi.handlers.get("turn_start")({}, ctx);
  assert.ok(pi.getActiveTools().includes("subagent"));
  const capability = pi.tools.get("capability");
  const status = await capability.execute("status", { action: "status" }, undefined, undefined, ctx);
  assert.match(status.content[0].text, /Session: 6 active tools/);
  const search = await capability.execute("search", { action: "search", query: "subagent", types: ["tool"] }, undefined, undefined, ctx);
  assert.match(search.content[0].text, /No lexical matches/);
  const duplicate = await capability.execute("dup", { action: "load", names: ["subagent"] }, undefined, undefined, ctx);
  assert.match(duplicate.content[0].text, /Already active: subagent/);
  await capability.execute("load", { action: "load", names: ["web_search"] }, undefined, undefined, ctx);
  assert.ok(pi.getActiveTools().includes("subagent"));
  pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "subagent"));
  pi.handlers.get("turn_start")({}, ctx);
  assert.ok(!pi.getActiveTools().includes("subagent"), "do not resurrect another extension's revoked tool");
  assert.ok(pi.getActiveTools().includes("web_search"));
  pi.setActiveTools([...pi.getActiveTools(), "subagent"]);
  pi.handlers.get("session_start")({}, ctx);
  assert.deepEqual(pi.getActiveTools(), ["capability", "read", "bash", "edit", "write"]);
});

test("tool_search registration no longer fabricates a conflict warning", () => {
  // v0.3.0 renamed the router tool to `capability`; a `tool_search` tool is the
  // host builtin, and the old warning blamed a third-party package that is not
  // involved. No status may be emitted for it.
  const statuses = new Map();
  const pi = makePi([{ name: "tool_search", description: "Host builtin", parameters: {} }]);
  capabilityRouter(pi);
  pi.handlers.get("session_start")({}, { cwd: process.cwd(), ui: { setStatus: (key, value) => statuses.set(key, value) } });
  assert.ok(!statuses.has("capability-router-conflict"));
});

test("hidden tools activated by another extension survive turn_start", () => {
  const extras = [];
  const pi = makePi(extras);
  capabilityRouter(pi);
  const ctx = { cwd: process.cwd(), ui: { setStatus() {} }, isIdle: () => false };
  pi.handlers.get("session_start")({}, ctx);
  extras.push({ name: "hidden_tool", description: "Orchestrated elsewhere", parameters: {}, exposure: "hidden" });
  pi.setActiveTools([...pi.getActiveTools(), "hidden_tool"]);
  pi.handlers.get("turn_start")({}, ctx);
  assert.ok(pi.getActiveTools().includes("hidden_tool"), "full-list setActiveTools must not drop external hidden tools");
});

test("unload deactivates a loaded tool until it is loaded again", async () => {
  const pi = makePi();
  capabilityRouter(pi);
  const ctx = { cwd: process.cwd(), ui: { setStatus() {} }, isIdle: () => false };
  pi.handlers.get("session_start")({}, ctx);
  const capability = pi.tools.get("capability");
  await capability.execute("1", { action: "load", names: ["web_search"] }, undefined, undefined, ctx);
  assert.ok(pi.getActiveTools().includes("web_search"));
  const unload = await capability.execute("2", { action: "unload", names: ["web_search"] }, undefined, undefined, ctx);
  assert.match(unload.content[0].text, /Deactivated tools: web_search/);
  assert.ok(!pi.getActiveTools().includes("web_search"));
  pi.handlers.get("turn_start")({}, ctx);
  assert.ok(!pi.getActiveTools().includes("web_search"), "unload survives the next turn");
  const again = await capability.execute("3", { action: "load", names: ["web_search"] }, undefined, undefined, ctx);
  assert.match(again.content[0].text, /Loaded tools: web_search/);
  const notTool = await capability.execute("4", { action: "unload", names: ["nonexistent_tool"] }, undefined, undefined, ctx);
  assert.match(notTool.content[0].text, /Not active: nonexistent_tool/);
});

test("redacted memory results keep details, isError and usage", () => {
  const statuses = new Map();
  const pi = makePi([{ name: "memory_search", description: "Find memories", parameters: {} }]);
  capabilityRouter(pi);
  pi.handlers.get("session_start")({}, { cwd: process.cwd(), ui: { setStatus: (key, value) => statuses.set(key, value) } });
  const details = { hits: [{ id: "m1" }] };
  const usage = { input_tokens: 10, output_tokens: 2 };
  const result = pi.handlers.get("tool_result")({
    toolName: "memory_search",
    toolCallId: "t1",
    input: { query: "x" },
    content: [{ type: "text", text: "A".repeat(9000) }],
    details,
    structuredContent: { results: ["m1"] },
    isError: false,
    usage,
  });
  assert.ok(result.content[0].text.length < 9000, "text is still bounded");
  assert.equal(result.details, details);
  assert.deepEqual(result.structuredContent, { results: ["m1"] });
  assert.equal(result.isError, false);
  assert.equal(result.usage, usage);
});

test("Strict Skills and Context hide Pi catalog but remain searchable and loadable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "router-strict-"));
  process.env.TEST_PI_AGENT_DIR = dir;
  try {
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ capabilityRouter: {
      skills: { mode: "strict" }, context: { strictMode: true },
    } }));
    const skillPath = join(dir, "SKILL.md");
    const contextPath = join(dir, "README.md");
    writeFileSync(skillPath, "# Patrol\nUse behavior trees.");
    writeFileSync(contextPath, "# Design\n\nBlue buttons in the UI.");
    const pi = makePi();
    capabilityRouter(pi);
    const ctx = { cwd: dir, ui: { setStatus() {} }, isIdle: () => false };
    pi.handlers.get("session_start")({}, ctx);
    const options = {
      skills: [{ name: "patrol", description: "UE5 patrol behavior tree", filePath: skillPath }],
      contextFiles: [{ path: contextPath, content: "# Design\n\nBlue buttons in the UI." }],
      cwd: dir,
    };
    pi.handlers.get("before_agent_start")({ systemPromptOptions: options });
    assert.deepEqual(options.skills, []);
    assert.deepEqual(options.contextFiles, []);
    const capability = pi.tools.get("capability");
    const found = await capability.execute("1", { action: "search", query: "patrol", types: ["skill"] }, undefined, undefined, ctx);
    assert.match(found.content[0].text, /skill:patrol/);
    const loaded = await capability.execute("2", { action: "load", names: ["skill:patrol"] }, undefined, undefined, ctx);
    assert.match(loaded.content[0].text, /Use behavior trees/);
    const foundContext = await capability.execute("3", { action: "search", query: "blue buttons", types: ["context"] }, undefined, undefined, ctx);
    assert.match(foundContext.content[0].text, /context:/);
    const contextId = foundContext.content[0].text.match(/context:[^ ]+/)?.[0];
    const loadedContext = await capability.execute("4", { action: "load", names: [contextId] }, undefined, undefined, ctx);
    assert.match(loadedContext.content[0].text, /Blue buttons/);
  } finally {
    delete process.env.TEST_PI_AGENT_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP gateway and memory retrieval use existing Pi tools with bounded results", async () => {
  const pi = makePi([
    { name: "mcp", description: "MCP gateway", parameters: {}, sourceInfo: { path: "C:/pi-mcp-adapter/index.ts" } },
    { name: "memory_search", description: "Search memories", parameters: {}, sourceInfo: { path: "C:/pi-hermes-memory/index.ts" } },
  ]);
  capabilityRouter(pi);
  const ctx = { cwd: process.cwd(), ui: { setStatus() {} }, isIdle: () => false };
  pi.handlers.get("session_start")({}, ctx);
  const tool = pi.tools.get("capability");
  const mcpSearch = await tool.execute("1", { action: "search", query: "MCP external servers", types: ["mcp"] }, undefined, undefined, ctx);
  assert.match(mcpSearch.content[0].text, /mcp:mcp/);
  const noFakeGithub = await tool.execute("1b", { action: "search", query: "github issues", types: ["mcp"] }, undefined, undefined, ctx);
  assert.doesNotMatch(noFakeGithub.content[0].text, /mcp:mcp/);
  await tool.execute("2", { action: "load", names: ["mcp:mcp", "memory:memory_search"] }, undefined, undefined, ctx);
  assert.ok(pi.activeHistory.at(-1).includes("mcp"));
  assert.ok(pi.activeHistory.at(-1).includes("memory_search"));
  const input = { query: "past decision", limit: 20 };
  pi.handlers.get("tool_call")({ toolName: "memory_search", input });
  assert.equal(input.limit, 5);
  const result = pi.handlers.get("tool_result")({ toolName: "memory_search", content: [
    { type: "text", text: "A".repeat(10000) },
    { type: "text", text: "B".repeat(10000) },
  ] });
  assert.ok(result.content[0].text.length <= 6000);
  assert.equal(result.content.length, 1);
});

test("invalid config values surface a warning instead of silently falling back", () => {
  const dir = mkdtempSync(join(tmpdir(), "router-config-"));
  process.env.TEST_PI_AGENT_DIR = dir;
  try {
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ capabilityRouter: {
      search: { limit: "many" },
      memory: { maxResults: Number.NaN },
    } }));
    const statuses = new Map();
    const pi = makePi();
    capabilityRouter(pi);
    pi.handlers.get("session_start")({}, { cwd: process.cwd(), ui: { setStatus: (key, value) => statuses.set(key, value) } });
    const warning = statuses.get("capability-router-config") ?? "";
    assert.match(warning, /search\.limit/);
    assert.match(warning, /memory\.maxResults/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
