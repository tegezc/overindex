import { describe, expect, it } from "vitest";
import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { InsightsResult } from "@/shared/qloo/domain/envelope";
import type { ScoreCandidatesInput } from "@/shared/qloo/domain/inputs";
import { scoreCandidateSet } from "./score-candidates";

const SHOW = "AAAAAAAA-BBBB-4CCC-8DDD-000000000001";

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `AAAAAAAA-BBBB-4CCC-8DDD-${String(index + 1).padStart(12, "0")}`);
}

describe("scoreCandidateSet", () => {
  it("sends filter batches of 30 through scoreCandidates and never rank", async () => {
    const seen: ScoreCandidatesInput[] = [];
    const budget = { used: 0, cap: 40 };
    const candidateIds = ids(31);
    const result = await scoreCandidateSet(candidateIds, [SHOW], budget, async (input) => {
      seen.push(input);
      budget.used += 1;
      const entities = input.candidateIds.map((id, index) => ({
        entity_id: id,
        name: `Brand ${index}`,
        query: { affinity: 0.5 },
      }));
      return scored(entities);
    });
    expect(seen.map((input) => input.candidateIds.length)).toEqual([30, 1]);
    expect(seen.every((input) => input.signalEntityIds?.join(",") === SHOW)).toBe(true);
    expect(seen.every((input) => input.type === "brand")).toBe(true);
    expect(JSON.stringify(seen)).not.toContain("rank");
    expect(result.batches).toBe(2);
    expect(result.byId.size).toBe(31);
    expect(result.partial).toBe(false);
  });

  it("stops before a batch that would leave no room for baseline", async () => {
    const budget = { used: 39, cap: 40 };
    let calls = 0;
    const result = await scoreCandidateSet(["id-1"], [SHOW], budget, async () => {
      calls += 1;
      return scored([]);
    });
    expect(calls).toBe(0);
    expect(result.partial).toBe(true);
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
