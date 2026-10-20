import path from "node:path";
import { randomUUID } from "node:crypto";
import { runSponsorDiscovery, type BaselineOutcome, type SponsorDiscoveryResult } from "@/features/sponsor-discovery/application/run-sponsor-discovery";
import type { BrandCandidate } from "@/features/sponsor-discovery/domain/types";
import type { BaselineAffinityStore } from "@/features/sponsor-discovery/domain/baseline-store";
import { FileBaselineStore } from "@/features/sponsor-discovery/infrastructure/baseline-store";
import { loadLaneACatalog, type LaneACatalog } from "@/features/sponsor-discovery/infrastructure/lane-a-file";
import { resolveShow } from "@/features/show/application/resolve-show";
import { showProfile } from "@/features/show/application/show-profile";
import type { TasteCard } from "@/features/show/domain/taste-card";
import { FileQlooCache } from "@/shared/cache/file-cache";
import { getEnv, type Env } from "@/shared/config/env";
import { LlmGateway } from "@/shared/llm/application/llm-gateway";
import { FakeLlm } from "@/shared/llm/infrastructure/fake-llm";
import { createOpenAiLlm, parseReasoningEffort } from "@/shared/llm/infrastructure/openai-llm";
import { BudgetCounter } from "@/shared/qloo/application/budget";
import { QlooGateway } from "@/shared/qloo/application/qloo-gateway";
import { FakeQloo } from "@/shared/qloo/infrastructure/fake-qloo";
import { HarnessQloo } from "@/shared/qloo/infrastructure/harness-qloo";
import { getSharedMcpClient } from "@/shared/qloo/infrastructure/mcp-qloo-client";
import { QlooApiRunner } from "@/shared/qloo/infrastructure/qloo-api-runner";
import { MemoryTraceSink } from "@/shared/trace/trace";
import {
  confidenceFor,
  notedSection,
  pendingSection,
  reportSchema,
  tasteCardSection,
  type NamedBrand,
  type Report,
  type ReportRequest,
  type ReportSectionName,
  type ReportStreamEvent,
  type Section,
  type SectionStatus,
  type ShowContext,
} from "../domain/report";

/** Gap between section events on the fake adapter so a browser can see each status. Live runs do not wait. */
export const FAKE_SECTION_PACE_MS = 900;

export type ReportServices = {
  qloo: QlooGateway;
  llm: LlmGateway;
  trace: MemoryTraceSink;
  budget: BudgetCounter;
  laneA: LaneACatalog;
  baselineStore: BaselineAffinityStore;
  paceMs: number;
  sleep?: (ms: number) => Promise<void>;
};

export class ReportRun {
  readonly events: ReportStreamEvent[] = [];
  /** Kept for on-demand brand calls so they share this report's budget and cache. */
  services?: ReportServices;
  finished = false;
  private readonly listeners = new Set<(event: ReportStreamEvent) => void>();
  private readonly waiters: (() => void)[] = [];

  constructor(readonly report: Report) {}

