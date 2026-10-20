import { SCORE_BATCH_SIZE } from "@/shared/config/scoring";
import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { InsightsResult } from "@/shared/qloo/domain/envelope";
import type { ScoreCandidatesInput } from "@/shared/qloo/domain/inputs";
import type { BaselineAffinityStore } from "../domain/baseline-store";
import { readInsightBrands } from "../domain/entities";

export type BaselineResult = {
  affinities: Map<string, number>;
  cached: number;
  batches: number;
  partial: boolean;
};

/**
 * Baseline affinities use the same insights score as the show, with the basket as the signal.
 * Values already stored for a brand id are not requested again.
 */
export async function baselineAffinity(
  candidateIds: readonly string[],
  signalEntityIds: readonly string[],
  budget: { used: number; cap: number },
  store: BaselineAffinityStore,
  score: (input: ScoreCandidatesInput) => Promise<QlooCall<InsightsResult>>,
): Promise<BaselineResult> {
  const affinities = new Map<string, number>();
  const missing: string[] = [];
  let cached = 0;
  for (const id of candidateIds) {
    const stored = await store.get(id);
    if (stored === undefined) missing.push(id);
    else {
      affinities.set(id, stored);
      cached += 1;
    }
  }
  let batches = 0;
  let partial = false;
  if (missing.length === 0) return { affinities, cached, batches, partial };
  if (signalEntityIds.length === 0) return { affinities, cached, batches, partial: true };
  const signals = signalEntityIds.slice(0, 10);
  for (let offset = 0; offset < missing.length; offset += SCORE_BATCH_SIZE) {
    if (budget.used >= budget.cap) {
      partial = true;
      break;
    }
    const batch = missing.slice(offset, offset + SCORE_BATCH_SIZE);
    const called = await score({
      type: "brand",
      signalEntityIds: signals,
      candidateIds: [...batch],
      take: batch.length,
    });
    batches += 1;
    if (called.data.status === "error") {
      partial = true;
      if (called.data.error?.code === "BUDGET_CAP") break;
      continue;
    }
    for (const brand of readInsightBrands(called.data.entities)) {
      if (brand.affinity === undefined) continue;
      affinities.set(brand.id, brand.affinity);
      await store.set(brand.id, brand.affinity);
    }
  }
  return { affinities, cached, batches, partial };
}
