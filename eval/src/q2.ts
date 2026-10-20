import { normalizeBrandName } from "@/features/sponsor-discovery/domain/names";
import type { SponsorMention } from "./dataset";
import {
  genericShare,
  hasHit,
  normalizeBrandList,
  perShowSpecificity,
  recallAt,
  resolutionCoverage,
} from "./metrics";
import { FREQUENT_SPONSOR_LIMIT, Q2_CUTOFF, type Split, type Tier } from "./protocol";

export type Q2ShowInput = {
  showId: string;
  tier: Tier;
  split: Split;
  /** L-OI top brands, already limited by the caller. */
  overindexTop: readonly string[];
  /** L-LLM top brands. */
  llmTop: readonly string[];
  /** Every actual sponsor of this show, not limited to the Q1 candidate set. */
  sponsors: readonly string[];
  /** Full L-LLM suggestion list used for resolution coverage. */
  llmSuggestions: readonly string[];
  /** Suggestion strings the caller resolved. Names are compared after normalization. */
  llmResolved: readonly string[];
};

export type Q2ShowMetrics = {
  showId: string;
  tier: Tier;
  specificityOverindex: number;
  specificityLlm: number;
  genericOverindex: number;
  genericLlm: number;
  recallOverindex: number;
  recallLlm: number;
  hitOverindex: number;
  hitLlm: number;
  llmCoverage: number;
};

/**
 * Brands ordered by how many distinct shows sponsor them, then by name.
 * The whole dataset is the population. This does not score a split.
 */
export function mostFrequentBrands(sponsors: readonly SponsorMention[], limit: number = FREQUENT_SPONSOR_LIMIT): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer");
  const showsByBrand = new Map<string, Set<string>>();
  for (const row of sponsors) {
    const key = normalizeBrandName(row.brandNorm);
    if (!key) continue;
    const bucket = showsByBrand.get(key) ?? new Set<string>();
    bucket.add(row.showId);
    showsByBrand.set(key, bucket);
  }
  return [...showsByBrand.entries()]
    .sort((left, right) => right[1].size - left[1].size || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .slice(0, limit)
    .map(([brand]) => brand);
}

/**
 * First `limit` LLM brands that are not in the normalized Lane A set.
 * Lane membership is supplied by the caller. This does not read the dataset file.
 */
export function llmBrandsOutsideLaneA(
  brands: readonly string[],
  laneANormalized: ReadonlySet<string>,
  limit: number = Q2_CUTOFF,
): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const brand of brands) {
    const key = normalizeBrandName(brand);
    if (!key || seen.has(key) || laneANormalized.has(key)) continue;
    seen.add(key);
    picked.push(key);
    if (picked.length === limit) break;
  }
  return picked;
}

/**
 * Per-show Q2 metrics for the shows in `measureSplit` only.
 * Lists from the other split are not included in the pair average.
 */
export function scoreQ2Split(shows: readonly Q2ShowInput[], frequent: ReadonlySet<string>, measureSplit: Split): Q2ShowMetrics[] {
  const selected = shows.filter((show) => show.split === measureSplit);
  const overindex = selected.map((show) => normalizeBrandList(show.overindexTop));
  const llm = selected.map((show) => normalizeBrandList(show.llmTop));
  const specificityOverindex = selected.length < 2 ? [] : perShowSpecificity(overindex);
  const specificityLlm = selected.length < 2 ? [] : perShowSpecificity(llm);
  return selected.map((show, index) => {
    const sponsors = new Set(normalizeBrandList(show.sponsors));
    if (sponsors.size === 0) throw new RangeError(`show ${show.showId} has no sponsors to score`);
    const overindexTop = overindex[index] ?? [];
    const llmTop = llm[index] ?? [];
    const overindexSpec = specificityOverindex[index];
    const llmSpec = specificityLlm[index];
    if (overindexSpec === undefined || llmSpec === undefined) {
      throw new RangeError("specificity needs at least two measured shows");
    }
    return {
      showId: show.showId,
      tier: show.tier,
      specificityOverindex: overindexSpec,
      specificityLlm: llmSpec,
      genericOverindex: genericShare(overindexTop, frequent),
      genericLlm: genericShare(llmTop, frequent),
      recallOverindex: recallAt(overindexTop, sponsors, Q2_CUTOFF),
      recallLlm: recallAt(llmTop, sponsors, Q2_CUTOFF),
      hitOverindex: hasHit(overindexTop, sponsors, Q2_CUTOFF) ? 1 : 0,
      hitLlm: hasHit(llmTop, sponsors, Q2_CUTOFF) ? 1 : 0,
      llmCoverage: resolutionCoverage(normalizeBrandList(show.llmSuggestions), new Set(normalizeBrandList(show.llmResolved))),
    };
  });
}
