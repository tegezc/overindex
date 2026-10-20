import { normalizeBrandName } from "@/features/sponsor-discovery/domain/names";

/** `|top-k ∩ relevant| / |relevant|`. `relevant` must not be empty. */
export function recallAt(ranking: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  assertCutoff(k);
  if (relevant.size === 0) throw new RangeError("relevant set must not be empty");
  const seen = new Set<string>();
  let hits = 0;
  for (const id of ranking.slice(0, k)) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (relevant.has(id)) hits += 1;
  }
  return hits / relevant.size;
}

/**
 * nDCG@k with binary relevance.
 * Gain at 1-based rank `r` is `1 / log2(r + 1)`.
 */
export function ndcgAt(ranking: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  assertCutoff(k);
  if (relevant.size === 0) throw new RangeError("relevant set must not be empty");
  let dcg = 0;
  const seen = new Set<string>();
  for (const [index, id] of ranking.slice(0, k).entries()) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (relevant.has(id)) dcg += 1 / Math.log2(index + 2);
  }
  let ideal = 0;
  const idealCount = Math.min(k, relevant.size);
  for (let index = 0; index < idealCount; index += 1) ideal += 1 / Math.log2(index + 2);
  return dcg / ideal;
}

export function hasHit(ranking: readonly string[], relevant: ReadonlySet<string>, k: number): boolean {
  assertCutoff(k);
  const seen = new Set<string>();
  for (const id of ranking.slice(0, k)) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (relevant.has(id)) return true;
  }
  return false;
}

/** `|A ∩ B| / |A ∪ B|` after exact string identity. Both empty is 1. */
export function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  if (union === 0) return 1;
  return intersection / union;
}

/** Mean Jaccard of each list against every other list. Needs at least two lists. */
export function perShowSpecificity(lists: readonly (readonly string[])[]): number[] {
  if (lists.length < 2) throw new RangeError("specificity needs at least two shows");
  return lists.map((list, index) => {
    let sum = 0;
    for (let other = 0; other < lists.length; other += 1) {
      if (other === index) continue;
      sum += jaccard(list, lists[other] ?? []);
    }
    return sum / (lists.length - 1);
  });
}

/** Share of `top` that sits in `frequent`. */
export function genericShare(top: readonly string[], frequent: ReadonlySet<string>): number {
  if (top.length === 0) throw new RangeError("top list must not be empty");
  let hits = 0;
  for (const brand of top) if (frequent.has(brand)) hits += 1;
  return hits / top.length;
}

/** Share of suggestions the caller marked resolved. Resolution itself is not performed here. */
export function resolutionCoverage(suggestions: readonly string[], resolved: ReadonlySet<string>): number {
  if (suggestions.length === 0) throw new RangeError("suggestions must not be empty");
  let hits = 0;
  for (const name of suggestions) if (resolved.has(name)) hits += 1;
  return hits / suggestions.length;
}

/**
 * Q2 name identity (`eval-protocol.md` §7.2): lowercase, punctuation removed,
 * trailing Inc/LLC/Co dropped. Empty names are removed. Order of first occurrence is kept.
 */
export function normalizeBrandList(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = normalizeBrandName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function assertCutoff(k: number): void {
  if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be an integer of at least 1");
}
