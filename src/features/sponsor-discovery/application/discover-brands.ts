import { DISCOVER_TAKE, POPULARITY_BANDS } from "@/shared/config/scoring";
import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { InsightsResult } from "@/shared/qloo/domain/envelope";
import type { InsightsRawInput } from "@/shared/qloo/domain/inputs";
import { withinPlan } from "../domain/budget-plan";
import { readInsightBrands, type InsightBrand } from "../domain/entities";

export type DiscoverBrandsResult = {
  brands: InsightBrand[];
  overlap: number;
  partial: boolean;
};

/**
 * Two popularity bands through `qloo api insights`.
 * `qloo_recommend` cannot express a popularity filter, and `qloo_rank` is not used.
 */
export async function discoverBrands(
  showEntityId: string,
  budget: { used: number; cap: number },
  insightsRaw: (input: InsightsRawInput) => Promise<QlooCall<InsightsResult>>,
  slack: number,
): Promise<DiscoverBrandsResult> {
  const found = new Map<string, InsightBrand>();
  let overlap = 0;
  let partial = false;
  for (const band of POPULARITY_BANDS) {
    if (!withinPlan(budget.used, budget.cap, 1, found.size + DISCOVER_TAKE, slack)) {
      partial = true;
      break;
    }
    const params: Record<string, number> = { "filter.popularity.min": band.min };
    if ("max" in band) params["filter.popularity.max"] = band.max;
    const called = await insightsRaw({
      type: "brand",
      signalEntityIds: [showEntityId],
      take: DISCOVER_TAKE,
      params,
    });
    if (called.data.status === "error") {
      partial = true;
      if (called.data.error?.code === "BUDGET_CAP") break;
      continue;
    }
    for (const brand of readInsightBrands(called.data.entities).slice(0, DISCOVER_TAKE)) {
      if (found.has(brand.id)) {
        overlap += 1;
        continue;
      }
      found.set(brand.id, brand);
    }
  }
  return { brands: [...found.values()], overlap, partial };
}
