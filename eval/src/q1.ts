import type { SponsorMention } from "./dataset";
import { rankM1, rankM2, rankM3, rankM4 } from "./methods";
import { ndcgAt, recallAt } from "./metrics";
import { EVAL_SEED, METHOD_IDS, Q1_CUTOFF, type MethodId, type Split, type Tier } from "./protocol";

export type Q1Show = {
  showId: string;
  tier: Tier;
  split: Split;
};

export type Q1Exclusion = {
  showId: string;
  reason: "show_unresolved" | "empty_relevance";
};

export type Q1ShowResult = {
  showId: string;
  tier: Tier;
  split: Split;
  relevantCount: number;
  unscoredM3: number;
  unscoredM4: number;
  metrics: Record<MethodId, { recallAt10: number; ndcgAt10: number }>;
};

export type Q1Signals = {
  /** Show ids confirmed resolved. Shows outside this set are excluded, not scored. */
  resolvedShows: ReadonlySet<string>;
  /** `brand_norm` values that resolved to a Qloo brand. */
  resolvedBrands: ReadonlySet<string>;
  /** Per measured show. A present empty map means every candidate is unscored. */
  affinityByShow: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Shared baseline percentiles. A per-show map overrides this for that show. */
  baselinePercentile: ReadonlyMap<string, number>;
  /** Percentiles computed inside that show's own candidate set. */
  baselinePercentileByShow?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Per measured show. Injected model output. This module does not call an LLM. */
  modelRankingByShow: ReadonlyMap<string, readonly string[]>;
  alpha: number;
  lambda: number;
};

/**
 * Score one split. Candidate brands still come from every other show, including the split
 * that is not being measured (`eval-protocol.md` §6.1). The other split is not scored.
 * `measureSplit: "test"` throws until the caller passes `allowTestSplit` after the config is locked.
 */
export function scoreQ1Split(
  shows: readonly Q1Show[],
  sponsors: readonly SponsorMention[],
  signals: Q1Signals,
  measureSplit: Split,
  options: { allowTestSplit?: boolean; seed?: number } = {},
): { measured: Q1ShowResult[]; excluded: Q1Exclusion[] } {
  if (measureSplit === "test" && !options.allowTestSplit) {
    throw new Error("The test split is not measured until the configuration is locked");
  }
  const seed = options.seed ?? EVAL_SEED;
  const measured: Q1ShowResult[] = [];
  const excluded: Q1Exclusion[] = [];
  for (const show of shows) {
    if (show.split !== measureSplit) continue;
    if (!signals.resolvedShows.has(show.showId)) {
      excluded.push({ showId: show.showId, reason: "show_unresolved" });
      continue;
    }
    const { candidates, relevant } = candidateSet(show.showId, sponsors, signals.resolvedBrands);
    if (relevant.length === 0) {
      excluded.push({ showId: show.showId, reason: "empty_relevance" });
      continue;
    }
    const affinities = signals.affinityByShow.get(show.showId);
    const modelRanking = signals.modelRankingByShow.get(show.showId);
    if (!affinities) throw new Error(`missing affinity table for ${show.showId}`);
    if (!modelRanking) throw new Error(`missing model ranking for ${show.showId}`);
    const counts = popularityCounts(show.showId, sponsors, candidates);
    const affinityMap = new Map<string, number | undefined>(candidates.map((brand) => [brand, affinities.get(brand)]));
    const m1 = rankM1(counts, seed);
    const m2 = rankM2(candidates, modelRanking, seed);
    const m3 = rankM3(affinityMap, seed);
    const m4 = rankM4(
      {
        counts,
        affinities: affinityMap,
        baselinePercentile: signals.baselinePercentileByShow?.get(show.showId) ?? signals.baselinePercentile,
        alpha: signals.alpha,
        lambda: signals.lambda,
      },
      seed,
    );
    const relevantSet = new Set(relevant);
    const metrics = {} as Q1ShowResult["metrics"];
    const rankings = { M1: m1.ranking, M2: m2.ranking, M3: m3.ranking, M4: m4.ranking };
    for (const method of METHOD_IDS) {
      const ranking = rankings[method];
      metrics[method] = {
        recallAt10: recallAt(ranking, relevantSet, Q1_CUTOFF),
        ndcgAt10: ndcgAt(ranking, relevantSet, Q1_CUTOFF),
      };
    }
    measured.push({
      showId: show.showId,
      tier: show.tier,
      split: show.split,
      relevantCount: relevant.length,
      unscoredM3: m3.unscored.length,
      unscoredM4: m4.unscored.length,
      metrics,
    });
  }
  return { measured, excluded };
}

/** Resolved `brand_norm` from other shows, and the target show's sponsors that also appear there. */
export function candidateSet(
  showId: string,
  sponsors: readonly SponsorMention[],
  resolvedBrands: ReadonlySet<string>,
): { candidates: string[]; relevant: string[] } {
  const others = new Set<string>();
  const own = new Set<string>();
  for (const row of sponsors) {
    if (!resolvedBrands.has(row.brandNorm)) continue;
    if (row.showId === showId) own.add(row.brandNorm);
    else others.add(row.brandNorm);
  }
  const candidates = [...others].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const relevant = [...own].filter((brand) => others.has(brand)).sort((left, right) => (left < right ? -1 : 1));
  return { candidates, relevant };
}

/** Number of other shows sponsoring each candidate. Repeated episodes of one show count once. */
export function popularityCounts(
  showId: string,
  sponsors: readonly SponsorMention[],
  candidates: readonly string[],
): Map<string, number> {
  const showsByBrand = new Map<string, Set<string>>(candidates.map((brand) => [brand, new Set()]));
  for (const row of sponsors) {
    if (row.showId === showId) continue;
    showsByBrand.get(row.brandNorm)?.add(row.showId);
  }
  return new Map([...showsByBrand].map(([brand, ids]) => [brand, ids.size]));
}
