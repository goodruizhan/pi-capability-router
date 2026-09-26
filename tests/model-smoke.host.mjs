import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ECHO, LOAD, SEARCH } from "../scripts/model-smoke-contract.mjs";

test("list and missing-model preflight never resolve ambient credential commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "router-auth-preflight-"));
  try {
    const command = `!node -e "require('fs').writeFileSync('auth-command-triggered','YES')"`;
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ nonexistent: { type: "api_key", key: command } }));
    writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { openai: { apiKey: command } } }));
    const script = fileURLToPath(new URL("../scripts/model-smoke.mjs", import.meta.url));
    const run = (args) => spawnSync(process.execPath, [script, ...args], {
      cwd: dir, env: { ...process.env, PI_CODING_AGENT_DIR: dir }, encoding: "utf8", timeout: 30000,
    });
    const list = run(["--list"]);
    assert.equal(list.status, 0, list.stderr);
    assert.ok(JSON.parse(list.stdout).models.length > 0);
    const missing = run(["--live", "--model", "nonexistent/no-such-model"]);
    assert.equal(missing.status, 1, missing.stderr);
    const output = JSON.parse(missing.stdout);
    assert.equal(output.models[0].classification, "model_not_found");
    assert.equal(output.models[0].modelRequests, 0);
    assert.deepEqual(output.models[0].stages, []);
    assert.equal(existsSync(join(dir, "auth-command-triggered")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("real SDK registry hides echo at startup, searches and activates it with Router", async () => {
  const dir = mkdtempSync(join(tmpdir(), "router-probe-host-"));
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  let session;
  try {
    const host = await import(process.env.PI_HOST_MODULE ?? "@earendil-works/pi-coding-agent");
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ capabilityRouter: { bootstrapTools: [] } }));
    const settingsManager = host.SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new host.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalExtensionPaths: [fileURLToPath(new URL("../extensions/index.ts", import.meta.url))],
      extensionFactories: [(pi) => pi.registerTool({ name: ECHO, label: "Probe echo", description: "Harmless router probe echo",
        parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
        execute: async (_id, params) => ({ content: [{ type: "text", text: params.value }], details: {} }) })],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const runtime = await host.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    ({ session } = await host.createAgentSession({ cwd: dir, agentDir: dir, settingsManager, modelRuntime: runtime,
      resourceLoader: loader, sessionManager: host.SessionManager.inMemory(dir), tools: ["capability", ECHO] }));
    await session.bindExtensions({});
    assert.deepEqual(session.getActiveToolNames(), ["capability"]);
    assert.ok(session.getAllTools().some((t) => t.name === ECHO), "echo must be in real host registry");
    let modelCalls = 0;
    const unsubscribe = session.subscribe((event) => { if (event.type === "message_end" && event.message?.role === "assistant") modelCalls++; });
    const capability = session.getToolDefinition("capability");
    assert.ok(capability);
    const ctx = { isIdle: () => false, ui: { setStatus() {} } };
    const search = await capability.execute("search", SEARCH, undefined, undefined, ctx);
    assert.match(search.content[0].text, new RegExp(`tool:${ECHO}`));
    // Direct deterministic tool call is outside a model turn: suppress only the
    // router's continuation hint so this regression makes zero model requests.
    session.sendCustomMessage = async () => {};
    const load = await capability.execute("load", LOAD, undefined, undefined, ctx);
    assert.match(load.content[0].text, new RegExp(`Loaded tools: ${ECHO}`));
    assert.deepEqual(new Set(session.getActiveToolNames()), new Set(["capability", ECHO]));
    assert.ok(session.agent.state.tools.some((t) => t.name === ECHO));
    assert.equal(modelCalls, 0);
    unsubscribe();
  } finally {
    session?.dispose();
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
