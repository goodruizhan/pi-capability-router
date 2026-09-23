import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface RouterConfig {
  bootstrapTools: string[];
  showFooterStatus: boolean;
  searchLimit: number;
  skills: { mode: "safe" | "strict"; maxChars: number };
  mcp: { enabled: boolean };
  memory: { enabled: boolean; maxResults: number; maxCharsPerResult: number; maxTotalChars: number };
  context: { enabled: boolean; strictMode: boolean; maxInjectedChars: number; maxFiles: number; paths: string[] };
}

const DEFAULT_BOOTSTRAP = ["read", "bash", "edit", "write"];

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(Math.trunc(value), max))
    : fallback;
}

export function readConfig(agentDir: string): RouterConfig {
  let settings: any = {};
  try {
    settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  } catch {}
  const legacy = settings?.toolSearch ?? {};
  const router = settings?.capabilityRouter ?? {};
  const providers = router.providers ?? {};
  return {
    bootstrapTools: [
      ...new Set([
        ...(Array.isArray(router.bootstrapTools) ? stringArray(router.bootstrapTools) : DEFAULT_BOOTSTRAP),
        ...stringArray(legacy.alwaysEnabled),
      ]),
    ],
    showFooterStatus: router.showFooterStatus !== false && legacy.showToolSearchFooterStatus !== false && legacy.showFooterStatus !== false && legacy.showStatus !== false,
    searchLimit: boundedNumber(router.search?.limit, 8, 1, 20),
    skills: {
      mode: router.skills?.mode === "strict" ? "strict" : "safe",
      maxChars: boundedNumber(router.skills?.maxChars, 8000, 500, 20000),
    },
    mcp: { enabled: providers.mcp !== false },
    memory: {
      enabled: providers.memory !== false,
      maxResults: boundedNumber(router.memory?.maxResults, 5, 1, 20),
      maxCharsPerResult: boundedNumber(router.memory?.maxCharsPerResult, 2000, 100, 10000),
      maxTotalChars: boundedNumber(router.memory?.maxTotalChars, 6000, 500, 20000),
    },
    context: {
      enabled: providers.context !== false,
      strictMode: router.context?.strictMode === true,
      maxInjectedChars: boundedNumber(router.context?.maxInjectedChars, 8000, 500, 20000),
      maxFiles: boundedNumber(router.context?.maxFiles, 200, 1, 1000),
      paths: stringArray(router.context?.paths),
    },
  };
}
