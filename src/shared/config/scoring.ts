/**
 * Pre-lock scoring constants. Eval dev may replace them (`eval-protocol.md` §6.4).
 * `fit` mixes two 0–1 terms, so the quadrant threshold is an absolute cutoff on `fit`.
 * Reach bands and popularity bands are uncalibrated.
 */
export const SCORING_VERSION = "2026-10-20-prelock";

export const FIT_ALPHA = 0.5;
export const QUADRANT_FIT_THRESHOLD = 0.7;
export const LLM_PREDICTED_MAX_RANK = 20;

/** Popularity at or above this is Household. Below the established floor is Challenger. */
export const REACH_HOUSEHOLD_MIN = 0.85;
export const REACH_ESTABLISHED_MIN = 0.4;

/** G4 scored 30 entities in one `filter.results.entities` call. */
export const SCORE_BATCH_SIZE = 30;

/** Each discovery band asks for this many brands. Insights `take` max is 50. */
export const DISCOVER_TAKE = 20;

/**
 * Calls held back from name resolution so one retry can still finish
 * show-scoring and baseline. The hard cap stays `QLOO_BUDGET_CAP`.
 */
export const PLAN_SLACK_CALLS = 2;

export const POPULARITY_BANDS = [{ min: 0.4 }, { min: 0.01, max: 0.4 }] as const;