  subscribe(listener: (event: ReportStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  whenFinished(): Promise<void> {
    if (this.finished) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  publish(event: ReportStreamEvent): void {
    if (event.event === "trace") this.report.trace.push(event.data);
    if (event.event === "budget") this.report.budget = event.data;
    if (event.event === "section") {
      assignSection(this.report, event.data.name, event.data.section);
      this.report.context.confidence = confidenceFor(this.report.sections);
    }
    this.events.push(structuredClone(event));
    for (const listener of this.listeners) listener(event);
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const waiter of this.waiters) waiter();
    this.waiters.length = 0;
  }
}

export class ReportBoard {
  private readonly runs = new Map<string, ReportRun>();

  add(run: ReportRun): void {
    this.runs.set(run.report.id, run);
    if (this.runs.size <= 30) return;
    const oldest = this.runs.keys().next().value;
    if (oldest) this.runs.delete(oldest);
  }

  get(id: string): ReportRun | undefined {
    return this.runs.get(id);
  }
}

const board = new ReportBoard();

export function getReportBoard(): ReportBoard {
  return board;
}

export function sectionPaceMs(env: Env): number {
  if (!env.USE_FAKE_QLOO || env.NODE_ENV === "test") return 0;
  return FAKE_SECTION_PACE_MS;
}

export function createReportServices(env: Env = getEnv()): ReportServices {
  const trace = new MemoryTraceSink();
  const budget = new BudgetCounter(env.QLOO_BUDGET_TARGET, env.QLOO_BUDGET_CAP);
  const qloo = new QlooGateway(env.USE_FAKE_QLOO ? new FakeQloo() : new HarnessQloo(getSharedMcpClient(), new QlooApiRunner()), {
    budget,
    trace,
    cache: new FileQlooCache(env.CACHE_DIR),
  });
  const llm = env.USE_FAKE_QLOO
    ? new LlmGateway(new FakeLlm())
    : new LlmGateway(
        createOpenAiLlm({
          apiKey: requiredKey(env.OPENAI_API_KEY),
          model: env.OPENAI_MODEL,
          reasoningEffort: parseReasoningEffort(env.OPENAI_REASONING_EFFORT),
        }),
      );
  return {
    qloo,
    llm,
    trace,
    budget,
    laneA: loadLaneACatalog(path.join(process.cwd(), "eval/dataset/lane_a_buyers.csv")),
    baselineStore: new FileBaselineStore(env.CACHE_DIR),
    paceMs: sectionPaceMs(env),
  };
}

export function startReport(request: ReportRequest, services: ReportServices): ReportRun {
  const run = new ReportRun(emptyReport(request, services.budget.snapshot()));
  run.services = services;
  getReportBoard().add(run);
  void executeReport(run, services);
  return run;
}

export function encodeSse(event: ReportStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export async function executeReport(run: ReportRun, services: ReportServices): Promise<void> {
  const stopTrace = services.trace.subscribe((event) => {
    run.publish({ event: "trace", data: event });
    if (event.kind === "tool_result" || event.kind === "budget") {
      run.publish({ event: "budget", data: services.budget.snapshot() });
    }
  });
  const gate = createGate(services);

  try {
    publishSection(run, "tasteCard", pendingSection());
    publishSection(run, "withoutQloo", pendingSection());
    publishSection(run, "candidates", pendingSection());
    run.publish({ event: "budget", data: services.budget.snapshot() });

    if (run.report.context.mode === "proxy") {
      failProxy(run);
      return;
    }

    if (run.report.input.sizePreference && run.report.input.sizePreference.length > 0) {
      services.trace.emit({
        kind: "decision",
        summary: "size preference stored on the report and not applied",
      });
    }

    const show = await confirmedShow(run, services);
    if (!show) {
      await gate.drain();
      closeRun(run);
      return;
    }

    run.report.context.show = { id: show.id, name: show.name, type: "podcast" };
    const profileTask = showProfile(show, services.qloo)
      .then((card) => {
        gate.schedule(() => publishTaste(run, card));
      })
      .catch(() => {
        gate.schedule(() => {
          publishSection(run, "tasteCard", notedSection("error", "The taste card stopped before Qloo returned a card."));
          run.publish({
            event: "error",
            data: { code: "TASTE_CARD_FAILED", message: "The taste card could not be built." },
          });
        });
      });

    const discoveryTask = runSponsorDiscovery(discoveryInput(run, show.name), {
      describe: (input) => services.qloo.describe(input),
      insightsRaw: (input) => services.qloo.insightsRaw(input),
      scoreCandidates: (input) => services.qloo.scoreCandidates(input),
      llmBaseline: (input) => services.llm.llmBaseline(input),
      disambiguate: (input) => services.llm.disambiguateShow(input),
      trace: services.trace,
      budget: services.budget,
      laneA: services.laneA,
      baselineStore: services.baselineStore,
      onBaseline: (outcome) => {
        gate.schedule(() => publishBaseline(run, outcome));
      },
    }).then((result) => {
      gate.schedule(() => publishCandidates(run, result));
    });

    await Promise.all([profileTask, discoveryTask]);
    await gate.drain();
    run.publish({ event: "budget", data: services.budget.snapshot() });
    closeRun(run);
  } catch {
    failPending(run, "REPORT_FAILED", "The report stopped before every section finished.");
    if (!run.events.some((event) => event.event === "done")) closeRun(run);
  } finally {
    stopTrace();
    run.finish();
  }
}

function discoveryInput(run: ReportRun, showName: string) {
  return {
    showQuery: showName,
    ...(run.report.input.currentSponsors ? { currentSponsors: run.report.input.currentSponsors } : {}),
    ...(run.report.input.excludedCategories ? { excludedCategories: run.report.input.excludedCategories } : {}),
  };
}

async function confirmedShow(run: ReportRun, services: ReportServices): Promise<{ id: string; name: string } | undefined> {
  if (run.report.context.show) return run.report.context.show;
  const resolved = await resolveShow(run.report.input.showQuery, {
    describe: (input) => services.qloo.describe(input),
    disambiguate: (input) => services.llm.disambiguateShow(input),
  });
  services.trace.emit({
    kind: "decision",
    status: resolved.status === "ok" ? "ok" : resolved.status,
    summary: `report resolve ${resolved.status}`,
  });
  const show = resolved.candidates.length === 1 ? resolved.candidates[0] : undefined;
  if (resolved.status === "ok" && show) return { id: show.id, name: show.name };

  const status: SectionStatus = resolved.status === "empty" || resolved.status === "needs_input" ? resolved.status : "error";
  const note =
    status === "empty"
      ? "No podcast matched that name."
      : status === "needs_input"
        ? "Choose one show on the confirm screen, then start the report."
        : resolved.errorCode
          ? `Qloo could not resolve that show (${resolved.errorCode}).`
          : "Qloo could not resolve that show.";
  publishSection(run, "tasteCard", notedSection(status, note));
  publishSection(run, "candidates", notedSection(status, note));
  publishSection(run, "withoutQloo", notedSection("skipped", "Not run because the show is not confirmed."));
  if (status === "error") {
    run.publish({ event: "error", data: { code: resolved.errorCode ?? "SHOW_UNRESOLVED", message: note } });
  }
  return undefined;
}

function emptyReport(request: ReportRequest, budget: Report["budget"]): Report {
  const proxyOnly = Boolean(request.proxyIds && request.proxyIds.length > 0 && !request.showId);
  const context: ShowContext = {
    mode: proxyOnly ? "proxy" : "direct",
    tags: [],
    confidence: "low",
    ...(request.showId ? { show: { id: request.showId, name: request.input.showQuery, type: "podcast" as const } } : {}),
  };
  return reportSchema.parse({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    input: request.input,
    context,
    sections: {
      tasteCard: pendingSection(),
      candidates: pendingSection(),
      withoutQloo: pendingSection(),
    },
    evidence: {},
    budget,
    trace: [],
  });
}

function assignSection(report: Report, name: ReportSectionName, section: Section<unknown>): void {
  if (name === "tasteCard") report.sections.tasteCard = section as Report["sections"]["tasteCard"];
  else if (name === "candidates") report.sections.candidates = section as Report["sections"]["candidates"];
  else report.sections.withoutQloo = section as Report["sections"]["withoutQloo"];
}

function publishSection(run: ReportRun, name: ReportSectionName, section: Section<unknown>): void {
  run.publish({ event: "section", data: { name, section } });
}

function publishTaste(run: ReportRun, card: TasteCard): void {
  const section = tasteCardSection(card);
  if (section.data?.tags.data) {
    run.report.context.tags = section.data.tags.data.map((tag) => ({ id: tag.id, name: tag.name }));
  }
  publishSection(run, "tasteCard", section);
  if (section.status === "error") {
    run.publish({
      event: "error",
      data: { code: "TASTE_CARD_FAILED", message: section.note ?? "The taste card could not be built." },
    });
  }
}

function publishBaseline(run: ReportRun, outcome: BaselineOutcome): void {
  if (!outcome.ok) {
    publishSection(run, "withoutQloo", notedSection("error", "The without-Qloo list did not return."));
    run.publish({
      event: "error",
      data: { code: "BASELINE_FAILED", message: "The without-Qloo list could not be built." },
    });
    return;
  }
  const brands: NamedBrand[] = outcome.brands;
  if (brands.length === 0) {
    publishSection(run, "withoutQloo", notedSection("empty", "The without-Qloo list was empty."));
    return;
  }
  publishSection(run, "withoutQloo", { status: "ok", data: brands });
}

function publishCandidates(run: ReportRun, result: SponsorDiscoveryResult): void {
  if (result.showName && run.report.context.show) {
    run.report.context.show = { ...run.report.context.show, name: result.showName };
  }
  const note = candidateNote(result);
  const section: Section<BrandCandidate[]> = {
    status: result.status,
    ...(result.candidates.length > 0 ? { data: result.candidates } : {}),
    ...(note ? { note } : {}),
  };
  publishSection(run, "candidates", section);
}

function candidateNote(result: SponsorDiscoveryResult): string | undefined {
  if (result.status === "ok") return undefined;
  if (result.status === "partial") return `Shortlist is partial. Qloo calls ${result.counts.qlooCalls}.`;
  if (result.status === "empty") return "No brands stayed on the shortlist.";
  if (result.status === "needs_input") return "Choose one show on the confirm screen, then start the report.";
  if (result.errorCode) return `Qloo returned an error for the shortlist (${result.errorCode}).`;
  return "Qloo returned an error for the shortlist.";
}

function failProxy(run: ReportRun): void {
  const note = "Proxy estimates are not available in this build. Confirm a show instead.";
  publishSection(run, "tasteCard", notedSection("error", note));
  publishSection(run, "candidates", notedSection("error", note));
  publishSection(run, "withoutQloo", notedSection("skipped", note));
  run.publish({ event: "error", data: { code: "PROXY_UNAVAILABLE", message: note } });
  closeRun(run);
}

function failPending(run: ReportRun, code: string, message: string): void {
  for (const name of ["tasteCard", "candidates", "withoutQloo"] as const) {
    if (run.report.sections[name].status === "pending") {
      publishSection(run, name, notedSection("error", message));
    }
  }
  run.publish({ event: "error", data: { code, message } });
}

function closeRun(run: ReportRun): void {
  run.publish({ event: "done", data: { reportId: run.report.id } });
}

function requiredKey(value: string | undefined): string {
  if (!value) throw new Error("OPENAI_API_KEY is required");
  return value;
}

function createGate(services: ReportServices): { schedule: (work: () => void) => void; drain: () => Promise<void> } {
  let chain = Promise.resolve();
  return {
    schedule(work: () => void) {
      chain = chain.then(async () => {
        if (services.paceMs > 0) await (services.sleep ?? delay)(services.paceMs);
        try {
          work();
        } catch {
          // One section must not block the sections still waiting.
        }
      });
    },
    drain: () => chain,
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
