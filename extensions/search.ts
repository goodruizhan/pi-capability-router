import type { CapabilityDescriptor } from "./registry.ts";

export interface SearchableCapability {
  id: string;
  type: "tool" | "skill" | "mcp" | "memory" | "context";
  name: string;
  description: string;
  keywords?: string[];
}

export interface SearchHit<T extends SearchableCapability = SearchableCapability> {
  capability: T;
  score: number;
}

function terms(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function searchCapabilities<T extends SearchableCapability>(
  capabilities: T[],
  query: string,
  active: ReadonlySet<string>,
  limit: number,
): SearchHit<T>[] {
  const normalized = query.trim().toLowerCase();
  const queryTerms = [...new Set(terms(normalized))];
  // Keep compound identifiers intact when the caller lists several names/IDs.
  // Ordinary words still use task coverage ("browser click tab" is not an OR).
  const identifiers = new Set(normalized.match(/[\p{L}\p{N}_:./\\-]+/gu) ?? []);
  if (!queryTerms.length) return [];

  return capabilities
    .filter((capability) => !active.has(capability.id))
    .map((capability) => {
      const name = capability.name.toLowerCase();
      const exactIdentifier = identifiers.has(capability.id.toLowerCase())
        || (/[_:./\\-]/.test(name) && identifiers.has(name));
      const nameTerms = terms(name);
      const descriptionTerms = new Set(terms(`${capability.description} ${(capability.keywords ?? []).join(" ")}`));
      const nameMatches = queryTerms.filter((term) => nameTerms.includes(term)).length;
      const descriptionMatches = queryTerms.filter((term) => descriptionTerms.has(term)).length;
      const matched = queryTerms.filter((term) => nameTerms.includes(term) || descriptionTerms.has(term)).length;
      const coverage = matched / queryTerms.length;
      let score = 0;
      if (name === normalized || capability.id.toLowerCase() === normalized) score = 1;
      else if (exactIdentifier) score = 0.99;
      else if (coverage === 1 && name.startsWith(normalized)) score = 0.94;
      else if (coverage === 1 && name.includes(normalized)) score = 0.84 + 0.09 * normalized.length / name.length;
      else if (coverage === 1 && queryTerms.length === 1 && nameTerms.some((term) => term.startsWith(normalized))) {
        score = 0.68 + 0.12 * normalized.length / name.length;
      } else if (matched) {
        score = Math.min(0.79, 0.12 + 0.43 * coverage + 0.19 * nameMatches / queryTerms.length
          + 0.05 * descriptionMatches / queryTerms.length);
      }
      return { capability, score: Math.round(score * 1000) / 1000, coverage, exactIdentifier };
    })
    .filter((hit) => hit.score >= 0.3 && (hit.exactIdentifier || queryTerms.length === 1 || hit.coverage >= 0.6))
    .sort((a, b) => b.score - a.score || a.capability.name.localeCompare(b.capability.name))
    .slice(0, limit)
    .map(({ capability, score }) => ({ capability, score }));
}

export function searchTools(
  capabilities: CapabilityDescriptor[],
  query: string,
  active: ReadonlySet<string>,
  limit: number,
): SearchHit<CapabilityDescriptor>[] {
  return searchCapabilities(capabilities, query, new Set([...active].map((name) => `tool:${name}`)), limit);
}
