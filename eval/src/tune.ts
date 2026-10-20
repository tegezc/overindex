import { fit, lift, normalizeLift, percentile } from "@/features/sponsor-discovery/domain/scoring";
import { MODEL_RANK_LIMIT, type MethodId } from "./protocol";
import type { Q1ShowResult } from "./q1";

export type GridCell = {
  alpha: number;
  lambda: number;
  ndcgAt10: number;
};

export type PromptChoice = {
  variant: "A.1a" | "A.1b";
  ndcgAt10: number;
  tie: boolean;
};

/**
 * Joint §6.4 grid. Higher M4 nDCG@10 wins.
 * A tie keeps the larger α, then the larger λ (the simpler corner is 1, 1).
 */
export function selectAlphaLambda(cells: readonly GridCell[]): GridCell {
  if (cells.length === 0) throw new RangeError("tuning grid must not be empty");
  const ranked = [...cells].sort(
    (left, right) => right.ndcgAt10 - left.ndcgAt10 || right.alpha - left.alpha || right.lambda - left.lambda,
  );
  const best = ranked[0];
  if (!best || !Number.isFinite(best.ndcgAt10)) throw new RangeError("tuning metrics must be finite");
  return best;
}

/**
 * The stronger M2 prompt is the baseline (`eval-protocol.md` §6.4).
 * An exact tie keeps A.1a, the shorter prompt.
 */
export function selectPrompt(options: readonly { variant: "A.1a" | "A.1b"; ndcgAt10: number }[]): PromptChoice {
  const a = options.find((option) => option.variant === "A.1a");
  const b = options.find((option) => option.variant === "A.1b");
  if (!a || !b || options.length !== 2) throw new RangeError("prompt tuning needs A.1a and A.1b");
  if (!Number.isFinite(a.ndcgAt10) || !Number.isFinite(b.ndcgAt10)) throw new RangeError("tuning metrics must be finite");
  if (b.ndcgAt10 > a.ndcgAt10) return { variant: "A.1b", ndcgAt10: b.ndcgAt10, tie: false };
  return { variant: "A.1a", ndcgAt10: a.ndcgAt10, tie: a.ndcgAt10 === b.ndcgAt10 };
}

export function meanMetric(rows: readonly Q1ShowResult[], method: MethodId, metric: "recallAt10" | "ndcgAt10"): number {
  if (rows.length === 0) throw new RangeError("metric mean needs at least one show");
  let sum = 0;
  for (const row of rows) {
    const value = row.metrics[method][metric];
    if (!Number.isFinite(value)) throw new RangeError("metric mean needs finite values");
    sum += value;
  }
  return sum / rows.length;
}

/** How many ids the frozen A.1 prompt can ask for when the candidate list is shorter than 30. */
export function q1RequestLength(candidateCount: number): number {
  if (!Number.isInteger(candidateCount) || candidateCount < 1) {
    throw new RangeError("candidate count must be a positive integer");
  }
  return Math.min(MODEL_RANK_LIMIT, candidateCount);
}

export type FitRow = {
  name: string;
  affinityShow?: number;
  affinityBase?: number;
};

/**
 * Product `fit` order for L-OI. Missing fit sorts after scored rows, then by name.
 * This does not call Qloo.
 */
export function rankPoolByFit(items: readonly FitRow[], alpha: number, limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer");
  const showSample = finite(items.map((item) => item.affinityShow));
  const baseSample = finite(items.map((item) => item.affinityBase));
  const ranked = items.map((item) => ({ name: item.name, fit: fitOf(item, showSample, baseSample, alpha) }));
  ranked.sort((left, right) => {
    const delta = (right.fit ?? Number.NEGATIVE_INFINITY) - (left.fit ?? Number.NEGATIVE_INFINITY);
    if (delta !== 0) return delta;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    if (!row.name || seen.has(row.name)) continue;
    seen.add(row.name);
    out.push(row.name);
    if (out.length === limit) break;
  }
  return out;
}

function fitOf(item: FitRow, showSample: readonly number[], baseSample: readonly number[], alpha: number): number | undefined {
  if (item.affinityShow === undefined || item.affinityBase === undefined) return undefined;
  if (showSample.length === 0 || baseSample.length === 0) return undefined;
  const pctShow = percentile(item.affinityShow, showSample);
  const pctBase = percentile(item.affinityBase, baseSample);
  return fit(pctShow, normalizeLift(lift(pctShow, pctBase)), alpha);
}

function finite(values: readonly (number | undefined)[]): number[] {
  return values.filter((value): value is number => value !== undefined && Number.isFinite(value));
}
