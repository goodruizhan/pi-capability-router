import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "../extensions/registry.ts";
import { searchTools } from "../extensions/search.ts";
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
