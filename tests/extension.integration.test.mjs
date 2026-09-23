import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const mockPi = `export const getAgentDir = () => process.cwd();`;
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
    if (specifier === "@mariozechner/pi-coding-agent") {
      return { url: `data:text/javascript,${encodeURIComponent(mockPi)}`, shortCircuit: true };
    }
    if (specifier === "@sinclair/typebox") {
      return { url: `data:text/javascript,${encodeURIComponent(mockTypebox)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { default: capabilityRouter } = await import("../extensions/index.ts");

function makePi() {
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
    getAllTools() { return [...baseTools, ...tools.values()]; },
    setActiveTools(names) { activeHistory.push(names); },
    sendMessage(message) { messages.push(message); },
  };
}

test("Pi lifecycle hides non-core tools, then activates one on load", async () => {
  const pi = makePi();
  capabilityRouter(pi);
  const ctx = { ui: { setStatus() {} }, isIdle: () => false };
  pi.handlers.get("session_start")({}, ctx);
  assert.deepEqual(pi.activeHistory.at(-1), ["capability", "read", "bash", "edit", "write"]);

  const capability = pi.tools.get("capability");
  assert.ok(!capability.description.includes("web_search"));
  const search = await capability.execute("1", { action: "search", query: "internet" }, undefined, undefined, ctx);
  assert.match(search.content[0].text, /web_search/);

  const load = await capability.execute("2", { action: "load", names: ["web_search"] }, undefined, undefined, ctx);
  assert.match(load.content[0].text, /Loaded: web_search/);
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
