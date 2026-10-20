import { SCORE_BATCH_SIZE } from "@/shared/config/scoring";
import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { InsightsResult } from "@/shared/qloo/domain/envelope";
import type { ScoreCandidatesInput } from "@/shared/qloo/domain/inputs";
import { readInsightBrands, type InsightBrand } from "../domain/entities";

export type ScoreSetResult = {
  byId: Map<string, InsightBrand>;
  batches: number;
  partial: boolean;
};

/**
 * Scores a fixed id list with `filter.results.entities` via `scoreCandidates`.
 * One batch is at most the size proven in G4. `qloo_rank` is not called.
 */
export async function scoreCandidateSet(
  candidateIds: readonly string[],
  signalEntityIds: readonly string[],
  budget: { used: number; cap: number },
  score: (input: ScoreCandidatesInput) => Promise<QlooCall<InsightsResult>>,
): Promise<ScoreSetResult> {
  const byId = new Map<string, InsightBrand>();
  let batches = 0;
  let partial = false;
  if (signalEntityIds.length === 0 || candidateIds.length === 0) {
    return { byId, batches, partial: candidateIds.length > 0 };
  }
  for (let offset = 0; offset < candidateIds.length; offset += SCORE_BATCH_SIZE) {
    if (budget.used + 2 > budget.cap) {
      partial = true;
      break;
    }
    const batch = candidateIds.slice(offset, offset + SCORE_BATCH_SIZE);
    const called = await score({
      type: "brand",
      signalEntityIds: [...signalEntityIds],
      candidateIds: [...batch],
      take: batch.length,
    });
    batches += 1;
    if (called.data.status === "error") {
      partial = true;
      if (called.data.error?.code === "BUDGET_CAP") break;
      continue;
    }
    for (const brand of readInsightBrands(called.data.entities)) byId.set(brand.id, brand);
  }
  return { byId, batches, partial };
}
