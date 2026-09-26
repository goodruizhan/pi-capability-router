import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "../extensions/registry.ts";
import { searchCapabilities, searchTools } from "../extensions/search.ts";
import { CapabilitySession } from "../extensions/session.ts";

const tools = [
  { name: "read", description: "Read a file", parameters: { type: "object" } },
  { name: "bash", description: "Run a shell command", parameters: { type: "object" } },
  { name: "web_search", description: "Search the internet for current information", parameters: { type: "object" } },
  { name: "computer_use_click", description: "Click desktop GUI controls", parameters: { type: "object" } },
  { name: "capability", description: "Find tools", parameters: { type: "object" } },
];

test("registry stays local and excludes the router itself", () => {
  const registry = new CapabilityRegistry();
  registry.refresh(tools);
  assert.equal(registry.get("capability"), undefined);
  assert.equal(registry.get("web_search")?.id, "tool:web_search");
  assert.equal(registry.list().length, 4);
  registry.refresh(tools.slice(0, 2));
  assert.equal(registry.get("web_search"), undefined);
});

test("search ranks exact names and task descriptions, hiding active tools", () => {
  const registry = new CapabilityRegistry();
  registry.refresh(tools);
  const active = new Set(["read", "bash"]);
  assert.equal(searchTools(registry.list(), "web_search", active, 8)[0]?.capability.name, "web_search");
  assert.equal(searchTools(registry.list(), "desktop GUI click", active, 8)[0]?.capability.name, "computer_use_click");
  assert.deepEqual(searchTools(registry.list(), "read", active, 8), []);
  assert.equal(searchTools(registry.list(), "", active, 8).length, 0);
});

test("lexical ranking distinguishes substring quality and filters incomplete multiword hits", () => {
  const items = [
    { id: "tool:browser", type: "tool", name: "browser", description: "Browse pages" },
    { id: "tool:browser_click", type: "tool", name: "browser_click", description: "Click a tab" },
    { id: "tool:computer_use_browser_click", type: "tool", name: "computer_use_browser_click", description: "Click a tab" },
    { id: "skill:ue5-module-router", type: "skill", name: "ue5-module-router", description: "Route UE5 modules" },
  ];
  const hits = searchCapabilities(items, "browser", new Set(), 8);
  assert.deepEqual(hits.map((hit) => hit.capability.name), ["browser", "browser_click", "computer_use_browser_click"]);
  assert.ok(hits[1].score > hits[2].score);
  assert.deepEqual(searchCapabilities(items, "capability router", new Set(), 8), []);
  assert.deepEqual(searchCapabilities(items, "browser click tab", new Set(), 8).map((hit) => hit.capability.name),
    ["browser_click", "computer_use_browser_click"]);
});

test("search recognizes lists of exact names and typed IDs without weakening task filtering", () => {
  const items = [
    { id: "memory:memory_search", type: "memory", name: "memory_search", description: "Retrieve prior decisions" },
    { id: "tool:subagents_enable", type: "tool", name: "subagents_enable", description: "Enable delegation" },
    { id: "skill:ue5-module-router", type: "skill", name: "ue5-module-router", description: "Route UE5 modules" },
  ];
  for (const query of ["memory_search subagents_enable", "memory:memory_search, tool:subagents_enable", "`MEMORY_SEARCH` and subagents_enable"]) {
    assert.deepEqual(searchCapabilities(items, query, new Set(), 8).map((hit) => hit.capability.name),
      ["memory_search", "subagents_enable"], query);
  }
  assert.deepEqual(searchCapabilities(items, "memory:memory_search", new Set(), 8).map((hit) => hit.capability.id), ["memory:memory_search"]);
  assert.deepEqual(searchCapabilities(items, "memory_search subagents_enable", new Set(["memory:memory_search"]), 8).map((hit) => hit.capability.name), ["subagents_enable"]);
  assert.deepEqual(searchCapabilities(items, "capability router", new Set(), 8), []);
  assert.deepEqual(searchCapabilities(items, "not_memory_search_x unrelated words", new Set(), 8), []);
});

test("load is additive and idempotent; a new session resets it", () => {
  const registry = new CapabilityRegistry();
  registry.refresh(tools);
  const session = new CapabilitySession();
  session.reset(["read", "bash", "missing"], registry.list(), 100);
  assert.deepEqual([...session.active], ["read", "bash"]);
  assert.deepEqual(session.load(["web_search", "web_search", "missing"], registry.list()), {
    enabled: ["web_search"], already: [], unknown: ["missing"],
  });
  assert.deepEqual(session.load(["web_search"], registry.list()).already, ["web_search"]);
  assert.equal(session.activationCount, 1);
  assert.ok(session.stats(registry.list(), 100).estimatedAvoidedStartupChars > 0);
  assert.equal(session.stats(registry.list(), 100).startupRegisteredToolCount, 5);
  registry.refresh([...tools, { name: "late_tool", description: "Registered later", parameters: {} }]);
  assert.equal(session.stats(registry.list(), 100).startupRegisteredToolCount, 5);
  assert.equal(session.stats(registry.list(), 100).registeredToolCount, 6);
  session.reset(["read", "bash"], registry.list(), 100);
  assert.equal(session.active.has("web_search"), false);
  assert.equal(session.activationCount, 0);
});
