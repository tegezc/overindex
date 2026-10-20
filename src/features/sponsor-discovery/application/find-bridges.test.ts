import { describe, expect, it } from "vitest";
import { BudgetCounter } from "@/shared/qloo/application/budget";
import type { QlooCache } from "@/shared/qloo/application/qloo-cache";
import { QlooGateway } from "@/shared/qloo/application/qloo-gateway";
import { FakeQloo } from "@/shared/qloo/infrastructure/fake-qloo";
import { MemoryTraceSink } from "@/shared/trace/trace";
import { BRIDGE_LIMIT, findBridges } from "./find-bridges";

const cache: QlooCache = {
  async get() {
    return undefined;
  },
  async set() {},
};

const SHOW = "show-1";
const BRAND = "brand-1";

function envelope(rows: { entity_id: string; name: string }[]) {
  return {
    status: "ok" as const,
    summary: "Synthetic recommendations",
    results: rows.map((row) => ({ ...row, type: "tv_show" })),
    result_count: rows.length,
  };
}

describe("findBridges", () => {
  it("intersects tv_show recommendations and does not call compare or trends", async () => {
    const fake = new FakeQloo({
      recommend: [
        envelope([
          { entity_id: "title-north", name: "Title North" },
          { entity_id: "title-south", name: "Title South" },
        ]),
        envelope([
          { entity_id: "title-east", name: "Title East" },
          { entity_id: "title-south", name: "Title South" },
        ]),
      ],
    });
    const gateway = new QlooGateway(fake, {
      budget: new BudgetCounter(25, 40),
      trace: new MemoryTraceSink(),
      cache,
    });
    const result = await findBridges({
      reportId: "11111111-1111-4111-8111-111111111111",
      showId: SHOW,
      brandId: BRAND,
      recommend: (input) => gateway.recommend(input),
      at: "2026-10-20T02:00:00.000Z",
    });
    expect(result.status).toBe("ok");
    expect(result.shared).toEqual([{ id: "title-south", name: "Title South" }]);
    expect(result.evidence.map((item) => item.provenance?.tool)).toEqual([
      "qloo_recommend",
      "qloo_recommend",
      "derived:scoring",
      "qloo_recommend",
    ]);
    expect(fake.calls.map((call) => call.tool)).toEqual(["qloo_recommend", "qloo_recommend"]);
    expect(fake.calls.map((call) => call.args)).toEqual([
      { target_type: "tv_show", signals: [SHOW], limit: BRIDGE_LIMIT, explain: false },
      { target_type: "tv_show", signals: [BRAND], limit: BRIDGE_LIMIT, explain: false },
    ]);
  });

  it("stops after a failed show recommendation", async () => {
    const fake = new FakeQloo({
      recommend: [
        {
          status: "error",
          summary: "SYNTHETIC_ERROR",
          results: [],
          result_count: 0,
          error: { code: "SYNTHETIC_ERROR", retryable: false },
        },
      ],
    });
    const gateway = new QlooGateway(fake, {
      budget: new BudgetCounter(25, 40),
      trace: new MemoryTraceSink(),
      cache,
    });
    const result = await findBridges({
      reportId: "11111111-1111-4111-8111-111111111111",
      showId: SHOW,
      brandId: BRAND,
      recommend: (input) => gateway.recommend(input),
      at: "2026-10-20T02:00:00.000Z",
    });
    expect(result.status).toBe("error");
    expect(result.shared).toEqual([]);
    expect(fake.calls.map((call) => call.tool)).toEqual(["qloo_recommend"]);
  });
});
