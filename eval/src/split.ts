import type { ShowRecord } from "./dataset";
import { EVAL_SEED, FULL_DEV_COUNTS, type Split, type Tier } from "./protocol";
import { seededPermutation } from "./rng";

export type SplitShow = {
  showId: string;
  tier: Tier;
};

export type DevCounts = { besar: number; mid: number };

/**
 * Stratified shuffle (`eval-protocol.md` §4).
 * Each tier is sorted by show id, then shuffled with mulberry32 reseeded to `seed`.
 * The first `counts` ids in that tier are dev. The rest are test.
 */
export function assignSplit(
  shows: readonly SplitShow[],
  counts: DevCounts = FULL_DEV_COUNTS,
  seed: number = EVAL_SEED,
): Map<string, Split> {
  if (new Set(shows.map((show) => show.showId)).size !== shows.length) {
    throw new Error("duplicate show_id");
  }
  const assigned = new Map<string, Split>();
  for (const tier of ["besar", "mid"] as const) {
    const shuffled = tierShuffle(shows, tier, seed);
    const devCount = counts[tier];
    if (!Number.isInteger(devCount) || devCount < 0 || devCount > shuffled.length) {
      throw new RangeError(`dev count for ${tier} is out of range`);
    }
    shuffled.forEach((showId, index) => {
      assigned.set(showId, index < devCount ? "dev" : "test");
    });
  }
  if (assigned.size !== shows.length) throw new Error("every show needs a tier of besar or mid");
  return assigned;
}

export function tierShuffle(shows: readonly SplitShow[], tier: Tier, seed: number = EVAL_SEED): string[] {
  const ids = shows.filter((show) => show.tier === tier).map((show) => show.showId);
  return seededPermutation(ids, seed);
}

export function splitMismatches(
  shows: readonly ShowRecord[],
  counts: DevCounts = FULL_DEV_COUNTS,
  seed: number = EVAL_SEED,
): { showId: string; stored: Split; expected: Split }[] {
  const expected = assignSplit(shows, counts, seed);
  const mismatches: { showId: string; stored: Split; expected: Split }[] = [];
  for (const show of shows) {
    const assigned = expected.get(show.showId);
    if (assigned !== show.split) {
      mismatches.push({ showId: show.showId, stored: show.split, expected: assigned ?? "test" });
    }
  }
  return mismatches;
}
