import type { CapabilityDescriptor } from "./registry.ts";

export interface SearchHit {
  capability: CapabilityDescriptor;
  score: number;
}

function terms(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function searchTools(
  capabilities: CapabilityDescriptor[],
  query: string,
  active: ReadonlySet<string>,
  limit: number,
): SearchHit[] {
  const normalized = query.trim().toLowerCase();
  const queryTerms = [...new Set(terms(normalized))];
  if (!queryTerms.length) return [];

  return capabilities
    .filter((capability) => !active.has(capability.name))
    .map((capability) => {
      const name = capability.name.toLowerCase();
      const nameTerms = terms(name);
      const description = capability.description.toLowerCase();
      const matched = queryTerms.filter((term) => nameTerms.includes(term) || description.includes(term));
      let score = 0;
      if (name === normalized) score = 1;
      else if (name.startsWith(normalized)) score = 0.9;
      else if (name.includes(normalized)) score = 0.8;
      else if (matched.length) {
        const coverage = matched.length / queryTerms.length;
        const nameMatches = matched.filter((term) => nameTerms.includes(term)).length;
        score = Math.min(0.79, 0.18 + 0.48 * coverage + 0.13 * nameMatches / queryTerms.length);
      }
      return { capability, score: Math.round(score * 100) / 100 };
    })
    .filter((hit) => hit.score >= 0.25)
    .sort((a, b) => b.score - a.score || a.capability.name.localeCompare(b.capability.name))
    .slice(0, limit);
}
