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

const HAN_RUN = /\p{Script=Han}+/gu;
const HAN_TEST = /\p{Script=Han}/u;
const NON_HAN_TERM = /[\p{L}\p{N}]+/gu;

/**
 * Lexical units of a value: non-Han tokens exactly as before, plus whole Han
 * runs kept intact. Han has no whitespace boundaries, so splitting a mixed
 * string like "之前提到过什么" with `[\p{L}\p{N}]+` would produce one giant
 * token that matches nothing — the run itself becomes the unit and is compared
 * through its bigrams (see `unitMatches`).
 */
export function lexicalUnits(value: string): string[] {
  const units: string[] = [];
  let last = 0;
  for (const match of value.matchAll(HAN_RUN)) {
    const before = value.slice(last, match.index);
    units.push(...(before.toLowerCase().match(NON_HAN_TERM) ?? []));
    units.push(match[0]);
    last = match.index + match[0].length;
  }
  units.push(...(value.slice(last).toLowerCase().match(NON_HAN_TERM) ?? []));
  return units;
}

/** Two-character shingles of a Han run; single characters stand alone. */
function hanGrams(run: string): Set<string> {
  if (run.length === 1) return new Set([run]);
  const grams = new Set<string>();
  for (let i = 0; i < run.length - 1; i++) grams.add(run.slice(i, i + 2));
  return grams;
}

function isHan(unit: string): boolean {
  return HAN_TEST.test(unit);
}

/**
 * A query unit matches when it equals a non-Han candidate unit, or — for Han
 * units — when the two runs share at least one bigram. Bigram overlap is the
 * standard space-free-script recall trick: query run "之前提到过什么" matches
 * a description containing "之前", while single unrelated characters do not.
 */
function unitMatches(unit: string, candidates: Iterable<string>): boolean {
  if (!isHan(unit)) {
    for (const candidate of candidates) {
      if (candidate === unit) return true;
    }
    return false;
  }
  const grams = hanGrams(unit);
  for (const candidate of candidates) {
    if (!isHan(candidate)) continue;
    for (const gram of hanGrams(candidate)) {
      if (grams.has(gram)) return true;
    }
  }
  return false;
}

/** Bigrams of the Han runs in a raw text, for `includes`-style chunk scoring. */
export function searchTerms(value: string): string[] {
  const terms: string[] = [];
  for (const unit of lexicalUnits(value)) {
    if (!isHan(unit)) {
      terms.push(unit);
      continue;
    }
    if (unit.length === 1) {
      terms.push(unit);
      continue;
    }
    for (let i = 0; i < unit.length - 1; i++) terms.push(unit.slice(i, i + 2));
  }
  return terms;
}

export function searchCapabilities<T extends SearchableCapability>(
  capabilities: T[],
  query: string,
  active: ReadonlySet<string>,
  limit: number,
): SearchHit<T>[] {
  const normalized = query.trim().toLowerCase();
  const queryUnits = [...new Set(lexicalUnits(normalized))];
  // Keep compound identifiers intact when the caller lists several names/IDs.
  // Ordinary words still use task coverage ("browser click tab" is not an OR).
  const identifiers = new Set(normalized.match(/[\p{L}\p{N}_:./\\-]+/gu) ?? []);
  if (!queryUnits.length) return [];

  // A comma/whitespace list in which every chunk exactly names a known
  // capability is a multi-name lookup ("grep, lsp, find"), not a task query —
  // each named capability should surface, which per-capability word coverage
  // (1/3 of the terms) would filter out.
  const chunks = normalized.split(/[\s,，、]+/).filter(Boolean);
  const names = new Map<string, T[]>();
  if (chunks.length > 1) {
    for (const capability of capabilities) {
      const list = names.get(capability.name.toLowerCase()) ?? [];
      list.push(capability);
      names.set(capability.name.toLowerCase(), list);
    }
    if (chunks.every((chunk) => names.has(chunk))) {
      const matched = new Set(chunks.flatMap((chunk) => names.get(chunk) ?? []));
      return [...matched]
        .filter((capability) => !active.has(capability.id))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((capability) => ({ capability, score: 0.99 }));
    }
  }

  return capabilities
    .filter((capability) => !active.has(capability.id))
    .map((capability) => {
      const name = capability.name.toLowerCase();
      const exactIdentifier = identifiers.has(capability.id.toLowerCase())
        || (/[_:./\\-]/.test(name) && identifiers.has(name));
      const nameUnits = lexicalUnits(name);
      const descriptionUnits = new Set(lexicalUnits(`${capability.description} ${(capability.keywords ?? []).join(" ")}`));
      const nameMatches = queryUnits.filter((unit) => unitMatches(unit, nameUnits)).length;
      const descriptionMatches = queryUnits.filter((unit) => unitMatches(unit, descriptionUnits)).length;
      const matched = queryUnits.filter((unit) => unitMatches(unit, nameUnits) || unitMatches(unit, descriptionUnits)).length;
      const coverage = matched / queryUnits.length;
      let score = 0;
      if (name === normalized || capability.id.toLowerCase() === normalized) score = 1;
      else if (exactIdentifier) score = 0.99;
      else if (coverage === 1 && name.startsWith(normalized)) score = 0.94;
      else if (coverage === 1 && name.includes(normalized)) score = 0.84 + 0.09 * normalized.length / name.length;
      // A short single-term query that prefixes a name scores even though it
      // equals no token ("gre" vs "grep"); the previous `coverage === 1`
      // condition made this branch unreachable for exactly that case.
      else if (normalized.length >= 2 && queryUnits.length === 1 && !isHan(queryUnits[0])
        && nameUnits.some((unit) => unit.startsWith(normalized))) {
        score = 0.68 + 0.12 * normalized.length / name.length;
      } else if (matched) {
        score = Math.min(0.79, 0.12 + 0.43 * coverage + 0.19 * nameMatches / queryUnits.length
          + 0.05 * descriptionMatches / queryUnits.length);
      }
      return { capability, score: Math.round(score * 1000) / 1000, coverage, exactIdentifier };
    })
    .filter((hit) => hit.score >= 0.3 && (hit.exactIdentifier || queryUnits.length === 1 || hit.coverage >= 0.6))
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
