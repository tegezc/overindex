import { describe, expect, it } from "vitest";
import type { InsightsResult } from "@/shared/qloo/domain/envelope";
import type { ScoreCandidatesInput } from "@/shared/qloo/domain/inputs";
import type { QlooCall } from "@/shared/qloo/domain/provenance";
import { MemoryBaselineStore } from "../infrastructure/baseline-store";
import { baselineAffinity } from "./baseline-affinity";

const SHOW = "AAAAAAAA-BBBB-4CCC-8DDD-000000000001";
const ALPHA = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1";
const BETA = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000B2";

describe("baselineAffinity", () => {
  it("skips ids already stored and scores the rest against the basket signal", async () => {
    const store = new MemoryBaselineStore();
    await store.set(ALPHA, 0.2);
    const seen: ScoreCandidatesInput[] = [];
    const budget = { used: 0, cap: 40 };
    const result = await baselineAffinity([ALPHA, BETA], [SHOW, "basket-2"], budget, store, async (input) => {
      seen.push(input);
      budget.used += 1;
      return scored([{ entity_id: BETA, name: "Brand Beta", query: { affinity: 0.7 } }]);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.candidateIds).toEqual([BETA]);
    expect(seen[0]?.signalEntityIds).toEqual([SHOW, "basket-2"]);
    expect(JSON.stringify(seen)).not.toContain("rank");
    expect(result.cached).toBe(1);
    expect(result.batches).toBe(1);
    expect(result.affinities.get(ALPHA)).toBe(0.2);
    expect(result.affinities.get(BETA)).toBe(0.7);
    expect(await store.get(BETA)).toBe(0.7);
    expect(result.partial).toBe(false);
  });

  it("does not call insights when every affinity is cached", async () => {
    const store = new MemoryBaselineStore();
    await store.set(ALPHA, 0.4);
    let calls = 0;
    const result = await baselineAffinity([ALPHA], [SHOW], { used: 0, cap: 40 }, store, async () => {
      calls += 1;
      return scored([]);
    });
    expect(calls).toBe(0);
    expect(result.cached).toBe(1);
    expect(result.partial).toBe(false);
  });

  it("stays partial when the basket signal is empty", async () => {
    const result = await baselineAffinity([ALPHA], [], { used: 0, cap: 40 }, new MemoryBaselineStore(), async () => scored([]));
    expect(result.partial).toBe(true);
    expect(result.batches).toBe(0);
  });
});

function scored(entities: InsightsResult["entities"]): QlooCall<InsightsResult> {
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
