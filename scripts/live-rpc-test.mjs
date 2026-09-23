// Live Pi RPC smoke test for pi-capability-router.
//
// Drives a REAL Pi session over RPC and asserts the capability-router contract:
//   1. startup gating      - only core tools + `capability` are active
//   2. slash commands      - /capability status | stats | search dispatch cleanly
//   3. live model turn     - the model finds a hidden tool via capability(search)
//   4. cross-turn activation - capability(load) unlocks it for the next request,
//                             and the footer count rises by exactly one
//   5. additive idempotency - loading it again reports "Already active"
//
// Every raw RPC line is dumped to scripts/trace/*.jsonl for inspection.
//
// Usage:  node scripts/live-rpc-test.mjs
// Env:    PI_BIN=...pi-proxy-guard.js   (defaults to the user launcher)

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PI = process.env.PI_BIN ?? "C:/Users/LHC/.pi/agent/bin/pi-proxy-guard.js";
const TRACE_DIR = "scripts/trace";
mkdirSync(TRACE_DIR, { recursive: true });
const TRACE = join(TRACE_DIR, `trace-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);

// NOTE: no `--no-extensions` and no explicit `-e`. The router is installed as a
// package, so this exercises the router exactly as a user would have it running,
// with the full set of sibling extensions (mcp / memory / skills / computer-use)
// registering into the same session.
const args = [PI, "--mode", "rpc", "--no-session", "--offline"];

const child = spawn("node", args, { stdio: ["pipe", "pipe", "pipe"] });
const events = [];
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    writeFileSync(TRACE, line + "\n", { flag: "a" });
    try { events.push(JSON.parse(line)); } catch { /* non-JSON noise, still traced */ }
  }
});
const stderr = [];
child.stderr.on("data", (c) => stderr.push(c.toString("utf8")));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextId = 0;
const send = (obj) => child.stdin.write(JSON.stringify({ ...obj, id: String(++nextId) }) + "\n");

function waitForResponse(id, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (function tick() {
      const hit = events.find((e) => e.type === "response" && e.id === id);
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return reject(new Error(`timeout waiting for response id=${id}`));
      setTimeout(tick, 50);
    })();
  });
}
async function rpc(type, extra = {}, timeoutMs = 60000) {
  send({ type, ...extra });
  return waitForResponse(String(nextId), timeoutMs);
}

// Latest capability-router footer status, e.g. "5 / 97 tools".
const uiStatus = () => events
  .filter((e) => e.type === "extension_ui_request" && e.method === "setStatus"
    && e.statusKey === "capability-router")
  .map((e) => e.statusText ?? "")
  .pop() ?? "";
const activeCount = () => Number(/^(\d+) \/ \d+ tools$/.exec(uiStatus())?.[1] ?? 0);

// Accumulated assistant text + tool names seen so far, so each turn can wait
// for the agent to settle without re-scanning history.
let text = "";
const toolNames = new Set();
let cursor = 0;
let settledCount = 0;
function scan() {
  for (; cursor < events.length; cursor++) {
    const e = events[cursor];
    if (e.type === "message_update") {
      const a = e.assistantMessageEvent ?? {};
      if (a.type === "text_delta" && a.delta) text += a.delta;
      if (a.type === "toolcall_start" && a.toolName) toolNames.add(a.toolName);
    }
    if (e.type === "agent_settled") settledCount++;
  }
}
async function waitForSettle(since, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(400);
    scan();
    if (settledCount > since) return true;
  }
  return false;
}

// One model turn: dispatch, then wait until the agent settles.
async function turn(message, timeoutMs = 180000) {
  const before = settledCount;
  send({ type: "prompt", message });
  await waitForResponse(String(nextId), 60000);
  return waitForSettle(before, timeoutMs);
}

const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

try {
  // ---------------------------------------------------------------- 1. startup
  let startup = "";
  const startupDeadline = Date.now() + 60000;
  while (!startup && Date.now() < startupDeadline) { await sleep(500); startup = uiStatus(); }
  check("startup footer is '5 / N tools'", /^5 \/ \d+ tools$/.test(startup), startup || "(never reported)");
  const totalRegistered = Number(/^5 \/ (\d+)/.exec(startup)?.[1] ?? 0);
  check("hidden tool pool is substantial (>= 20)", totalRegistered >= 20, `total=${totalRegistered}`);

  // ------------------------------------------------------------ 2. get_state
  const st = await rpc("get_state", {}, 30000);
  check("get_state succeeds", st?.success === true, st?.data?.model?.id ?? "(no model)");

  // ---------------------------------------------------- 3. slash command suite
  for (const cmd of ["/capability status", "/capability stats", "/capability search bluetooth"]) {
    const errBefore = events.filter((e) => e.type === "extension_error").length;
    await turn(cmd, 30000);
    const errAfter = events.filter((e) => e.type === "extension_error").length;
    check(`slash command "${cmd}" dispatches cleanly`, errAfter === errBefore,
      events.filter((e) => e.type === "extension_error").slice(-1).map((e) => e.error).join("|"));
  }

  // --------------------------------------------- 4. search -> load across turns
  const ok1 = await turn(
    'Call the capability tool exactly once with action="search", query="browser", types=["tool"]. '
    + "Then stop and report the first tool name you found. Do not call any other tool.");
  check("search turn settled", ok1, `toolNames=[${[...toolNames].join(",")}]`);
  check("model called capability(search)", toolNames.has("capability"), [...toolNames].join(","));

  const searchResult = events.filter((e) => e.type === "tool_execution_end" && e.toolName === "capability")
    .map((e) => e.result?.content?.[0]?.text ?? "").join("\n");
  const foundTool = /tool:([a-zA-Z0-9_]+)/.exec(searchResult)?.[1];
  check("search surfaced a hidden tool id", !!foundTool, searchResult.slice(0, 160));

  const countBeforeLoad = activeCount();
  const ok2 = await turn(
    `Now call the capability tool exactly once with action="load" and names=["${foundTool ?? "computer_use_browser_click"}"]. `
    + "Then stop and report what the tool said. Do not call any other tool.");
  check("load turn settled", ok2, `toolNames=[${[...toolNames].join(",")}]`);

  const loadResult = events.filter((e) => e.type === "tool_execution_end" && e.toolName === "capability")
    .slice(-1)[0]?.result?.content?.[0]?.text ?? "";
  check("load reported success", /^Loaded tools:/.test(loadResult), loadResult.slice(0, 200));
  check("footer count increased by 1 after load", activeCount() === countBeforeLoad + 1,
    `before=${countBeforeLoad} after=${activeCount()}`);

  // --------------------------------------------- 5. additive + idempotent load
  const countBeforeDup = activeCount();
  await turn(
    `Call the capability tool exactly once with action="load" and names=["${foundTool ?? "computer_use_browser_click"}"] again. `
    + "Then stop and report what the tool said. Do not call any other tool.");
  const dupResult = events.filter((e) => e.type === "tool_execution_end" && e.toolName === "capability")
    .slice(-1)[0]?.result?.content?.[0]?.text ?? "";
  check("duplicate load is reported as already active", /Already active:/.test(dupResult), dupResult.slice(0, 200));
  check("footer count unchanged on duplicate load", activeCount() === countBeforeDup,
    `before=${countBeforeDup} after=${activeCount()}`);
} catch (e) {
  check("run completed without exception", false, String(e?.stack ?? e));
}

child.kill("SIGTERM");
await sleep(1500);
try { child.kill("SIGKILL"); } catch { /* already gone */ }

scan();
const passed = results.filter((r) => r.ok).length;
console.log("\n==== LIVE RPC TEST RESULTS ====");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  ->  ${String(r.detail).replace(/\n/g, " ")}` : ""}`);
console.log(`\n${passed}/${results.length} passed   | trace: ${TRACE}`);
if (stderr.length) console.log("stderr:", stderr.join("").slice(0, 800));
process.exit(passed === results.length ? 0 : 1);
