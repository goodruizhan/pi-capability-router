export const ECHO = "router_probe_echo";
export const SEARCH = { action: "search", query: ECHO, types: ["tool"] };
export const LOAD = { action: "load", names: [`tool:${ECHO}`] };

export function parseOptions(args) {
  const options = { models: [], providers: [], list: false, live: false, timeoutMs: 90000 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model") {
      const value = args[++i];
      const slash = value?.indexOf("/") ?? -1;
      if (slash < 1 || slash === value.length - 1) throw new Error("--model requires provider/model-id");
      options.models.push({ provider: value.slice(0, slash), id: value.slice(slash + 1) });
    } else if (arg === "--provider-extension") {
      const value = args[++i];
      if (!value) throw new Error("--provider-extension requires an absolute file path");
      options.providers.push(value);
    } else if (arg === "--timeout-ms") {
      const value = Number(args[++i]);
      if (!Number.isSafeInteger(value) || value < 1000 || value > 300000) throw new Error("--timeout-ms must be 1000..300000");
      options.timeoutMs = value;
    } else if (arg === "--list") options.list = true;
    else if (arg === "--live") options.live = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  // A bare run defaults to the offline `--list` mode instead of a usage
  // error: the live probe must stay explicit, but plain `npm run test:models`
  // should still be useful. Any explicit option still requires an explicit mode.
  if (args.length === 0 && !options.list && !options.live) options.list = true;
  if (options.list === options.live)
    throw new Error("Use --list (no provider extensions) OR --live --model provider/id [--model ...]");
  if (options.live && !options.models.length)
    throw new Error("--live requires --model provider/id [--model ...]");
  if (options.list && options.providers.length)
    throw new Error("--list accepts no provider extensions");
  return options;
}

// Never emit an arbitrary provider error/body. Only a fixed category, a recognizable
// transport code, and an HTTP status explicitly labeled or in this narrow allowlist.
export function classifyProviderFailure(error) {
  const message = typeof error === "string" ? error : error?.errorMessage ?? error?.message ?? "";
  const text = String(message).slice(0, 4096);
  const explicitStatus = Number(error?.status ?? error?.statusCode);
  const labeled = /\b(?:HTTP(?:\/\d(?:\.\d)?)?\s*|status(?:\s+code)?\s*[:=]?\s*)([1-5]\d\d)\b/i.exec(text);
  const common = /\b(400|401|402|403|404|408|409|413|422|425|429|500|502|503|504)\b/.exec(text);
  const httpStatus = Number.isInteger(explicitStatus) && explicitStatus >= 100 && explicitStatus <= 599
    ? explicitStatus : labeled ? Number(labeled[1]) : common ? Number(common[1]) : undefined;
  const code = /\b(EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)\b/i.exec(text)?.[1]?.toUpperCase();
  const category = httpStatus === 401 || httpStatus === 403 || /\b(unauthorized|invalid.api.key|authentication failed|expired token)\b/i.test(text) ? "auth"
    : httpStatus === 402 || /\b(payment required|billing|insufficient (?:balance|credits?))\b/i.test(text) ? "billing"
    : httpStatus === 429 || /\b(rate.limit|too many requests|quota exceeded)\b/i.test(text) ? "rate_limit"
    : /\b(thinking|reasoning)\b/i.test(text) && /\b(unsupported|not supported|invalid|not available)\b/i.test(text) ? "unsupported_thinking"
    : /\b(model unavailable|model not found|unknown model|unsupported model|model not supported|model does not exist|no such model)\b/i.test(text) ? "model_unavailable"
    : httpStatus === 408 || httpStatus === 504 || /\b(timed? out|timeout)\b/i.test(text) ? "timeout"
    : code || /\b(fetch failed|network error|connection failed)\b/i.test(text) ? "network"
    : /\b(unsupported|not supported)\b/i.test(text) || httpStatus === 404 ? "unsupported"
    : httpStatus === 400 || httpStatus === 422 ? "invalid_request"
    : httpStatus && httpStatus >= 500 ? "server_error" : "unknown";
  return { category, ...(httpStatus ? { httpStatus } : {}), ...(code ? { code } : {}) };
}

export function inspectStage(stage, events, nonce, receipt) {
  const calls = events.filter((e) => e.type === "tool_execution_start");
  const ends = events.filter((e) => e.type === "tool_execution_end");
  const assistants = events.filter((e) => e.type === "message_end" && e.message?.role === "assistant");
  const wrongModel = assistants.some((e) => e.message.provider !== stage.provider || e.message.model !== stage.model);
  const error = assistants.find((e) => ["error", "aborted"].includes(e.message.stopReason));
  const target = stage.name === "call" ? ECHO : "capability";
  const args = stage.name === "search" ? SEARCH : stage.name === "load" ? LOAD : { value: nonce };
  const matching = calls.find((e) => e.toolName === target && e.args && Object.keys(args).length === Object.keys(e.args).length
    && Object.entries(args).every(([key, value]) => JSON.stringify(e.args[key]) === JSON.stringify(value)));
  const completed = matching && ends.find((e) => e.toolCallId === matching.toolCallId && e.toolName === target && !e.isError);
  const result = completed?.result?.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";
  const expected = stage.name === "search" ? `tool:${ECHO}` : stage.name === "load" ? `Loaded tools: ${ECHO}` : `ECHO:${nonce}`;
  const unexpected = calls.some((e) => !["capability", ECHO].includes(e.toolName));
  const extra = calls.length !== 1 || ends.length !== 1 || !matching || !completed || events.indexOf(completed) < events.indexOf(matching);
  const lastAssistant = assistants.at(-1);
  const lastText = lastAssistant?.message.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim() ?? "";
  const consumed = stage.name !== "call" || (result.includes(`RECEIPT:${receipt}`)
    && lastText === `ACK:${receipt}` && events.indexOf(lastAssistant) > events.indexOf(completed));
  const classification = wrongModel ? "model_mismatch" : unexpected ? "unsafe_tool_attempt" : error ? "model_error"
    : !assistants.length ? "missing_assistant" : !matching ? "tool_not_called" : extra ? "unexpected_tool_calls"
    : !result.includes(expected) ? "unexpected_result" : !consumed ? "result_not_consumed" : "passed";
  return { ok: classification === "passed", classification,
    ...(error ? { diagnostic: classifyProviderFailure(error.message) } : {}),
    toolEvents: calls.map((e) => ({ name: e.toolName, args: e === matching ? args : undefined,
      argumentsMatch: e === matching, toolCallId: e.toolCallId,
      completed: !!ends.find((end) => end.toolCallId === e.toolCallId && !end.isError),
      isError: ends.find((end) => end.toolCallId === e.toolCallId)?.isError ?? null })),
    assistantRequests: assistants.length, usage: assistants.map((e) => e.message.usage).filter(Boolean) };
}
