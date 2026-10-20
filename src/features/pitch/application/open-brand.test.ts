import { describe, expect, it } from "vitest";
import { ReportRun } from "@/features/report/application/execute-report";
import { reportSchema } from "@/features/report/domain/report";
import type { BrandCandidate } from "@/features/sponsor-discovery/domain/types";
import { MemoryBaselineStore } from "@/features/sponsor-discovery/infrastructure/baseline-store";
import { BudgetCounter } from "@/shared/qloo/application/budget";
import type { QlooCache } from "@/shared/qloo/application/qloo-cache";
import { QlooGateway } from "@/shared/qloo/application/qloo-gateway";
import { FakeQloo } from "@/shared/qloo/infrastructure/fake-qloo";
import { LlmGateway } from "@/shared/llm/application/llm-gateway";
import { FakeLlm } from "@/shared/llm/infrastructure/fake-llm";
import { MemoryTraceSink } from "@/shared/trace/trace";
import { openBrand, pitchBrand } from "./open-brand";

const cache: QlooCache = {
  async get() {
    return undefined;
  },
  async set() {},
};

const BRAND = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1";
const SHOW = "AAAAAAAA-BBBB-4CCC-8DDD-000000000001";

const candidate: BrandCandidate = {
  brand: { id: BRAND, name: "Brand Alpha", type: "brand" },
  origins: ["qloo_discovery"],
  affinityRaw: 0.81,
  popularity: 0.42,
  pctShow: 1,
  reachBand: "established",
  lane: "B",
  quadrant: "none",
  flags: {},
};

describe("openBrand", () => {
  it("loads score evidence, skips momentum, and drafts a pitch that passes", async () => {
    const fake = new FakeQloo();
    const trace = new MemoryTraceSink();
    const budget = new BudgetCounter(25, 40);
    const run = new ReportRun(
      reportSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-10-20T02:00:00.000Z",
        input: { showQuery: "Show North" },
        context: {
          mode: "direct",
          show: { id: SHOW, name: "Show North", type: "podcast" },
          tags: [],
          confidence: "medium",
        },
        sections: {
          tasteCard: { status: "ok" },
          candidates: { status: "partial", data: [candidate], note: "Shortlist is partial." },
          withoutQloo: { status: "empty", note: "No names." },
        },
        evidence: {},
        budget: budget.snapshot(),
        trace: [],
      }),
    );
    run.services = {
      qloo: new QlooGateway(fake, { budget, trace, cache }),
      llm: new LlmGateway(new FakeLlm()),
      trace,
      budget,
      laneA: { names: [], normalized: new Set() },
      baselineStore: new MemoryBaselineStore(),
      paceMs: 0,
    };

    const drawer = await openBrand(run, BRAND);
    expect(drawer.momentum.status).toBe("skipped");
    expect(drawer.scores.some((row) => row.source === "qloo")).toBe(true);
    expect(drawer.evidence.some((item) => item.provenance?.tool === "qloo_recommend")).toBe(true);
    expect(drawer.evidence.some((item) => item.kind === "user_input")).toBe(true);
    expect(fake.calls.map((call) => call.tool)).toEqual(["qloo_recommend", "qloo_recommend"]);

    const again = await openBrand(run, BRAND);
    expect(again).toBe(drawer);
    expect(fake.calls).toHaveLength(2);

    const pitch = pitchBrand({
      reportId: run.report.id,
      brandId: BRAND,
      brandName: candidate.brand.name,
      evidence: drawer.evidence,
    });
    expect(pitch.check.passed).toBe(true);
    expect(pitch.claims.length).toBeGreaterThan(0);
    expect(pitch.claims.every((claim) => claim.source === "qloo" || claim.source === "user_input")).toBe(true);
  });
});
