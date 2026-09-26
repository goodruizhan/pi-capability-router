// Explicit opt-in real-model SDK probe. JSON output contains no raw provider responses or credentials.
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ECHO, classifyProviderFailure, inspectStage, parseOptions } from "./model-smoke-contract.mjs";

let options;
try { options = parseOptions(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 2; }

if (options) {
  const dir = mkdtempSync(join(tmpdir(), "router-model-probe-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  if (options.list) process.env.PI_OFFLINE = "1";
  const output = { mode: options.list ? "list" : "live", models: [] };
  let session;
  try {
    const hostUrl = process.env.PI_HOST_MODULE ? new URL(process.env.PI_HOST_MODULE) : new URL(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const host = await import(hostUrl.href);
    const sourceAgentDir = host.getAgentDir();
    const { AuthStorage, ReadOnlyAuthStorage } = await import(new URL("./core/auth-storage.js", hostUrl));
    const { InMemoryCodingAgentModelsStore } = await import(new URL("./core/models-store.js", hostUrl));
    const credentialsOnDisk = new ReadOnlyAuthStorage(join(sourceAgentDir, "auth.json"));
    process.env.PI_CODING_AGENT_DIR = dir;
    const settingsManager = host.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ capabilityRouter: { bootstrapTools: [], providers: { mcp: false, memory: false, context: false } } }));
    const makeRuntime = (credentials, listing = false) => host.ModelRuntime.create({ credentials, modelsPath: join(sourceAgentDir, "models.json"), modelsStore: new InMemoryCodingAgentModelsStore(), allowModelNetwork: false, refreshOnCreate: !listing });
    if (options.list) {
      const modelRuntime = await makeRuntime(AuthStorage.inMemory(), true);
      output.models = modelRuntime.getModels().map((m) => ({ provider: m.provider, id: m.id }));
    } else {
      const routerPath = fileURLToPath(new URL("../extensions/index.ts", import.meta.url));
      const providerPaths = options.providers.map((p) => {
        if (!isAbsolute(p) || !existsSync(p)) throw new Error("provider extension must be an existing absolute path");
        return resolve(p);
      });
      for (const [modelIndex, requested] of options.models.entries()) {
        session = undefined;
        const record = { provider: requested.provider, model: requested.id, status: "failed", stage: "preflight", classification: "unavailable", stages: [] };
        output.models.push(record);
        const started = Date.now();
        let deadline;
        let unsubscribe;
        let entrySession;
        let modelRequests = 0;
        let expired = false;
        const timeout = new Promise((_, reject) => { deadline = setTimeout(() => {
          expired = true;
          void entrySession?.abort().catch(() => {});
          reject(new Error("probe_timeout"));
        }, options.timeoutMs); });
        const bounded = (operation, disposeLate) => Promise.race([Promise.resolve(operation).then((value) => {
          if (expired) { disposeLate?.(value); throw new Error("probe_timeout"); }
          return value;
        }), timeout]);
        try {
          const nonce = randomUUID();
          const receipt = randomUUID(); // Never included in the prompt: only a real tool result reveals it.
          // Fresh runtime per model avoids provider registration leaking across matrix entries.
          const credential = await bounded(credentialsOnDisk.read(requested.provider));
          const credentials = AuthStorage.inMemory(credential ? { [requested.provider]: credential } : {});
          const modelRuntime = await bounded(makeRuntime(credentials, !providerPaths.length));
          // A missing built-in/configured model needs no session or ambient auth checks.
          if (!providerPaths.length && !modelRuntime.getModel(requested.provider, requested.id)) {
            record.classification = "model_not_found"; continue;
          }
          const loader = new host.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager,
            noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
            additionalExtensionPaths: [routerPath, ...providerPaths],
            extensionFactories: [(pi) => {
              pi.on("tool_call", (event) => !["capability", ECHO].includes(event.toolName)
                ? { block: true, reason: "Only capability and probe echo are permitted" } : undefined);
              pi.registerTool({ name: ECHO, label: "Probe echo", description: "Echo a supplied value exactly; no side effects.",
                parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
                execute: async (_id, args) => ({ content: [{ type: "text", text: `ECHO:${args.value} RECEIPT:${receipt}` }], details: {} }),
              });
            }],
          });
          await bounded(loader.reload());
          if (loader.getExtensions().errors.length) throw new Error("extension_load_error");
          ({ session: entrySession } = await bounded(host.createAgentSession({ cwd: dir, agentDir: dir, settingsManager, modelRuntime, resourceLoader: loader,
            sessionManager: host.SessionManager.inMemory(dir), model: modelRuntime.getModel(requested.provider, requested.id),
            thinkingLevel: "off", tools: ["capability", ECHO],
            excludeTools: ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"] }),
          ({ session: late }) => late.dispose()));
          session = entrySession;
          const events = [];
          unsubscribe = session.subscribe((event) => {
            if (["tool_execution_start", "tool_execution_end", "message_end"].includes(event.type)) events.push(event);
          });
          const extensionErrors = [];
          session.extensionRunner.onError((event) => extensionErrors.push(event));
          await bounded(session.bindExtensions({}));
          const model = modelRuntime.getModel(requested.provider, requested.id);
          if (!model) { record.classification = "model_not_found"; continue; }
          if (!(await bounded(modelRuntime.getAvailable(requested.provider))).some((m) => m.provider === requested.provider && m.id === requested.id)) {
            record.classification = "auth_unavailable"; continue;
          }
          await bounded(session.setModel(model));
          const streamSimple = modelRuntime.streamSimple.bind(modelRuntime);
          modelRuntime.streamSimple = (...args) => {
            if (++modelRequests > 9) throw new Error("probe_turn_limit");
            return streamSimple(...args);
          };
          if (session.model?.provider !== requested.provider || session.model?.id !== requested.id) { record.classification = "model_mismatch"; continue; }
          if (session.getActiveToolNames().some((name) => name !== "capability")) { record.classification = "unsafe_tools_active"; continue; }
          record.stage = "search";
          const prompts = [
            `Call capability once with action search, query ${ECHO}, types [tool]. Do not call any other tool.`,
            `Call capability once with action load, names [tool:${ECHO}]. Do not call any other tool.`,
            `Call ${ECHO} with value exactly ${nonce}. Read RECEIPT from the tool result, then reply exactly ACK:<the RECEIPT value>. Do not call any other tool.`,
          ];
          for (const [index, name] of ["search", "load", "call"].entries()) {
            record.stage = name;
            if (session.getActiveToolNames().some((tool) => !["capability", ECHO].includes(tool))) {
              record.classification = "unsafe_tools_active"; break;
            }
            if (name === "call" && !session.getActiveToolNames().includes(ECHO)) {
              record.classification = "echo_not_active"; break;
            }
            const first = events.length;
            await bounded(session.prompt(prompts[index]));
            const proof = inspectStage({ name, provider: requested.provider, model: requested.id }, events.slice(first), nonce, receipt);
            record.stages.push({ stage: name, ...proof });
            if (modelRequests > 9) { record.classification = "turn_limit"; break; }
            if (extensionErrors.length) { record.classification = "extension_error"; break; }
            if (!proof.ok) { record.classification = proof.classification; break; }
          }
          if (record.stages.length === 3 && record.stages.every((s) => s.ok)) { record.status = "passed"; record.classification = "passed"; }
        } catch (error) {
          // Provider errors can contain response payloads or auth; classify without printing the exception.
          record.classification = error?.message === "probe_timeout" ? "timeout" : modelRequests > 9 || error?.message === "probe_turn_limit" ? "turn_limit"
            : error?.message === "extension_load_error" ? "extension_load_error" : "runtime_error";
          if (record.classification === "runtime_error") record.diagnostic = classifyProviderFailure(error);
        } finally {
          clearTimeout(deadline);
          unsubscribe?.();
          entrySession?.dispose();
          session = undefined;
          record.modelRequests = Math.min(modelRequests, 9);
          if (modelRequests > 9) record.blockedRequests = modelRequests - 9;
          record.latencyMs = Date.now() - started;
        }
        if (record.classification === "extension_load_error") {
          output.infrastructureError = "extension_load_error";
          for (const remaining of options.models.slice(modelIndex + 1)) output.models.push({ provider: remaining.provider, model: remaining.id, status: "skipped", stage: "preflight", classification: "infrastructure_stopped", stages: [] });
          break;
        }
      }
    }
  } catch {
    output.infrastructureError = "setup_failed (check host module, isolated storage, or provider paths)";
  } finally {
    session?.dispose();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
    rmSync(dir, { recursive: true, force: true });
    console.log(JSON.stringify(output, null, 2));
    if (output.infrastructureError || (!options.list && output.models.some((m) => m.status !== "passed"))) process.exitCode = 1;
  }
}
