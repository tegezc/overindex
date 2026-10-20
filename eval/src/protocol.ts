/**
 * Frozen eval constants (`eval-protocol.md` §4, §6, §7).
 * α and λ are not locked here. §10 stays empty until the dev run.
 */
export const EVAL_SEED = 20261017;
export const BOOTSTRAP_RESAMPLES = 10_000;
export const Q1_CUTOFF = 10;
export const Q2_CUTOFF = 20;
export const MODEL_RANK_LIMIT = 30;
export const FREQUENT_SPONSOR_LIMIT = 50;

/** Dev counts for the frozen 30-show split. The remainder of each tier is test. */
export const FULL_DEV_COUNTS = { besar: 3, mid: 7 } as const;

/** Contingency in §4. Not applied to `shows.csv`. */
export const REDUCED_DEV_COUNTS = { besar: 2, mid: 4 } as const;

export const ALPHA_GRID = [0, 0.25, 0.5, 0.75, 1] as const;
export const LAMBDA_GRID = [0, 0.25, 0.5, 0.75, 1] as const;

export const METHOD_IDS = ["M1", "M2", "M3", "M4"] as const;
export type MethodId = (typeof METHOD_IDS)[number];

export type Tier = "besar" | "mid";
export type Split = "dev" | "test";

/**
 * Higher metric wins. Equal metrics keep the larger grid value.
 * §6.4 breaks ties toward the simpler setting, α = 1 and λ = 1.
 */
export function chooseTunedValue(options: readonly { value: number; metric: number }[]): number {
  if (options.length === 0) throw new RangeError("tuning options must not be empty");
  const ranked = [...options].sort((left, right) => right.metric - left.metric || right.value - left.value);
  const best = ranked[0];
  if (!best || !Number.isFinite(best.metric)) throw new RangeError("tuning metrics must be finite");
  return best.value;
}
