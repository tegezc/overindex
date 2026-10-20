import { findBridges } from "@/features/sponsor-discovery/application/find-bridges";
import type { ReportRun } from "@/features/report/application/execute-report";
import { businessEvidence, candidateEvidence } from "../domain/candidate-evidence";
import { brandDrawerSchema, MOMENTUM_SKIPPED, type BrandDrawer } from "../domain/drawer";
import { finalizePitch } from "../domain/draft-pitch";
import type { Evidence, PitchDraft } from "../domain/evidence";

export class BrandLookupError extends Error {
  constructor(readonly code: "NOT_READY" | "NOT_ON_REPORT" | "NO_SERVICES") {
    super(code);
  }
}

const drawers = new WeakMap<ReportRun, Map<string, BrandDrawer>>();
const jobs = new WeakMap<ReportRun, Map<string, Promise<BrandDrawer>>>();

export async function openBrand(run: ReportRun, brandId: string): Promise<BrandDrawer> {
  const cached = drawers.get(run)?.get(brandId);
  if (cached) return cached;
  let pending = jobs.get(run);
  if (!pending) {
    pending = new Map();
    jobs.set(run, pending);
  }
  const existing = pending.get(brandId);
  if (existing) return existing;
  const job = buildBrand(run, brandId).then(
    (drawer) => {
      const stored = drawers.get(run) ?? new Map<string, BrandDrawer>();
      stored.set(brandId, drawer);
      drawers.set(run, stored);
      pending.delete(brandId);
      return drawer;
    },
    (error: unknown) => {
      pending.delete(brandId);
      throw error;
    },
  );
  pending.set(brandId, job);
  return job;
}

export function pitchBrand(input: {
  reportId: string;
  brandId: string;
  brandName: string;
  evidence: readonly Evidence[];
  business?: { downloadsPerEpisode?: number; cpm?: number };
}): PitchDraft {
  const downloadsId = `user:${input.reportId}:downloads`;
  const cpmId = `user:${input.reportId}:cpm`;
  const evidence = [
    ...input.evidence.filter((item) => item.id !== downloadsId && item.id !== cpmId),
    ...businessEvidence(input.reportId, input.business),
  ];
  return finalizePitch({
    brandId: input.brandId,
    brandName: input.brandName,
    evidence,
  });
}

async function buildBrand(run: ReportRun, brandId: string): Promise<BrandDrawer> {
  const services = run.services;
  if (!services) throw new BrandLookupError("NO_SERVICES");
  const section = run.report.sections.candidates;
  if (section.status === "pending") throw new BrandLookupError("NOT_READY");
  const candidate = section.data?.find((item) => item.brand.id === brandId);
  if (!candidate) throw new BrandLookupError("NOT_ON_REPORT");

  const built = candidateEvidence({
    reportId: run.report.id,
    createdAt: run.report.createdAt,
    showQuery: run.report.input.showQuery,
    candidate,
  });
  const showId = run.report.context.show?.id;
  const stop = services.trace.subscribe((event) => {
    if (run.report.trace.some((item) => item.seq === event.seq)) return;
    run.publish({ event: "trace", data: event });
    if (event.kind === "tool_result" || event.kind === "budget") {
      run.publish({ event: "budget", data: services.budget.snapshot() });
    }
  });
  try {
    const bridges = showId
      ? await findBridges({
          reportId: run.report.id,
          showId,
          brandId,
          recommend: (input) => services.qloo.recommend(input),
          at: new Date().toISOString(),
        })
      : {
          status: "error" as const,
          note: "This report has no confirmed show, so TV recommendations were not requested.",
          shared: [],
          evidence: [],
        };
    services.trace.emit({ kind: "decision", summary: `find_bridges tv_show ${bridges.status}` });
    services.trace.emit({ kind: "decision", summary: "brand_momentum skipped" });

    const evidence = [...built.evidence, ...bridges.evidence];
    for (const item of evidence) run.report.evidence[item.id] = item;
    run.report.budget = services.budget.snapshot();

    return brandDrawerSchema.parse({
      brandId,
      scores: built.scores,
      bridges: {
        status: bridges.status,
        ...(bridges.shared.length > 0 ? { data: bridges.shared } : {}),
        ...(bridges.note ? { note: bridges.note } : {}),
      },
      momentum: MOMENTUM_SKIPPED,
      evidence,
      budget: run.report.budget,
      ...(built.categoryNote ? { categoryNote: built.categoryNote } : {}),
    });
  } finally {
    stop();
  }
}
