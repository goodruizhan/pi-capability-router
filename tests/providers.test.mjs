import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../extensions/config.ts";
import { SkillProvider } from "../extensions/skill-provider.ts";
import { McpProvider } from "../extensions/mcp-provider.ts";
import { MemoryProvider, limitMemoryOutput } from "../extensions/memory-provider.ts";
import { ContextProvider } from "../extensions/context-provider.ts";

test("Skills milestone: Pi metadata indexes locally and only selected body loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "router-skill-"));
  try {
    const path = join(dir, "SKILL.md");
    writeFileSync(path, "# Patrol\nUse behavior trees for patrol.\nMore instructions here.");
    const provider = new SkillProvider();
    provider.refresh([{ name: "ue5-patrol", description: "UE5 behavior tree patrol", filePath: path, sourceInfo: { source: "project" } }]);
    assert.equal(provider.list()[0].source, "project");
    const result = provider.load("ue5-patrol", 30);
    assert.equal(result.loaded, true);
    assert.match(result.text, /<loaded-skill/);
    assert.match(result.text, /Truncated/);
    assert.equal(provider.load("ue5-patrol", 30).loaded, false);
    provider.reset();
    assert.equal(provider.loaded.size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MCP milestone: only adapter tools are routed as MCP", () => {
  const provider = new McpProvider();
  provider.refresh([
    { name: "mcp", description: "gateway", parameters: {} },
    { name: "github_search_issues", description: "Search issues", parameters: {}, sourceInfo: { path: "C:/npm/pi-mcp-adapter/index.ts" } },
    { name: "web_search", description: "Search internet", parameters: {}, sourceInfo: { path: "C:/npm/web/index.ts" } },
  ]);
  assert.deepEqual(provider.list().map((item) => item.name), ["mcp", "github_search_issues"]);
  assert.equal(provider.get("mcp")?.type, "mcp");
});

test("Memory milestone: retrieval tools and bounded deduplicated output", () => {
  const provider = new MemoryProvider();
  provider.refresh([
    { name: "memory_search", description: "Search", parameters: {} },
    { name: "memory_add", description: "Add", parameters: {} },
  ]);
  assert.deepEqual(provider.list().map((item) => item.name), ["memory_search"]);
  const bounded = limitMemoryOutput("header\n\nfirst result is long\n\nfirst result is long\n\nsecond result is long", 10, 28);
  assert.ok(bounded.includes("first resu"));
  assert.ok(!bounded.includes("second result"));
  assert.ok(bounded.includes("truncated"));
});

test("Context milestone: project docs are indexed and relevant chunks load within budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "router-context-"));
  try {
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "ui.md"), "# UI Style\n\nButtons are blue.\n\nSpacing uses eight pixels.\n\nUnrelated text.");
    const provider = new ContextProvider();
    provider.discover(dir, [], [], 20);
    const hits = provider.search("blue buttons", 5);
    assert.equal(hits[0]?.capability.name, "ui.md");
    const result = provider.load(hits[0].capability.id, 40);
    assert.equal(result.loaded, true);
    assert.match(result.text, /Buttons are blue/);
    assert.ok(provider.loadedChars <= 40);
    assert.equal(provider.load(hits[0].capability.id, 40).loaded, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("explicit paths index non-docs project directories only after discovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "router-workspace-"));
  try {
    mkdirSync(join(dir, "待解决"));
    writeFileSync(join(dir, "待解决", "问题清单.md"), "# 搜索问题\n\nTool routing notes.");
    const provider = new ContextProvider();
    assert.equal(provider.list().length, 0);
    provider.discover(dir, [], ["待解决"], 20);
    assert.equal(provider.list().length, 1);
    assert.equal(provider.search("routing notes", 5)[0]?.capability.name, "问题清单.md");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Config milestones default to safe Pi behavior and clamp limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "router-config-"));
  try {
    assert.equal(readConfig(dir).skills.mode, "safe");
    assert.equal(readConfig(dir).context.strictMode, false);
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ capabilityRouter: {
      skills: { mode: "strict", maxChars: 999999 },
      context: { strictMode: true, maxInjectedChars: -1 },
      memory: { maxResults: 99 },
    } }));
    const config = readConfig(dir);
    assert.equal(config.skills.mode, "strict");
    assert.equal(config.skills.maxChars, 20000);
    assert.equal(config.context.maxInjectedChars, 500);
    assert.equal(config.memory.maxResults, 20);
    const warnings = [];
    writeFileSync(join(dir, "settings.json"), "{broken json");
    assert.equal(readConfig(dir, (warning) => warnings.push(warning)).skills.mode, "safe");
    assert.match(warnings[0], /Cannot read router settings/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
