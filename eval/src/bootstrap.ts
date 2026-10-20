import { BOOTSTRAP_RESAMPLES, EVAL_SEED } from "./protocol";
import { mulberry32 } from "./rng";

export type BootstrapCi = {
  mean: number;
  low: number;
  high: number;
  resamples: number;
  seed: number;
};

export type BootstrapOptions = {
  resamples?: number;
  seed?: number;
};

/**
 * Percentile bootstrap of the mean over shows (`eval-protocol.md` §6.3).
 * Each call reseeds mulberry32 so the interval does not depend on call order.
 * The 2.5 and 97.5 percentiles use linear interpolation at index `(n − 1) * p`.
 */
export function bootstrapMeanCi(values: readonly number[], options: BootstrapOptions = {}): BootstrapCi {
  if (values.length === 0) throw new RangeError("values must not be empty");
  for (const value of values) {
    if (!Number.isFinite(value)) throw new RangeError("values must be finite");
  }
  const resamples = options.resamples ?? BOOTSTRAP_RESAMPLES;
  const seed = options.seed ?? EVAL_SEED;
  if (!Number.isInteger(resamples) || resamples < 1) throw new RangeError("resamples must be a positive integer");
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const random = mulberry32(seed);
  const means = new Array<number>(resamples);
  for (let sample = 0; sample < resamples; sample += 1) {
    let sum = 0;
    for (let draw = 0; draw < values.length; draw += 1) {
      const index = Math.floor(random() * values.length);
      sum += values[index] ?? 0;
    }
    means[sample] = sum / values.length;
  }
  means.sort((left, right) => left - right);
  return {
    mean,
    low: linearPercentile(means, 0.025),
    high: linearPercentile(means, 0.975),
    resamples,
    seed,
  };
}

/** Paired difference `left − right`, resampled on the same show indexes. */
export function bootstrapPairedMeanCi(
  left: readonly number[],
  right: readonly number[],
  options: BootstrapOptions = {},
): BootstrapCi {
  if (left.length === 0 || left.length !== right.length) {
    throw new RangeError("paired samples must be non-empty and the same length");
  }
  const diffs = left.map((value, index) => value - (right[index] ?? 0));
  return bootstrapMeanCi(diffs, options);
}

export function linearPercentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError("sample must not be empty");
  if (p < 0 || p > 1 || !Number.isFinite(p)) throw new RangeError("p must be between 0 and 1");
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower];
  const high = sorted[upper];
  if (low === undefined || high === undefined) throw new RangeError("percentile index out of range");
  if (lower === upper) return low;
  return low + (high - low) * (position - lower);
}
