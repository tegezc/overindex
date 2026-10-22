import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getReportBoard, ReportRun } from "@/features/report/application/execute-report";
import { reportSchema, type Report } from "@/features/report/domain/report";
import { readFeaturedReport, writeFeatured } from "@/features/report/infrastructure/featured-store";
import { BRIDGE_COUNT_LABEL } from "@/features/sponsor-discovery/domain/bridges";
import type { BrandCandidate } from "@/features/sponsor-discovery/domain/types";
import { MemoryBaselineStore } from "@/features/sponsor-discovery/infrastructure/baseline-store";
import { BudgetCounter } from "@/shared/qloo/application/budget";
import type { QlooCache } from "@/shared/qloo/application/qloo-cache";
import { QlooGateway } from "@/shared/qloo/application/qloo-gateway";
import { FakeQloo } from "@/shared/qloo/infrastructure/fake-qloo";
import { LlmGateway } from "@/shared/llm/application/llm-gateway";
import { FakeLlm } from "@/shared/llm/infrastructure/fake-llm";
import { MemoryTraceSink } from "@/shared/trace/trace";
import { claimSourceLabel } from "../domain/evidence";
import { BRIDGES_NOT_STORED_NOTE, openBrand, openBrandForRequest, pitchBrand, pitchForRequest } from "./open-brand";

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

const FEATURED = "33333333-3333-4333-8333-333333333333";
const STORED_BRAND = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000B2";

describe("featured report that is not on the memory board", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("opens the brand from the featured file and drafts a pitch with source labels", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "overindex-featured-brand-"));
    await writeFeatured(dir, storedReport(FEATURED, {}), "2026-10-21");
    expect(getReportBoard().get(FEATURED)).toBeUndefined();
    let reads = 0;
    const readStored = async (id: string) => {
      reads += 1;
      return readFeaturedReport(dir, id);
    };

    const drawer = await openBrandForRequest(FEATURED, STORED_BRAND, readStored);
    const pitch = await pitchForRequest(FEATURED, STORED_BRAND, undefined, readStored);

    expect(getReportBoard().get(FEATURED)).toBeUndefined();
    expect(reads).toBeGreaterThan(0);
    expect(drawer.bridges.status).toBe("skipped");
    expect(drawer.bridges.note).toBe(BRIDGES_NOT_STORED_NOTE);
    expect(drawer.evidence.some((item) => item.provenance?.tool === "qloo_recommend")).toBe(false);
    expect(drawer.scores.some((row) => row.source === "qloo")).toBe(true);
    expect(pitch.check.passed).toBe(true);
    expect(pitch.claims.length).toBeGreaterThan(0);
    const labels = pitch.claims.map((claim) => claimSourceLabel(claim.source));
    expect(labels).toContain("Qloo");
    expect(labels).toContain("input Anda");
    expect(labels.every((label) => label === "Qloo" || label === "input Anda")).toBe(true);
  });

  it("uses bridge evidence already stored on the featured report and does not call Qloo", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "overindex-featured-bridge-"));
    const evidenceId = `bridge:${STORED_BRAND}:count`;
    await writeFeatured(
      dir,
      storedReport(FEATURED, {
        [evidenceId]: {
          id: evidenceId,
          kind: "bridge",
          label: BRIDGE_COUNT_LABEL,
          value: 0,
          provenance: {
            callId: `derived:${FEATURED}:${STORED_BRAND}:bridge-count`,
            tool: "derived:scoring",
            params: { field: "bridge-count", note: "Saved with the report." },
            at: "2026-10-21T00:00:00.000Z",
            status: "ok",
            cached: true,
          },
        },
      }),
      "2026-10-21",
    );
    expect(getReportBoard().get(FEATURED)).toBeUndefined();

    const drawer = await openBrandForRequest(FEATURED, STORED_BRAND, (id) => readFeaturedReport(dir, id));
    const pitch = await pitchForRequest(FEATURED, STORED_BRAND, undefined, (id) => readFeaturedReport(dir, id));

    expect(drawer.bridges.status).toBe("empty");
    expect(drawer.bridges.note).toMatch(/did not request them from Qloo/i);
    expect(drawer.evidence.some((item) => item.provenance?.tool === "qloo_recommend")).toBe(false);
    expect(pitch.check.passed).toBe(true);
    expect(pitch.claims.map((claim) => claimSourceLabel(claim.source)).every((label) => label === "Qloo" || label === "input Anda")).toBe(
      true,
    );
  });
});

function storedReport(id: string, evidence: Report["evidence"]): Report {
  const candidate: BrandCandidate = {
    brand: { id: STORED_BRAND, name: "Brand Alpha", type: "brand" },
    origins: ["qloo_discovery"],
    affinityRaw: 0.81,
    popularity: 0.42,
    pctShow: 1,
    reachBand: "established",
    lane: "B",
    quadrant: "none",
    flags: {},
  };
  return reportSchema.parse({
    id,
    createdAt: "2026-10-21T02:00:00.000Z",
    input: { showQuery: "Show North" },
    context: {
      mode: "direct",
      show: { id: "show-north", name: "Show North", type: "podcast" },
      tags: [],
      confidence: "medium",
    },
    sections: {
      tasteCard: { status: "ok" },
      candidates: { status: "ok", data: [candidate] },
      withoutQloo: { status: "empty", note: "No names." },
    },
    evidence,
    budget: { used: 4, target: 25, cap: 40 },
    trace: [],
  });
}
