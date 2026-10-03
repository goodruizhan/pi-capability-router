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

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  warn?: (message: string) => void,
  name = "value",
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    warn?.(`Invalid ${name}: expected a finite number, got ${JSON.stringify(value)}; using ${fallback}.`);
    return fallback;
  }
  return Math.max(min, Math.min(Math.trunc(value), max));
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
  const bounded = (value: unknown, fallback: number, min: number, max: number, name: string): number =>
    boundedNumber(value, fallback, min, max, warn, name);
  return {
    bootstrapTools: [
      ...new Set([
        ...(Array.isArray(router.bootstrapTools) ? stringArray(router.bootstrapTools) : DEFAULT_BOOTSTRAP),
        ...stringArray(legacy.alwaysEnabled),
      ]),
    ],
    showFooterStatus: router.showFooterStatus !== false && legacy.showToolSearchFooterStatus !== false && legacy.showFooterStatus !== false && legacy.showStatus !== false,
    searchLimit: bounded(router.search?.limit, 14, 1, 20, "capabilityRouter.search.limit"),
    skills: {
      mode: router.skills?.mode === "strict" ? "strict" : "safe",
      maxChars: bounded(router.skills?.maxChars, 8000, 500, 20000, "capabilityRouter.skills.maxChars"),
    },
    mcp: { enabled: providers.mcp !== false },
    memory: {
      enabled: providers.memory !== false,
      maxResults: bounded(router.memory?.maxResults, 5, 1, 20, "capabilityRouter.memory.maxResults"),
      maxCharsPerResult: bounded(router.memory?.maxCharsPerResult, 2000, 100, 10000, "capabilityRouter.memory.maxCharsPerResult"),
      maxTotalChars: bounded(router.memory?.maxTotalChars, 6000, 500, 20000, "capabilityRouter.memory.maxTotalChars"),
    },
    context: {
      enabled: providers.context !== false,
      strictMode: router.context?.strictMode === true,
      maxInjectedChars: bounded(router.context?.maxInjectedChars, 8000, 500, 20000, "capabilityRouter.context.maxInjectedChars"),
      maxFiles: bounded(router.context?.maxFiles, 200, 1, 1000, "capabilityRouter.context.maxFiles"),
      paths: stringArray(router.context?.paths),
    },
  };
}
