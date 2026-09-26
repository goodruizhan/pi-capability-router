import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readConfig } from "./config.ts";
import { ContextProvider } from "./context-provider.ts";
import { McpProvider } from "./mcp-provider.ts";
import { MemoryProvider, limitMemoryOutput } from "./memory-provider.ts";
import { CapabilityRegistry, schemaChars } from "./registry.ts";
import { searchCapabilities, type SearchableCapability } from "./search.ts";
import { CapabilitySession } from "./session.ts";
import { SkillProvider, type PiSkill } from "./skill-provider.ts";

const DESCRIPTION = "Search hidden tools, skills, MCP, memory and project context. Load only what the task needs. Tool loads take effect on the next model request; skill and context loads return bounded source text.";
const PROMPT_SNIPPET = "When current tools or context are insufficient, use capability to search and load the minimum needed. Load new tools alone, then use them on the next response.";
type CapabilityType = SearchableCapability["type"];

export default function capabilityRouter(pi: ExtensionAPI) {
  const registry = new CapabilityRegistry();
  const session = new CapabilitySession();
  const skills = new SkillProvider();
  const mcp = new McpProvider();
  const memory = new MemoryProvider();
  const context = new ContextProvider();
  let config = readConfig(getAgentDir());
  let cwd = process.cwd();
  let piContextFiles: Array<{ path: string; content: string }> = [];
  let contextDiscovered = false;
  let skillCatalogChars = 0;
  let retrievedMemoryChars = 0;
  let retrievedMemoryCount = 0;
  let configWarning = "";
  let conflictWarning = "";
  // Observe sibling extensions without turning their activations into permanent
  // router-owned loads: their later deactivation must remain authoritative.
  const externalActive = new Set<string>();

  function syncExternalTools() {
    for (const name of externalActive) session.active.delete(name);
    externalActive.clear();
    for (const name of pi.getActiveTools()) {
      if (registry.get(name) && !session.active.has(name)) {
        externalActive.add(name);
        session.active.add(name);
      }
    }
  }

  function refreshTools() {
    const allTools = pi.getAllTools();
    registry.refresh(allTools);
    if (config.mcp.enabled) mcp.refresh(allTools);
    if (config.memory.enabled) memory.refresh(allTools);
  }

  function captureResources(options: {
    skills?: PiSkill[];
    contextFiles?: Array<{ path: string; content: string }>;
    cwd?: string;
  }) {
    const skillList = options.skills ?? [];
    skills.refresh(skillList);
    skillCatalogChars = skillList.reduce((sum, skill) => sum + skill.name.length + skill.description.length + skill.filePath.length, 0);
    piContextFiles = [...(options.contextFiles ?? [])];
    cwd = options.cwd || cwd;
    contextDiscovered = false;
  }

  function discoverContext() {
    if (!config.context.enabled || contextDiscovered) return;
    context.discover(cwd, piContextFiles, config.context.paths, config.context.maxFiles);
    contextDiscovered = true;
  }

  function activeIds(): Set<string> {
    const ids = new Set<string>([...skills.loaded].map((name) => `skill:${name}`));
    for (const id of context.loaded) ids.add(id);
    for (const name of session.active) {
      ids.add(`tool:${name}`);
      ids.add(`mcp:${name}`);
      ids.add(`memory:${name}`);
    }
    return ids;
  }

  function candidates(types?: CapabilityType[]): SearchableCapability[] {
    const selected = new Set(types?.length ? types : ["tool", "skill", "mcp", "memory", "context"]);
    if (selected.has("context")) discoverContext();
    const assigned = new Set([
      ...mcp.list().map((item) => item.toolName),
      ...memory.list().map((item) => item.toolName),
    ]);
    return [
      ...(selected.has("tool") ? registry.list().filter((item) => !assigned.has(item.name)) : []),
      ...(selected.has("skill") ? skills.list() : []),
      ...(selected.has("mcp") ? mcp.list() : []),
      ...(selected.has("memory") ? memory.list() : []),
      ...(selected.has("context") ? context.list() : []),
    ];
  }

  function search(query: string, types: CapabilityType[] | undefined, limit: number) {
    if (!types?.length || types.includes("context")) discoverContext();
    const hits = searchCapabilities(candidates(types), query, activeIds(), limit);
    return hits;
  }

  function applyActiveTools(ctx?: { ui: { setStatus(id: string, content: string | undefined): void } }, preserveExternal = true) {
    refreshTools();
    if (preserveExternal) syncExternalTools();
    const known = new Set(registry.list().map((item) => item.name));
    const active = [...session.active].filter((name) => known.has(name));
    pi.setActiveTools(["capability", ...active]);
    if (ctx) ctx.ui.setStatus("capability-router", config.showFooterStatus ? `${active.length + 1} / ${known.size + 1} tools` : undefined);
  }

  function routerSchemaChars(): number {
    const router = pi.getAllTools().find((tool) => tool.name === "capability");
    return router ? schemaChars(router) : 0;
  }

  function statsText(): string {
    const stats = session.stats(registry.list(), routerSchemaChars());
    return [
      "Capability Router Stats (schema JSON character estimates)",
      `Startup: ${stats.startupActiveToolCount} active tools / ${stats.startupToolSchemaChars} schema chars`,
      `Registered at startup: ${stats.startupRegisteredToolCount} tools / ${stats.startupRegisteredToolSchemaChars} schema chars`,
      `Current registered: ${stats.registeredToolCount} tools / ${stats.registeredToolSchemaChars} schema chars`,
      `Estimated avoided at startup: ${stats.estimatedAvoidedStartupChars} chars`,
      `Session: ${stats.activeToolCount} active tools / ${stats.activationCount} tool loads`,
      `Skills: ${skills.list().length} indexed / ${skills.loaded.size} loaded / ${skills.loadedChars} loaded chars / ${skillCatalogChars} catalog chars observed`,
      `MCP: ${mcp.list().length} adapter tools indexed`,
      `Memory: ${memory.list().length} retrieval tools / ${retrievedMemoryCount} retrievals / ${retrievedMemoryChars} result chars`,
      `Context: ${context.list().length} indexed / ${context.loaded.size} loaded / ${context.loadedChars} loaded chars`,
      ...(configWarning ? [`Config warning: ${configWarning}`] : []),
      ...(conflictWarning ? [`Conflict warning: ${conflictWarning}`] : []),
    ].join("\n");
  }

  function resolve(name: string, types?: CapabilityType[]): SearchableCapability | undefined {
    const all = candidates(types);
    const exact = all.find((item) => item.id === name);
    if (exact) return exact;
    const named = all.filter((item) => item.name === name);
    return named.length === 1 ? named[0] : undefined;
  }

  pi.registerTool({
    name: "capability",
    label: "Capability",
    description: DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    parameters: Type.Object({
      action: Type.Union([Type.Literal("search"), Type.Literal("load"), Type.Literal("status")]),
      query: Type.Optional(Type.String({ description: "Task or capability to search for; optional context load focus" })),
      names: Type.Optional(Type.Array(Type.String(), { description: "Exact capability IDs from search, or unambiguous names" })),
      types: Type.Optional(Type.Array(Type.Union([
        Type.Literal("tool"), Type.Literal("skill"), Type.Literal("mcp"), Type.Literal("memory"), Type.Literal("context"),
      ]))),
      limit: Type.Optional(Type.Number({ description: "Maximum search results (1-20)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      refreshTools();
      syncExternalTools();
      if (params.action === "status") {
        return { content: [{ type: "text", text: `Active tools: ${["capability", ...session.active].join(", ")}\nLoaded skills: ${[...skills.loaded].join(", ") || "none"}\nLoaded context: ${context.loaded.size}\n${statsText()}` }] };
      }
      if (params.action === "search") {
        const query = params.query?.trim();
        if (!query) return { content: [{ type: "text", text: "Provide a nonempty query for search." }] };
        const limit = params.limit === undefined ? config.searchLimit : Math.max(1, Math.min(Math.trunc(params.limit) || 1, 20));
        const hits = search(query, params.types, limit);
        const resultText = hits.length
          ? hits.map((hit, index) => `${index + 1}. ${hit.capability.id} [${hit.capability.type}] score=${hit.score.toFixed(2)}\n   ${hit.capability.description.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")
          : `No lexical matches for "${query}". Try broader wording or continue with current capabilities.`;
        return { content: [{ type: "text", text: resultText }] };
      }
      const names = params.names ?? [];
      if (!names.length) return { content: [{ type: "text", text: "Provide exact capability IDs from search for load." }] };
      const loadedTools: string[] = [];
      const outputs: string[] = [];
      const unknown: string[] = [];
      for (const name of [...new Set(names)]) {
        const item = resolve(name, params.types);
        if (!item) { unknown.push(name); continue; }
        if (item.type === "skill") outputs.push(skills.load(item.name, config.skills.maxChars).text);
        else if (item.type === "context") outputs.push(context.load(item.id, config.context.maxInjectedChars, params.query).text);
        else loadedTools.push(item.name);
      }
      const toolResult = session.load(loadedTools, registry.list());
      if (toolResult.enabled.length) {
        applyActiveTools();
        pi.sendMessage({
          customType: "capability-load-hint",
          content: `Capability load complete: ${toolResult.enabled.join(", ")} active. Continue the original task on the next model request. Retry only calls that failed because a tool was inactive.`,
          display: false,
          details: { enabled: toolResult.enabled },
        }, { deliverAs: ctx.isIdle() ? "followUp" : "steer", triggerTurn: true });
      }
      if (toolResult.enabled.length) outputs.push(`Loaded tools: ${toolResult.enabled.join(", ")}. Available on the next model request.`);
      if (toolResult.already.length) outputs.push(`Already active: ${toolResult.already.join(", ")}`);
      if (toolResult.unknown.length || unknown.length) outputs.push(`Unknown: ${[...toolResult.unknown, ...unknown].join(", ")}`);
      return { content: [{ type: "text", text: outputs.join("\n\n") || "Nothing changed." }] };
    },
  });

  pi.registerCommand("capability", {
    description: "Inspect capability router: status, stats, or search <query>",
    async handler(args, ctx) {
      refreshTools();
      syncExternalTools();
      captureResources(ctx.getSystemPromptOptions());
      const [action, ...rest] = args.trim().split(/\s+/);
      if (action === "stats") ctx.ui.notify(statsText(), "info");
      else if (action === "search" && rest.length) {
        const hits = search(rest.join(" "), undefined, config.searchLimit);
        ctx.ui.notify(hits.length ? hits.map((hit) => `${hit.capability.id} (${hit.score.toFixed(2)})`).join("\n") : "No matching hidden capabilities.", "info");
      } else if (!action || action === "status") {
        ctx.ui.notify(`Active: ${["capability", ...session.active].join(", ")}\n${statsText()}`, "info");
      } else ctx.ui.notify("Usage: /capability status | stats | search <query>", "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    configWarning = "";
    config = readConfig(getAgentDir(), (message) => { configWarning = message; });
    cwd = ctx.cwd || process.cwd();
    skills.reset();
    context.reset();
    piContextFiles = [];
    contextDiscovered = false;
    skillCatalogChars = 0;
    retrievedMemoryChars = 0;
    retrievedMemoryCount = 0;
    refreshTools();
    conflictWarning = pi.getAllTools().some((tool) => tool.name === "tool_search")
      ? "pi-tool-search also registered tool_search; both extensions control active tools. Disable one of them."
      : "";
    externalActive.clear();
    session.reset(config.bootstrapTools, registry.list(), routerSchemaChars());
    // Startup gating deliberately ignores the host's initially eager tool set.
    applyActiveTools(ctx, false);
    ctx.ui.setStatus("capability-router-config", configWarning || undefined);
    ctx.ui.setStatus("capability-router-conflict", conflictWarning || undefined);
  });

  pi.on("before_agent_start", (event) => {
    captureResources(event.systemPromptOptions);
    if (config.skills.mode === "strict") event.systemPromptOptions.skills = [];
    piContextFiles = [...event.systemPromptOptions.contextFiles];
    cwd = event.systemPromptOptions.cwd;
    contextDiscovered = false;
    if (config.context.strictMode) event.systemPromptOptions.contextFiles = [];
  });

  pi.on("turn_start", (_event, ctx) => applyActiveTools(ctx));

  pi.on("tool_call", (event) => {
    if (!config.memory.enabled || event.toolName !== "memory_search") return;
    const input = event.input as Record<string, unknown>;
    const requested = typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : config.memory.maxResults;
    input.limit = Math.max(1, Math.min(Math.trunc(requested), config.memory.maxResults));
  });

  pi.on("tool_result", (event) => {
    if (!config.memory.enabled || (event.toolName !== "memory_search" && event.toolName !== "session_search")) return;
    const opening = `<retrieved-memory source="${event.toolName}">\n`;
    const closing = "\n</retrieved-memory>";
    const budget = Math.max(1, config.memory.maxTotalChars - opening.length - closing.length);
    const raw = event.content.filter((block) => block.type === "text").map((block) => block.text).join("\n\n");
    const bounded = limitMemoryOutput(
      raw,
      event.toolName === "session_search" ? budget : config.memory.maxCharsPerResult,
      budget,
    ).slice(0, budget);
    const content = [{ type: "text" as const, text: `${opening}${bounded}${closing}` }, ...event.content.filter((block) => block.type !== "text")];
    retrievedMemoryCount++;
    retrievedMemoryChars += content.reduce((sum, block) => sum + (block.type === "text" ? block.text.length : 0), 0);
    return { content };
  });
}
