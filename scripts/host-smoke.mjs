// Deterministic real-host check: current checkout, isolated state, no model calls.
// Requires @earendil-works/pi-coding-agent (tested on 1.0.0).
// PI_HOST_MODULE may point to another installed host's dist/index.js file URL.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "capability-host-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = dir;
let session;
try {
  const host = await import(process.env.PI_HOST_MODULE ?? "@earendil-works/pi-coding-agent");
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ModelRuntime } = host;
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  let sibling;
  const routerPath = fileURLToPath(new URL("../extensions/index.ts", import.meta.url));
  const loader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [routerPath],
    extensionFactories: [(pi) => { sibling = pi; }],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json") });
  ({ session } = await createAgentSession({
    cwd: dir, agentDir: dir, settingsManager, modelRuntime, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(dir),
  }));
  const errors = [];
  session.extensionRunner.onError((event) => errors.push(event));
  await session.bindExtensions({});
  assert.deepEqual(new Set(session.getActiveToolNames()), new Set(["capability", "read", "bash", "edit", "write"]));
  sibling.registerTool({
    name: "host_echo", label: "Host echo", description: "Harmless dynamic echo",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "HOST_OK" }], details: {} }),
  });
  sibling.setActiveTools([...sibling.getActiveTools(), "host_echo"]);
  await session.extensionRunner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });
  assert.ok(session.getActiveToolNames().includes("host_echo"));
  const echo = session.agent.state.tools.find((tool) => tool.name === "host_echo");
  assert.ok(echo, "dynamic tool is in the real agent tool inventory");
  const result = await echo.execute("host-smoke", {}, undefined);
  assert.equal(result.content[0].text, "HOST_OK");
  sibling.setActiveTools(sibling.getActiveTools().filter((name) => name !== "host_echo"));
  await session.extensionRunner.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });
  assert.ok(!session.getActiveToolNames().includes("host_echo"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, routerPath, checks: ["isolated source loading", "startup gating", "runtime registration", "external activation survives turn_start", "real agent tool execution", "external deactivation respected"], modelCalls: 0 }, null, 2));
} finally {
  session?.dispose();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(dir, { recursive: true, force: true });
}
