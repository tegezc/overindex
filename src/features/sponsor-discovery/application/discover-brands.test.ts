import { describe, expect, it } from "vitest";
import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { InsightsResult } from "@/shared/qloo/domain/envelope";
import type { InsightsRawInput } from "@/shared/qloo/domain/inputs";
import { discoverBrands } from "./discover-brands";

const SHOW = "AAAAAAAA-BBBB-4CCC-8DDD-000000000001";
const ALPHA = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1";
const BETA = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000B2";

function call(entities: InsightsResult["entities"]): QlooCall<InsightsResult> {
  return {
    data: { status: "ok", entities, result_count: entities.length },
    provenance: {
      callId: "local",
      tool: "api:insights",
      params: {},
      at: "2026-10-20T00:00:00.000Z",
      status: "ok",
      cached: false,
    },
  };
}

describe("discoverBrands", () => {
  it("requests two popularity bands and dedupes entity ids", async () => {
    const seen: InsightsRawInput[] = [];
    const budget = { used: 0, cap: 40 };
    const result = await discoverBrands(
      SHOW,
      budget,
      async (input) => {
        seen.push(input);
        budget.used += 1;
        const entities =
          seen.length === 1
            ? [{ entity_id: ALPHA, name: "Brand Alpha", popularity: 0.9 }]
            : [
                { entity_id: ALPHA, name: "Brand Alpha", popularity: 0.9 },
                { entity_id: BETA, name: "Brand Beta", popularity: 0.2 },
              ];
        return call(entities);
      },
      0,
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]?.type).toBe("brand");
    expect(seen[0]?.signalEntityIds).toEqual([SHOW]);
    expect(seen[0]?.params?.["filter.popularity.min"]).toBe(0.4);
    expect(seen[1]?.params?.["filter.popularity.max"]).toBe(0.4);
    expect(JSON.stringify(seen)).not.toContain("rank");
    expect(result.brands.map((brand) => brand.id)).toEqual([ALPHA, BETA]);
    expect(result.overlap).toBe(1);
    expect(result.partial).toBe(false);
  });

  it("stops when the plan cannot afford another band", async () => {
    const budget = { used: 38, cap: 40 };
    let calls = 0;
    const result = await discoverBrands(
      SHOW,
      budget,
      async () => {
        calls += 1;
        return call([]);
      },
      2,
    );
    expect(calls).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.brands).toEqual([]);
  });
});
