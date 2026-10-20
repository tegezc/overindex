import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileQlooCache } from "@/shared/cache/file-cache";
import { BudgetCounter } from "@/shared/qloo/application/budget";
import { QlooGateway } from "@/shared/qloo/application/qloo-gateway";
import { FakeQloo } from "@/shared/qloo/infrastructure/fake-qloo";
import { MemoryTraceSink } from "@/shared/trace/trace";
import { MemoryBaselineStore } from "../infrastructure/baseline-store";
import { runSponsorDiscovery } from "./run-sponsor-discovery";

const SHOW = "AAAAAAAA-BBBB-4CCC-8DDD-000000000001";
const BASKET = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000B9";
const ALPHA = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1";
const BETA = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000B2";
const DELTA = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000D4";

describe("runSponsorDiscovery", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("scores through insights, marks renewal, drops an excluded category, and records the call count", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "overindex-sponsor-"));
    const fake = new FakeQloo({
      describe: [
        {
          status: "ok",
          summary: "show",
          results: [
            {
              entity_id: SHOW,
              name: "Show North",
              type: "podcast",
              properties: { short_description: "A north desk." },
            },
          ],
          result_count: 1,
        },
        {
          status: "ok",
          summary: "basket",
          results: [{ entity_id: BASKET, name: "Basket Show", type: "podcast" }],
          result_count: 1,
        },
      ],
      insightsRaw: [
        {
          status: "ok",
          entities: [
            { entity_id: ALPHA, name: "Brand Alpha", popularity: 0.9 },
            { entity_id: DELTA, name: "Brand Delta", popularity: 0.5 },
          ],
          result_count: 2,
        },
        {
          status: "ok",
          entities: [
            { entity_id: ALPHA, name: "Brand Alpha", popularity: 0.9 },
            { entity_id: BETA, name: "Brand Beta", popularity: 0.2 },
          ],
          result_count: 2,
        },
      ],
      scoreCandidates: [
        {
          status: "ok",
          entities: [
            { entity_id: ALPHA, name: "Brand Alpha", popularity: 0.9, tags: [{ name: "Retail" }], query: { affinity: 0.9 } },
            { entity_id: BETA, name: "Brand Beta", popularity: 0.5, query: { affinity: 0.2 } },
            { entity_id: DELTA, name: "Brand Delta", popularity: 0.4, tags: [{ name: "Gambling" }], query: { affinity: 0.99 } },
          ],
          result_count: 3,
        },
        {
          status: "ok",
          entities: [
            { entity_id: ALPHA, name: "Brand Alpha", query: { affinity: 0.1 } },
            { entity_id: BETA, name: "Brand Beta", query: { affinity: 0.8 } },
            { entity_id: DELTA, name: "Brand Delta", query: { affinity: 0.01 } },
          ],
          result_count: 3,
        },
      ],
    });
    const trace = new MemoryTraceSink(() => new Date("2026-10-20T02:00:00.000Z"));
    const budget = new BudgetCounter(6, 6);
    const gateway = new QlooGateway(fake, {
      budget,
      trace,
      cache: new FileQlooCache(dir, () => new Date("2026-10-20T02:00:00.000Z")),
      sleep: async () => {},
      now: () => new Date("2026-10-20T02:00:00.000Z"),
    });
    const result = await runSponsorDiscovery(
      {
        showQuery: "Show North",
        currentSponsors: ["Brand Alpha"],
        excludedCategories: ["gambling"],
        planSlack: 0,
        basketNames: ["Basket Show"],
      },
      {
        describe: (input) => gateway.describe(input),
        insightsRaw: (input) => gateway.insightsRaw(input),
        scoreCandidates: (input) => gateway.scoreCandidates(input),
        llmBaseline: async () => ({
          brands: [
            { name: "Brand Alpha", category: "Retail" },
            { name: "Brand Zeta", category: "Food" },
          ],
        }),
        disambiguate: async () => {
          throw new Error("disambiguate should not run");
        },
        trace,
        budget,
        laneA: { names: ["Brand Alpha", "Unseen Buyer"], normalized: new Set(["brand alpha", "unseen buyer"]) },
        baselineStore: new MemoryBaselineStore(),
      },
    );

    expect(result.counts.qlooCalls).toBeLessThanOrEqual(6);
    expect(result.counts.qlooCalls).toBe(budget.used);
    expect(result.counts.excluded).toBe(1);
    expect(result.candidates.map((candidate) => candidate.brand.name)).toEqual(["Brand Alpha", "Brand Beta"]);
    expect(result.candidates[0]).toMatchObject({ lane: "A", quadrant: "proven", flags: { renewal: true } });
    expect(result.candidates[1]).toMatchObject({ lane: "B", quadrant: "none" });
    expect(result.counts).toMatchObject({
      candidates: 2,
      laneA: 1,
      laneB: 1,
      proven: 1,
      none: 1,
      renewal: 1,
      discoverOverlap: 1,
      laneAPending: 1,
      basketSignals: 1,
    });
    const scored = fake.calls.filter((call) => hasCandidateIds(call.args));
    expect(scored).toHaveLength(2);
    expect(scored[0]?.args).toMatchObject({ signalEntityIds: [SHOW], type: "brand" });
    expect(scored[1]?.args).toMatchObject({ signalEntityIds: [BASKET], type: "brand" });
    expect(JSON.stringify(fake.calls)).not.toContain("rank");
    expect(trace.events().some((event) => event.kind === "budget" && event.summary === `qloo calls ${budget.used}`)).toBe(
      true,
    );
    expect(result.status).toBe("partial");
  });
});

function hasCandidateIds(args: unknown): args is { candidateIds: string[] } {
  return Boolean(args && typeof args === "object" && "candidateIds" in args);
}
