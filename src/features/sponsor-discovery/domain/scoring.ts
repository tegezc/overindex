import {
  FIT_ALPHA,
  LLM_PREDICTED_MAX_RANK,
  QUADRANT_FIT_THRESHOLD,
  REACH_ESTABLISHED_MIN,
  REACH_HOUSEHOLD_MIN,
} from "@/shared/config/scoring";
import { nameAccepts, normalizeBrandName } from "./names";
import type { Lane, Quadrant, ReachBand } from "./types";

/** Inclusive empirical percentile of `value` inside `sample`. Highest value is 1. */
export function percentile(value: number, sample: readonly number[]): number {
  if (!Number.isFinite(value)) throw new RangeError("value must be finite");
  if (sample.length === 0) throw new RangeError("sample must not be empty");
  let atMost = 0;
  for (const item of sample) {
    if (!Number.isFinite(item)) throw new RangeError("sample values must be finite");
    if (item <= value) atMost += 1;
  }
  return atMost / sample.length;
}

export function lift(pctShow: number, pctBase: number): number {
  if (!Number.isFinite(pctShow) || !Number.isFinite(pctBase)) throw new RangeError("percentiles must be finite");
  return pctShow - pctBase;
}

/** Maps lift from [-1, 1] onto [0, 1]. Values outside that range are clamped. */
export function normalizeLift(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("lift must be finite");
  return Math.min(1, Math.max(0, (value + 1) / 2));
}

export function fit(pctShow: number, liftNorm: number, alpha: number = FIT_ALPHA): number {
  if (!Number.isFinite(pctShow) || !Number.isFinite(liftNorm) || !Number.isFinite(alpha)) {
    throw new RangeError("fit inputs must be finite");
  }
  if (alpha < 0 || alpha > 1) throw new RangeError("alpha must be between 0 and 1");
  return alpha * pctShow + (1 - alpha) * liftNorm;
}

/**
 * Popularity 0 is treated as unknown: the spike saw 0.00 on brands that are not
 * actually at the bottom of the catalog. Missing and out-of-range values are unknown too.
 */
export function reachBand(popularity: number | undefined): ReachBand | undefined {
  if (popularity === undefined || !Number.isFinite(popularity) || popularity <= 0 || popularity > 1) {
    return undefined;
  }
  if (popularity >= REACH_HOUSEHOLD_MIN) return "household";
  if (popularity >= REACH_ESTABLISHED_MIN) return "established";
  return "challenger";
}

/** `laneA` holds names already passed through `normalizeBrandName`. */
export function assignLane(name: string, laneA: ReadonlySet<string>): Lane {
  const key = normalizeBrandName(name);
  if (!key) return "B";
  if (laneA.has(key)) return "A";
  for (const laneName of laneA) {
    if (nameAccepts(laneName, key)) return "A";
  }
  return "B";
}

/**
 * Predicted = top-20 LLM-only. High = `fit` at or above the pre-lock threshold.
 * Missing fit stays `none`: a missing score is not a weak score.
 */
export function assignQuadrant(input: { fit?: number; llmRank?: number }): Quadrant {
  if (input.fit === undefined || !Number.isFinite(input.fit)) return "none";
  const predicted =
    input.llmRank !== undefined && input.llmRank >= 1 && input.llmRank <= LLM_PREDICTED_MAX_RANK;
  const high = input.fit >= QUADRANT_FIT_THRESHOLD;
  if (predicted && high) return "proven";
  if (!predicted && high) return "hidden";
  if (predicted && !high) return "category_only";
  return "none";
}
