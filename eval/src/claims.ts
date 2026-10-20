import type { MetricSummary } from "./results";

/**
 * Pre-registered Q2 claim (`eval-protocol.md` §10).
 * The Jaccard interval must lie entirely below 0, and the recall@20 interval must not.
 */
export function q2MainClaim(jaccardDiff: { low: number; high: number }, recallDiff: { low: number; high: number }): boolean {
  return jaccardDiff.high < 0 && recallDiff.high >= 0;
}

/** Secondary Q1 claim (`eval-protocol.md` §6.5). The nDCG@10 interval must lie entirely above 0. */
export function q1SecondaryClaim(ndcgDiff: { low: number; high: number }): boolean {
  return ndcgDiff.low > 0;
}

export function formatMetric(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("metric is not finite");
  let digits = 4;
  let text = value.toFixed(digits);
  while (digits < 8 && Number(text) === 0 && value !== 0) {
    digits += 1;
    text = value.toFixed(digits);
  }
  return text;
}

export function intervalText(summary: MetricSummary): string {
  return `${formatMetric(summary.mean)} (95% CI ${formatMetric(summary.low)} to ${formatMetric(summary.high)}, n = ${summary.n})`;
}

export function q2ClaimSentence(
  jaccardDiff: MetricSummary | null,
  recallDiff: MetricSummary | null,
): string {
  if (!jaccardDiff || !recallDiff) {
    const n = jaccardDiff?.n ?? recallDiff?.n ?? 0;
    return `No difference was detected because the main comparison could not be computed (n = ${n}).`;
  }
  if (q2MainClaim(jaccardDiff, recallDiff)) {
    return `Overindex is more specific than the language-model list on the test split. Jaccard difference ${intervalText(jaccardDiff)}. Recall@20 difference ${intervalText(recallDiff)}.`;
  }
  return `No difference was detected between overindex and the language-model list on the test split (n = ${jaccardDiff.n}).`;
}

export function q1ClaimSentence(ndcgDiff: MetricSummary | null): string {
  if (!ndcgDiff) return "No difference was detected because the secondary ranking comparison could not be computed (n = 0).";
  if (q1SecondaryClaim(ndcgDiff)) {
    return `Hybrid ranking is above the language-model ranking on nDCG@10. Difference ${intervalText(ndcgDiff)}.`;
  }
  return `No difference was detected between hybrid and the language-model ranking on nDCG@10 (n = ${ndcgDiff.n}).`;
}
