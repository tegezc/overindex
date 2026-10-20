import { SCORE_BATCH_SIZE } from "@/shared/config/scoring";

/** Show score plus baseline, one pair of calls per batch. */
export function pairedScoreCalls(candidateCount: number, batchSize: number = SCORE_BATCH_SIZE): number {
  if (candidateCount <= 0) return 0;
  if (batchSize <= 0) throw new RangeError("batch size must be positive");
  return Math.ceil(candidateCount / batchSize) * 2;
}

/**
 * True when `extraCalls` still leave room for scoring every candidate and the slack.
 * Slack is withheld from discovery and name resolution, not from the scoring calls themselves.
 */
export function withinPlan(
  used: number,
  cap: number,
  extraCalls: number,
  candidateCount: number,
  slack: number = 0,
): boolean {
  if (extraCalls < 0 || slack < 0) return false;
  return used + extraCalls + pairedScoreCalls(candidateCount) <= cap - slack;
}
