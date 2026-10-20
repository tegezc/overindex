import { fit, lift, normalizeLift, percentile } from "@/features/sponsor-discovery/domain/scoring";
import { EVAL_SEED, MODEL_RANK_LIMIT } from "./protocol";
import { seededPermutation } from "./rng";

export type RankedBrands = {
  ranking: string[];
  unscored: string[];
  score: ReadonlyMap<string, number>;
};

/**
 * M1. Count is the number of other shows sponsoring the brand.
 * Ties follow a seeded shuffle of the sorted ids (`eval-protocol.md` §6.2).
 */
export function rankM1(counts: ReadonlyMap<string, number>, seed: number = EVAL_SEED): RankedBrands {
  const ids = [...counts.keys()];
  assertUniqueFinite(ids, counts);
  return rankByScore(ids, (id) => counts.get(id) ?? 0, new Set(), seed);
}

/**
 * M2. The model list is injected. This function does not call an LLM.
 * The first 30 entries are kept when they are unique members of `candidates`.
 * Every other candidate is appended in seeded order.
 */
export function rankM2(
  candidates: readonly string[],
  modelRanking: readonly string[],
  seed: number = EVAL_SEED,
): RankedBrands {
  const allowed = new Set(candidates);
  if (allowed.size !== candidates.length) throw new Error("candidates must be unique");
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const id of modelRanking.slice(0, MODEL_RANK_LIMIT)) {
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  const tail = seededPermutation(candidates, seed).filter((id) => !seen.has(id));
  const score = new Map<string, number>();
  const ranking = [...kept, ...tail];
  ranking.forEach((id, index) => score.set(id, ranking.length - index));
  return { ranking, unscored: [], score };
}

/**
 * M3. Scored brands are ordered by the percentile of affinity inside the scored set.
 * Brands without a finite affinity are appended in seeded order. Their count is `unscored`.
 */
export function rankM3(affinities: ReadonlyMap<string, number | undefined>, seed: number = EVAL_SEED): RankedBrands {
  const { scored, unscored } = splitScored(affinities);
  const sample = scored.map((id) => affinities.get(id) as number);
  const pct = new Map<string, number>();
  if (sample.length > 0) {
    for (const id of scored) pct.set(id, percentile(affinities.get(id) as number, sample));
  }
  const ranked = rankByScore([...scored, ...unscored], (id) => pct.get(id) ?? Number.NEGATIVE_INFINITY, new Set(unscored), seed);
  return { ...ranked, unscored };
}

/**
 * M4. `λ · fit + (1 − λ) · pct_pop` for brands with affinity and a baseline percentile.
 * `fit` is the product formula. Brands missing either Qloo input are appended in seeded order.
 */
export function rankM4(
  input: {
    counts: ReadonlyMap<string, number>;
    affinities: ReadonlyMap<string, number | undefined>;
    baselinePercentile: ReadonlyMap<string, number>;
    alpha: number;
    lambda: number;
  },
  seed: number = EVAL_SEED,
): RankedBrands {
  assertUnit("alpha", input.alpha);
  assertUnit("lambda", input.lambda);
  const ids = [...input.counts.keys()];
  if (ids.length === 0) throw new RangeError("candidate set must not be empty");
  assertUniqueFinite(ids, input.counts);
  const countSample = ids.map((id) => input.counts.get(id) as number);
  const pctPop = new Map(ids.map((id) => [id, percentile(input.counts.get(id) as number, countSample)]));
  const scoredIds = ids.filter((id) => {
    const affinity = input.affinities.get(id);
    const baseline = input.baselinePercentile.get(id);
    return affinity !== undefined && Number.isFinite(affinity) && baseline !== undefined && Number.isFinite(baseline);
  });
  const affinitySample = scoredIds.map((id) => input.affinities.get(id) as number);
  const pctShow = new Map(
    scoredIds.map((id) => [id, percentile(input.affinities.get(id) as number, affinitySample)]),
  );
  const hybrid = new Map<string, number>();
  for (const id of scoredIds) {
    const pct = pctShow.get(id) as number;
    const baseline = input.baselinePercentile.get(id) as number;
    const fitValue = fit(pct, normalizeLift(lift(pct, baseline)), input.alpha);
    hybrid.set(id, input.lambda * fitValue + (1 - input.lambda) * (pctPop.get(id) as number));
  }
  const unscored = ids.filter((id) => !hybrid.has(id));
  const ranked = rankByScore(ids, (id) => hybrid.get(id) ?? Number.NEGATIVE_INFINITY, new Set(unscored), seed);
  return { ranking: ranked.ranking, unscored, score: hybrid };
}

function rankByScore(
  ids: readonly string[],
  scoreOf: (id: string) => number,
  unscored: ReadonlySet<string>,
  seed: number,
): RankedBrands {
  if (ids.length === 0) throw new RangeError("candidate set must not be empty");
  const order = new Map(seededPermutation(ids, seed).map((id, index) => [id, index]));
  const score = new Map<string, number>();
  const scored = ids.filter((id) => !unscored.has(id));
  const rest = ids.filter((id) => unscored.has(id));
  for (const id of scored) score.set(id, scoreOf(id));
  scored.sort((left, right) => {
    const diff = (score.get(right) ?? 0) - (score.get(left) ?? 0);
    if (diff !== 0) return diff;
    return (order.get(left) ?? 0) - (order.get(right) ?? 0);
  });
  rest.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  return { ranking: [...scored, ...rest], unscored: rest, score };
}

function splitScored(affinities: ReadonlyMap<string, number | undefined>): { scored: string[]; unscored: string[] } {
  const scored: string[] = [];
  const unscored: string[] = [];
  for (const [id, affinity] of affinities) {
    if (affinity === undefined || !Number.isFinite(affinity)) unscored.push(id);
    else scored.push(id);
  }
  if (scored.length + unscored.length === 0) throw new RangeError("candidate set must not be empty");
  return { scored, unscored };
}

function assertUniqueFinite(ids: readonly string[], counts: ReadonlyMap<string, number>): void {
  if (ids.length === 0) throw new RangeError("candidate set must not be empty");
  if (new Set(ids).size !== ids.length) throw new Error("candidates must be unique");
  for (const id of ids) {
    const count = counts.get(id);
    if (count === undefined || !Number.isFinite(count)) throw new RangeError(`count for ${id} must be finite`);
  }
}

function assertUnit(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`);
}
