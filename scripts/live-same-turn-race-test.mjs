// Live Pi RPC test for the documented same-turn parallel-call race
// (see docs/same-turn-race-bug.md).
//
// The router's `capability` tool only activates loaded tools on the NEXT model
// request. If a model speculates and emits capability(load) together with a call
// to the newly-loaded tool in the SAME assistant message, the second call cannot
// resolve because the tool schema was frozen when that response was built.
//
// This test forces exactly that pattern and classifies the outcome:
//   FIXED          - parallel calls both succeed (upstream core fixed it)
//   DOCUMENTED     - load succeeds, the speculative call fails with "not found"
//   NO_RACE        - the model obeyed the mitigation and did not call them together
//
// Every raw RPC line is dumped to scripts/trace/*.jsonl for inspection.
// Usage: node scripts/live-same-turn-race-test.mjs

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PI = process.env.PI_BIN ?? "C:/Users/LHC/.pi/agent/bin/pi-proxy-guard.js";
const TRACE_DIR = "scripts/trace";
mkdirSync(TRACE_DIR, { recursive: true });
const TRACE = join(TRACE_DIR, `race-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);

const child = spawn("node", [PI, "--mode", "rpc", "--no-session", "--offline"],
  { stdio: ["pipe", "pipe", "pipe"] });
const events = [];
let buf = "";
child.stdout.on("data", (c) => {
  buf += c.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) { writeFileSync(TRACE, line + "\n", { flag: "a" }); try { events.push(JSON.parse(line)); } catch {} }
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextId = 0;
const send = (o) => child.stdin.write(JSON.stringify({ ...o, id: String(++nextId) }) + "\n");

function waitForResponse(id, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (function tick() {
      const hit = events.find((e) => e.type === "response" && e.id === id);
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return reject(new Error(`timeout id=${id}`));
      setTimeout(tick, 50);
    })();
  });
}

const uiStatus = () => events
  .filter((e) => e.type === "extension_ui_request" && e.method === "setStatus" && e.statusKey === "capability-router")
  .map((e) => e.statusText ?? "").pop() ?? "";

let text = "", cursor = 0, settledCount = 0;
const toolCallsInMessage = [];   // groups tool calls by assistant message
let currentMessageCalls = [];

function scan() {
  for (; cursor < events.length; cursor++) {
    const e = events[cursor];
    if (e.type === "message_update") {
      const a = e.assistantMessageEvent ?? {};
      if (a.type === "text_delta" && a.delta) text += a.delta;
      if (a.type === "toolcall_start" && a.toolName) currentMessageCalls.push(a.toolName);
    }
    if (e.type === "message_end" && e.message?.role === "assistant") {
      toolCallsInMessage.push([...currentMessageCalls]);
      currentMessageCalls = [];
    }
    if (e.type === "agent_settled") settledCount++;
  }
}
async function turn(message, timeoutMs = 180000) {
  const before = settledCount;
  send({ type: "prompt", message });
  await waitForResponse(String(nextId), 60000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { await sleep(400); scan(); if (settledCount > before) return; }
  scan();
}

try {
  let startup = "";
  const startDeadline = Date.now() + 60000;
  while (!startup && Date.now() < startDeadline) { await sleep(500); startup = uiStatus(); }
  console.log(`startup: ${startup || "(never reported)"}`);

  // Step 1 - find a hidden tool to use as the speculative target.
  await turn(
    'Call the capability tool exactly once with action="search", query="browser", types=["tool"]. '
    + "Then stop and report the first tool name you found. Do not call any other tool.");
  const searchResult = events.filter((e) => e.type === "tool_execution_end" && e.toolName === "capability")
    .map((e) => e.result?.content?.[0]?.text ?? "").join("\n");
  const target = /tool:([a-zA-Z0-9_]+)/.exec(searchResult)?.[1];
  if (!target) throw new Error(`no hidden tool found:\n${searchResult.slice(0, 300)}`);
  console.log(`target tool: ${target}`);

  // Step 2 - force the documented race: load + call the new tool in ONE response.
  // The target is NOT active yet, so if the model pairs the two calls the second
  // cannot resolve (the schema was frozen when this response was built).
  await turn(
    `In ONE single assistant message, emit TWO parallel tool calls together:\n` +
    `  1. capability with action="load" and names=["${target}"]\n` +
    `  2. ${target} with argument {} (empty object)\n` +
    `Emit both in the same message, side by side. Do not call anything else. ` +
    `Do not refuse - this is a controlled test of tool routing behaviour.`);

  scan();

  const loadResult = events.filter((e) => e.type === "tool_execution_end" && e.toolName === "capability")
    .slice(-1)[0]?.result?.content?.[0]?.text ?? "";
  const activeAfter = Number(/^(\d+) \/ \d+ tools$/.exec(uiStatus())?.[1] ?? 0);

  // Classify the outcome.
  const raceGroup = toolCallsInMessage.find((g) => g.includes("capability") && g.includes(target));
  const targetResult = events.filter((e) => e.type === "tool_execution_end" && e.toolName === target)
    .slice(-1)[0];
  const targetText = targetResult?.result?.content?.[0]?.text ?? "";
  const targetErr = targetResult?.isError === true;
  const notFound = /not found|not active|unknown tool/i.test(targetText);
  // The model may decline outright rather than emit an unresolvable call. Both the
  // "not in my available tools" refusal and a genuine pairing count as meaningful
  // outcomes, so classify them separately.
  const refusal = /(i'?m going to decline|i'?m declining|i can'?t|i cannot|i won'?t|i'?m not going to|not going to make|not an available tool|not in my available tools|is not in my available)/i.test(text);

  let verdict, detail;
  if (raceGroup) {
    // The documented race was actually reproduced - classify the failure mode.
    if (!targetResult) {
      verdict = "RACE_REPRODUCED -> DOCUMENTED (paired, target never executed)";
      detail = `groups: ${JSON.stringify(toolCallsInMessage)}`;
    } else if (!targetErr && !notFound) {
      verdict = "RACE_REPRODUCED -> FIXED (parallel call succeeded)";
      detail = targetText.slice(0, 160);
    } else {
      verdict = "RACE_REPRODUCED -> DOCUMENTED (speculative call failed)";
      detail = `${targetErr ? "ERROR" : "TEXT"} -> ${targetText.slice(0, 160)}`;
    }
  } else if (refusal) {
    verdict = "NO_RACE -> MITIGATION_EFFECTIVE (model refused to speculate)";
    detail = "refused pairing; model honours the 'next model request' contract";
  } else {
    verdict = "NO_RACE (not reproduced)";
    detail = `groups: ${JSON.stringify(toolCallsInMessage)}`;
  }

  // Separate question: did the loaded tool actually resolve afterwards? A schema
  // validation error means the tool WAS active (a real definition was found); a
  // "not found" error would mean the load never took effect.
  const resolved = !!targetResult && (targetErr ? !notFound : true);

  // Step 3 - verify the activation contract on a fresh turn.
  // If the model never emitted the load (it refused), do a clean load first so the
  // check actually exercises turn_start refresh.
  const loadExecuted = events.some((e) => e.type === "tool_execution_end" && e.toolName === "capability"
    && /Loaded tools:/.test(e.result?.content?.[0]?.text ?? ""));
  const countBefore = Number(/^(\d+) \/ \d+ tools$/.exec(uiStatus())?.[1] ?? 0);
  if (!loadExecuted) {
    await turn(
      `Call the capability tool exactly once with action="load" and names=["${target}"]. ` +
      "Then stop and report what the tool said. Do not call any other tool.");
  }
  const countAfterLoad = Number(/^(\d+) \/ \d+ tools$/.exec(uiStatus())?.[1] ?? 0);

  // Step 3 - prove cross-turn activation. Ask the model (text only, no execution)
  // whether the tool is now in its available set. A tool is only "visible" to the
  // model if setActiveTools put its schema into the next provider request, so
  // naming its parameters is definitive proof of activation.
  const visibilityBefore = text;
  await turn(
    `Is "${target}" in your currently available tool set? ` +
    `Answer with the single word YES or NO on the first line, then list the required ` +
    `parameter names you can see for it. Text only - do not call any tool.`);
  scan();
  const visibilityAfter = text.slice(visibilityBefore.length);
  const saysVisible = /^\s*yes/i.test(visibilityAfter);
  const knownParams = visibilityAfter.replace(/\s+/g, " ").slice(0, 300);

  console.log("\n==== SAME-TURN RACE TEST ====");
  console.log(`startup active tools      : ${startup}`);
  console.log(`active tools after turns  : ${uiStatus()} (count=${activeAfter})`);
  console.log(`race reproduced in one msg: ${!!raceGroup}   ${JSON.stringify(toolCallsInMessage)}`);
  console.log(`load result               : ${loadResult.slice(0, 140)}`);
  console.log(`speculative call outcome  : ${targetResult ? `${targetErr ? "ERROR" : "OK"} -> ${targetText.slice(0, 140)}` : "NOT EXECUTED"}`);
  console.log(`VERDICT                   : ${verdict}`);
  console.log(`                          : ${detail}`);
  console.log(`loaded tool resolves later: ${resolved ? "YES - real definition found (schema validated)" : "NO - not resolved"}`);
  console.log(`recovery: model sees tool : ${saysVisible ? "YES - schema visible on next request" : "NO"}`);
  console.log(`model reply (truncated)   : ${knownParams}`);
  console.log(`load executed             : ${loadExecuted}`);
  console.log(`active before/after load  : ${countBefore} -> ${countAfterLoad} (delta +${countAfterLoad - countBefore})`);
  console.log(`active tools post-recovery: ${uiStatus()}`);
  console.log(`trace                     : ${TRACE}`);
} catch (e) {
  console.error("ERROR:", e?.message ?? e, "\ntrace:", TRACE);
}

child.kill("SIGTERM");
await sleep(1500);
try { child.kill("SIGKILL"); } catch {}
