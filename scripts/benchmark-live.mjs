// Explicit live collection. Never change the checked-in snapshots without --update.
// An installed-session schema comparison is a counterfactual, not a token A/B.
// The isolated A/B measures the router's fixed overhead with the same CLI/model/prompt.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const piBin = process.env.PI_BIN ?? "C:/Users/LHC/.pi/agent/bin/pi-proxy-guard.js";
const update = process.argv.slice(2).includes("--update");
if (process.argv.slice(2).some((arg) => arg !== "--update"))
  throw new Error("Usage: npm run benchmark:live -- [--update]");
const prompt = "Reply with exactly one line: OK";
const version = spawnSync("node", [piBin, "--version"], { encoding: "utf8", timeout: 15000 });
const piVersion = version.status === 0 ? version.stdout.trim() : "unknown";
const cwd = mkdtempSync(join(tmpdir(), "pi-router-bench-"));

async function run(label, args, workdir, stats = false) {
  const child = spawn("node", [piBin, "--mode", "rpc", "--no-session", "--offline", ...args], {
    cwd: workdir, stdio: ["pipe", "pipe", "pipe"],
  });
  const events = [];
  let stderr = "";
  let buffer = "";
  let exited = false;
  child.stderr.on("data", (part) => { stderr += part.toString(); });
  child.stdout.on("data", (part) => {
    buffer += part.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) { try { events.push(JSON.parse(line)); } catch { /* diagnostics */ } }
    }
  });
  child.on("exit", () => { exited = true; });
  const wait = async (predicate, reason, ms = 120000) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !exited) {
      const value = predicate();
      if (value) return value;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`${label}: ${reason}; exit=${exited}; stderr=${stderr.slice(0, 500)}`);
  };
  const send = (id, type, extra = {}) => child.stdin.write(JSON.stringify({ id, type, ...extra }) + "\n");
  try {
    const stateId = `state-${label}`;
    send(stateId, "get_state");
    const state = await wait(() => events.find((e) => e.type === "response" && e.id === stateId), "get_state timed out", 60000);
    if (!state.success) throw new Error(`${label}: get_state failed: ${state.error}`);
    let message;
    let contextIndexed;
    if (stats) {
      send(`stats-${label}`, "prompt", { message: "/capability stats" });
      message = await wait(() => events.find((e) => e.type === "extension_ui_request" && e.method === "notify" && e.message?.includes("Capability Router Stats"))?.message,
        "router stats missing", 60000);
      // Discovery is lazy: a plain status reports 0 indexed until the first search.
      send(`search-${label}`, "prompt", { message: "/capability search 问题" });
      await wait(() => events.find((e) => e.type === "response" && e.id === `search-${label}`), "search command timed out", 60000);
      send(`stats2-${label}`, "prompt", { message: "/capability stats" });
      const later = await wait(() => {
        const notices = events.filter((e) => e.type === "extension_ui_request" && e.method === "notify" && e.message?.includes("Capability Router Stats"));
        return notices.length > 1 ? notices.at(-1).message : undefined;
      }, "post-search stats missing", 60000);
      contextIndexed = Number(/Context: (\d+) indexed/.exec(later)[1]);
    }
    const settledBefore = events.filter((e) => e.type === "agent_settled").length;
    send(`prompt-${label}`, "prompt", { message: prompt });
    const response = await wait(() => events.find((e) => e.type === "response" && e.id === `prompt-${label}`), "prompt rejected", 60000);
    if (!response.success) throw new Error(`${label}: prompt failed: ${response.error}`);
    await wait(() => events.filter((e) => e.type === "agent_settled").length > settledBefore, "model did not settle");
    const assistant = events.find((e) => e.type === "message_end" && e.message?.role === "assistant")?.message;
    if (!assistant || assistant.stopReason === "error" || !Number.isFinite(assistant.usage?.input) || assistant.usage.input <= 0) {
      throw new Error(`${label}: missing successful assistant usage; ${assistant?.errorMessage ?? stderr.slice(0, 500)}`);
    }
    return { model: `${assistant.provider}/${assistant.model}`, usage: assistant.usage, stats: message, contextIndexed };
  } finally {
    child.stdin.end();
    await new Promise((done) => { if (exited) done(); else { child.once("exit", done); setTimeout(() => { child.kill(); done(); }, 3000).unref(); } });
  }
}

const isolatedArgs = ["--no-extensions"];
const baseline = await run("isolated-baseline", isolatedArgs, cwd);
const routed = await run("isolated-routed", [...isolatedArgs, "--extension", join(root, "extensions", "index.ts")], cwd);
if (baseline.model !== routed.model) throw new Error(`A/B model mismatch: ${baseline.model} vs ${routed.model}`);
const installed = await run("installed-router", [], process.cwd(), true);
const get = (pattern) => {
  const match = pattern.exec(installed.stats ?? "");
  if (!match) throw new Error(`Installed router stats missing ${pattern}`);
  return match.slice(1).map(Number);
};
const [activeCount, activeChars] = get(/Startup: (\d+) active tools \/ (\d+) schema chars/);
const [registeredCount, registeredChars] = get(/Registered at startup: (\d+) tools \/ (\d+) schema chars/);
const promptTokens = (usage) => usage.input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
if (registeredCount < activeCount || registeredChars < activeChars) throw new Error("Invalid startup counts");
const measuredAt = new Date().toISOString();
const environment = `Pi RPC installed extensions at session_start, ${measuredAt} (${piVersion}, ${installed.model})`;
const before = { mode: "all-registered-active-counterfactual", environment, measuredAt, piVersion,
  model: installed.model, toolCount: registeredCount, toolSchemaChars: registeredChars };
const after = { mode: "capability-router-startup", environment, measuredAt, piVersion,
  model: installed.model, toolCount: activeCount, toolSchemaChars: activeChars,
  firstAssistantUsage: installed.usage };
const result = { before, after, contextIndexedAfterSearch: installed.contextIndexed, isolatedAB: {
  prompt, model: baseline.model, withoutRouter: baseline.usage, withRouter: routed.usage,
  promptTokensWithoutRouter: promptTokens(baseline.usage),
  promptTokensWithRouter: promptTokens(routed.usage),
  promptTokenDelta: promptTokens(routed.usage) - promptTokens(baseline.usage),
  note: "Input + cacheRead + cacheWrite compares prompt tokens even with cache hits. Fixed overhead in an isolated environment; NOT billed cost or full-environment token savings.",
} };
if (update) {
  const dir = join(root, "benchmark");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "before.json"), JSON.stringify(before, null, 2) + "\n");
  writeFileSync(join(dir, "after.json"), JSON.stringify(after, null, 2) + "\n");
  writeFileSync(join(dir, "isolated-ab.json"), JSON.stringify(result.isolatedAB, null, 2) + "\n");
}
console.log(JSON.stringify({ ...result, snapshotsUpdated: update }, null, 2));
