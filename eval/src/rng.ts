import { EVAL_SEED } from "./protocol";

/**
 * mulberry32 as operationalized in `eval-protocol.md` §3.3.
 * `a` starts at `seed`. Each draw advances `a` before returning `u`.
 */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates from the last index. `j = floor(u * (i + 1))`. */
export function fisherYates<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  const random = mulberry32(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index] as T;
    copy[index] = copy[swap] as T;
    copy[swap] = current;
  }
  return copy;
}

/** Sort ids ascending, then shuffle. The same seed always yields the same order. */
export function seededPermutation(ids: readonly string[], seed: number = EVAL_SEED): string[] {
  if (new Set(ids).size !== ids.length) throw new Error("ids must be unique");
  const sorted = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return fisherYates(sorted, seed);
}
