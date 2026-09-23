import type { ToolRecord } from "./registry.ts";

export interface MemoryDescriptor {
  id: string;
  type: "memory";
  name: string;
  description: string;
  toolName: string;
  keywords: string[];
}

const MEMORY_NAMES = new Set(["memory_search", "session_search"]);

/** Memory remains in its existing store. The router exposes only its retrieval tools. */
export class MemoryProvider {
  private tools = new Map<string, MemoryDescriptor>();

  refresh(tools: ToolRecord[]): void {
    this.tools.clear();
    for (const tool of tools) {
      if (!MEMORY_NAMES.has(tool.name)) continue;
      this.tools.set(tool.name, {
        id: `memory:${tool.name}`,
        type: "memory",
        name: tool.name,
        description: tool.name === "memory_search"
          ? "Retrieve prior decisions, preferences, project facts and failures from persistent memory."
          : "Find relevant past conversation sessions and their source anchors.",
        toolName: tool.name,
        keywords: ["previous", "earlier", "remember", "history", "before", "之前", "以前", "记忆", "历史"],
      });
    }
  }

  list(): MemoryDescriptor[] { return [...this.tools.values()]; }
  get(name: string): MemoryDescriptor | undefined { return this.tools.get(name); }
}

export function limitMemoryOutput(text: string, maxCharsPerResult: number, maxTotalChars: number): string {
  const sections = text.split(/\n\s*\n/);
  const kept: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const section of sections) {
    const normalized = section.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const piece = normalized.slice(0, maxCharsPerResult);
    const remaining = maxTotalChars - chars;
    if (remaining <= 0) break;
    const bounded = piece.slice(0, remaining);
    kept.push(bounded);
    chars += bounded.length;
  }
  const output = kept.join("\n\n").slice(0, maxTotalChars);
  return output.length < text.length ? `${output}\n[Memory output truncated to router limit.]` : output;
}
