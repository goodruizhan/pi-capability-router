import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CapabilityRegistry, schemaChars } from "./registry.ts";
import { searchTools } from "./search.ts";
import { CapabilitySession } from "./session.ts";

const DEFAULT_BOOTSTRAP = ["read", "bash", "edit", "write"];
const DESCRIPTION = "Search hidden tools by task, load only the tool names needed, or inspect active tools. Search before loading. Loaded tools become available on the next model request; call capability alone when loading.";
const PROMPT_SNIPPET = "If current tools are insufficient, use capability to search and load the minimum needed tools. Call capability load alone, then use the loaded tools in the next response.";

interface RouterConfig {
  bootstrapTools: string[];
  showFooterStatus: boolean;
  searchLimit: number;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readConfig(): RouterConfig {
  try {
    const settings = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8"));
    const legacy = settings?.toolSearch ?? {};
    const router = settings?.capabilityRouter ?? {};
    const limit = router?.search?.limit;
    return {
      bootstrapTools: [
        ...new Set([
          ...(Array.isArray(router.bootstrapTools) ? stringArray(router.bootstrapTools) : DEFAULT_BOOTSTRAP),
          ...stringArray(legacy.alwaysEnabled),
        ]),
      ],
      showFooterStatus: router.showFooterStatus !== false && legacy.showToolSearchFooterStatus !== false && legacy.showFooterStatus !== false && legacy.showStatus !== false,
      searchLimit: Number.isInteger(limit) ? Math.max(1, Math.min(limit, 20)) : 8,
    };
  } catch {
    return { bootstrapTools: DEFAULT_BOOTSTRAP, showFooterStatus: true, searchLimit: 8 };
  }
}

export default function capabilityRouter(pi: ExtensionAPI) {
  const registry = new CapabilityRegistry();
  const session = new CapabilitySession();
  let config = readConfig();

  function refreshRegistry() {
    registry.refresh(pi.getAllTools());
  }

  function applyActiveTools(ctx?: { ui: { setStatus(id: string, content: string | undefined): void } }) {
    refreshRegistry();
    const known = new Set(registry.list().map((capability) => capability.name));
    const active = [...session.active].filter((name) => known.has(name));
    pi.setActiveTools(["capability", ...active]);
    if (ctx) {
      ctx.ui.setStatus(
        "capability-router",
        config.showFooterStatus ? `${active.length + 1} / ${known.size + 1} tools` : undefined,
      );
    }
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
      `Session: ${stats.activeToolCount} active tools / ${stats.activeToolSchemaChars} schema chars / ${stats.activationCount} loads`,
    ].join("\n");
  }

  pi.registerTool({
    name: "capability",
    label: "Capability",
    description: DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    parameters: Type.Object({
      action: Type.Union([Type.Literal("search"), Type.Literal("load"), Type.Literal("status")]),
      query: Type.Optional(Type.String({ description: "Task or tool to search for" })),
      names: Type.Optional(Type.Array(Type.String(), { description: "Exact tool names returned by search" })),
      types: Type.Optional(Type.Array(Type.Literal("tool"), { description: "V0.1 supports tools only" })),
      limit: Type.Optional(Type.Number({ description: "Maximum search results (1-20)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      refreshRegistry();
      if (params.action === "status") {
        return { content: [{ type: "text", text: `Active tools: ${["capability", ...session.active].join(", ")}\n${statsText()}` }] };
      }
      if (params.action === "search") {
        const query = params.query?.trim();
        if (!query) return { content: [{ type: "text", text: "Provide a nonempty query for search." }] };
        const limit = params.limit === undefined ? config.searchLimit : Math.max(1, Math.min(Math.trunc(params.limit) || 1, 20));
        const hits = searchTools(registry.list(), query, session.active, limit);
        const resultText = hits.length
          ? hits.map((hit, index) => `${index + 1}. ${hit.capability.name} [tool] score=${hit.score.toFixed(2)}\n   ${hit.capability.description.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")
          : `No matching hidden tools for "${query}". Try broader wording or continue with current tools.`;
        return { content: [{ type: "text", text: resultText }] };
      }
      const names = params.names ?? [];
      if (!names.length) return { content: [{ type: "text", text: "Provide exact tool names from search for load." }] };
      const result = session.load(names, registry.list());
      if (result.enabled.length) {
        applyActiveTools();
        pi.sendMessage({
          customType: "capability-load-hint",
          content: `Capability load complete: ${result.enabled.join(", ")} active. Continue the original task on the next model request. Retry only tool calls that failed because a tool was inactive.`,
          display: false,
          details: { enabled: result.enabled },
        }, { deliverAs: ctx.isIdle() ? "followUp" : "steer", triggerTurn: true });
      }
      const lines = [
        result.enabled.length ? `Loaded: ${result.enabled.join(", ")}. Available on the next model request.` : "No new tools loaded.",
        result.already.length ? `Already active: ${result.already.join(", ")}` : "",
        result.unknown.length ? `Unknown: ${result.unknown.join(", ")}` : "",
      ].filter(Boolean);
      return { content: [{ type: "text", text: lines.join("\n") }], details: result };
    },
  });

  pi.registerCommand("capability", {
    description: "Inspect capability router: status, stats, or search <query>",
    async handler(args, ctx) {
      refreshRegistry();
      const [action, ...rest] = args.trim().split(/\s+/);
      if (action === "stats") ctx.ui.notify(statsText(), "info");
      else if (action === "search" && rest.length) {
        const hits = searchTools(registry.list(), rest.join(" "), session.active, config.searchLimit);
        ctx.ui.notify(hits.length ? hits.map((hit) => `${hit.capability.name} (${hit.score.toFixed(2)})`).join("\n") : "No matching hidden tools.", "info");
      } else if (!action || action === "status") {
        ctx.ui.notify(`Active: ${["capability", ...session.active].join(", ")}\n${statsText()}`, "info");
      } else ctx.ui.notify("Usage: /capability status | stats | search <query>", "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    config = readConfig();
    refreshRegistry();
    session.reset(config.bootstrapTools, registry.list(), routerSchemaChars());
    applyActiveTools(ctx);
  });

  pi.on("turn_start", (_event, ctx) => {
    applyActiveTools(ctx);
  });
}
