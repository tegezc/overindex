import { findBridges } from "@/features/sponsor-discovery/application/find-bridges";
import { BRIDGE_COUNT_LABEL } from "@/features/sponsor-discovery/domain/bridges";
import { loadReport } from "@/features/report/application/load-report";
import type { ReportRun } from "@/features/report/application/execute-report";
import type { Report } from "@/features/report/domain/report";
import { businessEvidence, candidateEvidence } from "../domain/candidate-evidence";
import { brandDrawerSchema, MOMENTUM_SKIPPED, type BrandDrawer } from "../domain/drawer";
import { finalizePitch } from "../domain/draft-pitch";
import { evidenceSchema, type Evidence, type PitchDraft } from "../domain/evidence";

export class BrandLookupError extends Error {
  constructor(readonly code: "NOT_FOUND" | "NOT_READY" | "NOT_ON_REPORT" | "NO_SERVICES") {
    super(code);
  }
}

/** Shown when a saved report has no bridge records. This path does not call Qloo to fill the gap. */
export const BRIDGES_NOT_STORED_NOTE =
  "Shared TV shows were not saved with this report. Opening this brand did not request them from Qloo.";

const BRIDGES_SAVED_NOTE =
  "Shared TV shows were already saved on this report. Opening this brand did not request them from Qloo.";

const BRIDGES_SAVED_WITHOUT_COUNT_NOTE =
  "Some shared-TV records were saved without a count. Opening this brand did not request them from Qloo.";

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

/**
 * Brand drawer for a report that is not on the memory board.
 * Scores come from the candidate already stored on the report.
 * Bridges come only from bridge evidence already stored there. Nothing here calls Qloo.
 */
export function openStoredBrand(report: Report, brandId: string): BrandDrawer {
  const section = report.sections.candidates;
  if (section.status === "pending") throw new BrandLookupError("NOT_READY");
  const candidate = section.data?.find((item) => item.brand.id === brandId);
  if (!candidate) throw new BrandLookupError("NOT_ON_REPORT");

  const built = candidateEvidence({
    reportId: report.id,
    createdAt: report.createdAt,
    showQuery: report.input.showQuery,
    candidate,
  });
  const bridges = storedBridges(report, brandId);
  return brandDrawerSchema.parse({
    brandId,
    scores: built.scores,
    bridges: {
      status: bridges.status,
      note: bridges.note,
    },
    momentum: MOMENTUM_SKIPPED,
    evidence: [...built.evidence, ...bridges.evidence],
    budget: report.budget,
    ...(built.categoryNote ? { categoryNote: built.categoryNote } : {}),
  });
}

export async function openBrandForRequest(
  id: string,
  brandId: string,
  readStored?: (id: string) => Promise<Report | undefined>,
): Promise<BrandDrawer> {
  const loaded = await loadReport(id, readStored);
  if (!loaded) throw new BrandLookupError("NOT_FOUND");
  if (loaded.kind === "memory") return openBrand(loaded.run, brandId);
  return openStoredBrand(loaded.report, brandId);
}

export async function pitchForRequest(
  id: string,
  brandId: string,
  userInputs?: { downloadsPerEpisode?: number; cpm?: number },
  readStored?: (id: string) => Promise<Report | undefined>,
): Promise<PitchDraft> {
  const loaded = await loadReport(id, readStored);
  if (!loaded) throw new BrandLookupError("NOT_FOUND");
  const report = loaded.kind === "memory" ? loaded.run.report : loaded.report;
  const drawer = loaded.kind === "memory" ? await openBrand(loaded.run, brandId) : openStoredBrand(report, brandId);
  const candidate = report.sections.candidates.data?.find((item) => item.brand.id === brandId);
  if (!candidate) throw new BrandLookupError("NOT_ON_REPORT");
  return pitchBrand({
    reportId: report.id,
    brandId,
    brandName: candidate.brand.name,
    evidence: drawer.evidence,
    business: userInputs ?? report.input.business,
  });
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

/**
 * Bridge titles on a saved report are text, not entity ids.
 * Do not invent ids, and do not call Qloo to recover them.
 */
function storedBridges(report: Report, brandId: string): {
  status: "ok" | "empty" | "partial" | "skipped";
  note: string;
  evidence: Evidence[];
} {
  const prefix = `bridge:${brandId}:`;
  const evidence: Evidence[] = [];
  for (const [key, value] of Object.entries(report.evidence)) {
    const parsed = evidenceSchema.safeParse(value);
    if (!parsed.success || parsed.data.kind !== "bridge") continue;
    if (!parsed.data.id.startsWith(prefix) && !key.startsWith(prefix)) continue;
    evidence.push(parsed.data);
  }
  if (evidence.length === 0) {
    return { status: "skipped", note: BRIDGES_NOT_STORED_NOTE, evidence: [] };
  }
  const countItem = evidence.find((item) => item.label === BRIDGE_COUNT_LABEL && typeof item.value === "number");
  const count = typeof countItem?.value === "number" ? countItem.value : undefined;
  if (count === undefined) {
    return { status: "partial", note: BRIDGES_SAVED_WITHOUT_COUNT_NOTE, evidence };
  }
  return {
    status: count === 0 ? "empty" : "ok",
    note: BRIDGES_SAVED_NOTE,
    evidence,
  };
}
