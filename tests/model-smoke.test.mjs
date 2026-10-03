import assert from "node:assert/strict";
import { test } from "node:test";
import { ECHO, classifyProviderFailure, inspectStage, parseOptions } from "../scripts/model-smoke-contract.mjs";

const model = { provider: "test", model: "exact-model" };
const nonce = "sample-nonce";
const receipt = "tool-only-receipt";
function events(name, args, result, text = "") {
  const toolName = name === "call" ? ECHO : "capability";
  return [
    { type: "tool_execution_start", toolName, toolCallId: "id", args },
    { type: "tool_execution_end", toolName, toolCallId: "id", isError: false, result: { content: [{ type: "text", text: result }] } },
    { type: "message_end", message: { role: "assistant", provider: model.provider, model: model.model, content: [{ type: "text", text }], stopReason: "stop", usage: { input: 3 } } },
  ];
}
test("explicit live opt-in is required; a bare run defaults to offline list", () => {
  assert.deepEqual(parseOptions(["--live", "--model", "p/id/with/slashes"]).models, [{ provider: "p", id: "id/with/slashes" }]);
  assert.throws(() => parseOptions(["--live"]));
  assert.throws(() => parseOptions(["--model", "p/id"]));
  assert.throws(() => parseOptions(["--list", "--provider-extension", "/tmp/x"]));
  assert.throws(() => parseOptions(["--live", "--model", "wrong"]));
  assert.throws(() => parseOptions(["--live", "--model", "p/id", "--timeout-ms", "0"]));
  // A bare run is useful instead of a usage error: offline list mode.
  assert.equal(parseOptions([]).list, true);
  assert.equal(parseOptions([]).live, false);
  assert.throws(() => parseOptions(["--list", "--live"]));
});
test("search, separate load, exact validated echo and nonce consumption", () => {
  assert.equal(inspectStage({ ...model, name: "search" }, events("search", { types: ["tool"], query: ECHO, action: "search" }, `1. tool:${ECHO} [tool]`), nonce).ok, true);
  assert.equal(inspectStage({ ...model, name: "load" }, events("load", { action: "load", names: [`tool:${ECHO}`] }, `Loaded tools: ${ECHO}. Available on the next model request.`), nonce).ok, true);
  const call = events("call", { value: nonce }, `ECHO:${nonce} RECEIPT:${receipt}`, `ACK:${receipt}`);
  assert.equal(inspectStage({ ...model, name: "call" }, call, nonce, receipt).ok, true);
  assert.equal(inspectStage({ ...model, name: "call" }, events("call", { value: nonce }, `ECHO:${nonce} RECEIPT:${receipt}`, `ACK:${nonce}`), nonce, receipt).classification, "result_not_consumed");
  assert.equal(inspectStage({ ...model, name: "call" }, call.map((e) => e.type === "message_end" ? { ...e, message: { ...e.message, content: [] } } : e), nonce, receipt).classification, "result_not_consumed");
  assert.equal(inspectStage({ ...model, name: "call" }, events("call", { value: "wrong" }, `ECHO:${nonce}`, `ACK:${receipt}`), nonce, receipt).classification, "tool_not_called");
  assert.equal(inspectStage({ ...model, name: "call" }, call.map((e) => e.type === "message_end" ? { ...e, message: { ...e.message, model: "other" } } : e), nonce, receipt).classification, "model_mismatch");
  assert.equal(inspectStage({ ...model, name: "call" }, [...call, { type: "tool_execution_start", toolName: "bash", toolCallId: "unsafe", args: {} }], nonce, receipt).classification, "unsafe_tool_attempt");
  const wrongThenRight = [{ type: "tool_execution_start", toolName: ECHO, toolCallId: "wrong", args: { value: "wrong" } }, ...call];
  assert.equal(inspectStage({ ...model, name: "call" }, wrongThenRight, nonce, receipt).ok, false);
  const repeated = [...call, { type: "tool_execution_start", toolName: ECHO, toolCallId: "repeat", args: { value: nonce } }];
  assert.equal(inspectStage({ ...model, name: "call" }, repeated, nonce, receipt).ok, false);
  const failedThenRight = [{ type: "tool_execution_start", toolName: ECHO, toolCallId: "failed", args: { value: nonce } },
    { type: "tool_execution_end", toolName: ECHO, toolCallId: "failed", isError: true }, ...call];
  assert.equal(inspectStage({ ...model, name: "call" }, failedThenRight, nonce, receipt).ok, false);
  const preCallAck = [{ type: "message_end", message: { ...call[2].message, content: [{ type: "text", text: `ACK:${receipt}` }] } },
    ...call.slice(0, 2), { ...call[2], message: { ...call[2].message, content: [{ type: "text", text: "done" }] } }];
  assert.equal(inspectStage({ ...model, name: "call" }, preCallAck, nonce, receipt).classification, "result_not_consumed");
  const failedSearch = [{ type: "tool_execution_start", toolName: "capability", toolCallId: "bad", args: { action: "status" } },
    ...events("search", { action: "search", query: ECHO, types: ["tool"] }, `1. tool:${ECHO} [tool]`)];
  assert.equal(inspectStage({ ...model, name: "search" }, failedSearch, nonce).ok, false);
});
test("provider diagnostics expose only narrow status/code/category, never raw auth or response", () => {
  assert.deepEqual(classifyProviderFailure({ errorMessage: "HTTP 401 unauthorized: bearer SECRET_KEY response-body" }), { category: "auth", httpStatus: 401 });
  assert.deepEqual(classifyProviderFailure({ errorMessage: "status: 429 quota exceeded SECRET_KEY" }), { category: "rate_limit", httpStatus: 429 });
  assert.deepEqual(classifyProviderFailure({ errorMessage: "HTTP 402 payment required SECRET_KEY" }), { category: "billing", httpStatus: 402 });
  assert.deepEqual(classifyProviderFailure({ errorMessage: "insufficient balance: SECRET_KEY" }), { category: "billing" });
  assert.deepEqual(classifyProviderFailure({ errorMessage: "HTTP 404 model unavailable SECRET_KEY" }), { category: "model_unavailable", httpStatus: 404 });
  assert.deepEqual(classifyProviderFailure({ errorMessage: "Unsupported model: SECRET_KEY" }), { category: "model_unavailable" });
  assert.deepEqual(classifyProviderFailure({ errorMessage: "HTTP 400 unsupported parameter: function_call SECRET_KEY" }), { category: "unsupported", httpStatus: 400 });
  assert.deepEqual(classifyProviderFailure({ errorMessage: "thinking not supported: confidential response" }), { category: "unsupported_thinking" });
  assert.deepEqual(classifyProviderFailure({ errorMessage: "fetch failed ENOTFOUND at private host" }), { category: "network", code: "ENOTFOUND" });
  const failed = events("search", { action: "search", query: ECHO, types: ["tool"] }, `tool:${ECHO}`);
  failed[2].message.stopReason = "error";
  failed[2].message.errorMessage = "HTTP 403 SECRET_KEY";
  assert.deepEqual(inspectStage({ ...model, name: "search" }, failed, nonce).diagnostic, { category: "auth", httpStatus: 403 });
});
