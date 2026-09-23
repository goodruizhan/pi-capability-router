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

export function readConfig(agentDir: string, warn: (message: string) => void = () => {}): RouterConfig {
  let settings: any = {};
  const path = join(agentDir, "settings.json");
  try {
    settings = JSON.parse(readFileSync(path, "utf8"));
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      warn(`Invalid settings object in ${path}; using router defaults.`);
      settings = {};
    } else if (settings.capabilityRouter !== undefined &&
      (!settings.capabilityRouter || typeof settings.capabilityRouter !== "object" || Array.isArray(settings.capabilityRouter))) {
      warn(`Invalid capabilityRouter configuration in ${path}; using router defaults.`);
    }
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT")
      warn(`Cannot read router settings in ${path}: ${error instanceof Error ? error.message : String(error)}; using defaults.`);
  }
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
