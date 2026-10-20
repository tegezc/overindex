import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileQlooCache } from "@/shared/cache/file-cache";
import { BudgetCounter } from "@/shared/qloo/application/budget";
import { QlooGateway } from "@/shared/qloo/application/qloo-gateway";
import { FakeQloo, FAKE_ERROR_SHOW } from "@/shared/qloo/infrastructure/fake-qloo";
import { LlmGateway } from "@/shared/llm/application/llm-gateway";
import { FakeLlm } from "@/shared/llm/infrastructure/fake-llm";
import { MemoryTraceSink } from "@/shared/trace/trace";
import { MemoryBaselineStore } from "@/features/sponsor-discovery/infrastructure/baseline-store";
import { loadLaneACatalog } from "@/features/sponsor-discovery/infrastructure/lane-a-file";
import { laneBStatus, reportSchema } from "../domain/report";
import { encodeSse, executeReport, ReportRun, type ReportServices } from "./execute-report";
import { POST } from "@/app/api/report/route";

describe("report stream", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("encodes named server-sent events", () => {
    const text = encodeSse({ event: "done", data: { reportId: "11111111-1111-4111-8111-111111111111" } });
    expect(text).toBe('event: done\ndata: {"reportId":"11111111-1111-4111-8111-111111111111"}\n\n');
  });

  it("hides lane B only for tags-only mode", () => {
    expect(laneBStatus("tags_only", "ok")).toBe("skipped");
    expect(laneBStatus("direct", "partial")).toBe("partial");
  });

  it("rejects a report request without a show query", async () => {
    const response = await POST(new Request("http://localhost/api/report", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("publishes pending sections before a partial shortlist", async () => {
    const { run } = await runFake("Show North");
    const sections = run.events.filter((event) => event.event === "section");
    expect(sections.slice(0, 3).map((event) => event.data.section.status)).toEqual(["pending", "pending", "pending"]);
    expect(run.report.sections.tasteCard.status).toBe("ok");
    expect(run.report.sections.withoutQloo.status).toBe("ok");
    expect(run.report.sections.candidates.status).toBe("partial");
    expect(run.report.sections.candidates.note).toMatch(/partial/i);
    expect(run.events.at(-1)?.event).toBe("done");
    expect(run.report.trace.some((event) => event.kind === "tool_result")).toBe(true);
    expect(reportSchema.safeParse(run.report).success).toBe(true);
  });

  it("keeps an explained error on the taste card instead of failing the run", async () => {
    const { run } = await runFake(FAKE_ERROR_SHOW);
    expect(run.report.sections.tasteCard.status).toBe("error");
    expect(run.report.sections.tasteCard.note).toMatch(/error/i);
    expect(run.events.some((event) => event.event === "error")).toBe(true);
    expect(run.events.at(-1)?.event).toBe("done");
    expect(run.finished).toBe(true);
    expect(reportSchema.safeParse(run.report).success).toBe(true);
  });

  async function runFake(showName: string): Promise<{ run: ReportRun }> {
    dir = mkdtempSync(path.join(tmpdir(), "overindex-report-"));
    const services = fakeServices(dir);
    const run = new ReportRun(
      reportSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-10-20T02:00:00.000Z",
        input: { showQuery: showName },
        context: {
          mode: "direct",
          tags: [],
          confidence: "low",
        },
        sections: {
          tasteCard: { status: "pending" },
          candidates: { status: "pending" },
          withoutQloo: { status: "pending" },
        },
        evidence: {},
        budget: services.budget.snapshot(),
        trace: [],
      }),
    );
    await executeReport(run, services);
    return { run };
  }
});

function fakeServices(cacheDir: string): ReportServices {
  const trace = new MemoryTraceSink();
  const budget = new BudgetCounter(25, 40);
  const qloo = new QlooGateway(new FakeQloo(), {
    budget,
    trace,
    cache: new FileQlooCache(cacheDir),
  });
  return {
    qloo,
    llm: new LlmGateway(new FakeLlm()),
    trace,
    budget,
    laneA: loadLaneACatalog(path.join(process.cwd(), "eval/dataset/lane_a_buyers.csv")),
    baselineStore: new MemoryBaselineStore(),
    paceMs: 0,
  };
}
