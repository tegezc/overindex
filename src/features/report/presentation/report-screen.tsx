"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BrandCandidate } from "@/features/sponsor-discovery/domain/types";
import { TasteCardView } from "@/features/show/presentation/taste-card-view";
import {
  laneBStatus,
  reportSchema,
  splitLanes,
  type Report,
  type ReportStreamEvent,
  type Section,
  type SectionStatus,
} from "../domain/report";
import { QuadrantChart } from "./quadrant-chart";

export function ReportScreen({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<Report | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [streamNote, setStreamNote] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const [showWithout, setShowWithout] = useState(false);

  const reportRef = useRef<Report | undefined>(undefined);

  useEffect(() => {
    let finished = false;
    const queued: ReportStreamEvent[] = [];
    const source = new EventSource(`/api/report/${reportId}/events`);
    const accept = (event: ReportStreamEvent) => {
      if (event.event === "error") setStreamNote(`${event.data.code}. ${event.data.message}`);
      if (event.event === "done") {
        finished = true;
        setDone(true);
        source.close();
      }
      const current = reportRef.current;
      if (!current) {
        queued.push(event);
        return;
      }
      const next = applyEvent(current, event);
      reportRef.current = next;
      setReport(next);
    };
    for (const name of ["trace", "section", "budget", "done", "error"] as const) {
      source.addEventListener(name, (message) => {
        if (!(message instanceof MessageEvent)) return;
        const event = readEvent(name, message.data);
        if (event) accept(event);
      });
    }
    source.onerror = () => {
      window.setTimeout(() => {
        if (finished) return;
        setStreamNote((current) => current ?? "Live updates stopped. Sections below are the last ones received.");
      }, 300);
    };
    void fetch(`/api/report/${reportId}`)
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          setLoadError(readError(payload) ?? "This report is not on this server.");
          return;
        }
        const parsed = reportSchema.safeParse(payload);
        if (!parsed.success) {
          setLoadError("The report could not be read.");
          return;
        }
        let next = parsed.data;
        let pending = queued.splice(0);
        while (pending.length > 0) {
          next = pending.reduce(applyEvent, next);
          pending = queued.splice(0);
        }
        reportRef.current = next;
        setReport(next);
        if (next.trace.length > 0 && queued.length === 0 && finished) setDone(true);
      })
      .catch(() => {
        setLoadError("The report could not be loaded.");
      });
    return () => source.close();
  }, [reportId]);

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Report</h1>
        <p data-testid="report-load-error">{loadError}</p>
        <Link className="text-sm underline" href="/">
          Back to home
        </Link>
      </div>
    );
  }
  if (!report) return <p data-testid="report-loading">Loading report.</p>;

  const candidates = report.sections.candidates.data ?? [];
  const lanes = splitLanes(candidates);
  const laneStatus = report.sections.candidates.status;
  const laneNote = report.sections.candidates.note;
  const bStatus = laneBStatus(report.context.mode, laneStatus);

  return (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
      <div className="flex flex-col gap-8">
        <ReportHeader report={report} done={done} />
        {streamNote ? (
          <p className="rounded-md border border-current/20 p-3 text-sm" data-testid="report-error">
            {streamNote}
          </p>
        ) : null}
        <section className="flex flex-col gap-3" data-testid="section-taste-card" data-status={report.sections.tasteCard.status}>
          <SectionHeading title="Audience taste card" status={report.sections.tasteCard.status} testId="section-taste-card" />
          {report.sections.tasteCard.note ? <p className="text-sm">{report.sections.tasteCard.note}</p> : null}
          {report.sections.tasteCard.status === "pending" ? <p className="text-sm">Waiting for this section.</p> : null}
          {report.sections.tasteCard.data ? <TasteCardView card={report.sections.tasteCard.data} /> : null}
        </section>
        <QuadrantChart status={laneStatus} note={laneNote} candidates={candidates} />
        <Lane title="Lane A — Ready buyers" testId="section-lane-a" status={laneStatus} note={laneNote} candidates={lanes.laneA} />
        <Lane
          title="Lane B — Greenfield"
          testId="section-lane-b"
          status={bStatus}
          note={bStatus === "skipped" ? "Lane B is hidden in tags-only mode." : laneNote}
          candidates={bStatus === "skipped" ? [] : lanes.laneB}
        />
        <WithoutQloo
          section={report.sections.withoutQloo}
          open={showWithout}
          onToggle={() => setShowWithout((value) => !value)}
        />
      </div>
      <TracePanel report={report} />
    </div>
  );
}

function ReportHeader({ report, done }: { report: Report; done: boolean }) {
  const name = report.context.show?.name ?? report.input.showQuery;
  const dataDate = report.createdAt.slice(0, 10);
  return (
    <header className="flex flex-col gap-2" data-testid="report-header" data-created-at={report.createdAt}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold" data-testid="report-show-name">
          {name}
        </h1>
        <span className="rounded-full border border-current/20 px-2 py-1 text-xs uppercase" data-testid="report-mode">
          {report.context.mode}
        </span>
        {done ? (
          <span className="text-xs" data-testid="report-done">
            Complete
          </span>
        ) : (
          <span className="text-xs" data-testid="report-running">
            Streaming
          </span>
        )}
      </div>
      <p className="text-sm opacity-80">
        Confidence <span data-testid="report-confidence">{report.context.confidence}</span>
        {" · "}
        Data date <span data-testid="report-data-date">{dataDate}</span>
        {" · "}
        Qloo calls <span data-testid="report-budget">{report.budget.used}</span> / target {report.budget.target} / cap{" "}
        {report.budget.cap}
      </p>
      <p className="text-sm opacity-80">Audience figures are modeled by Qloo&apos;s taste graph. They are not claims about individual listeners.</p>
      <Link className="text-sm underline" href="/">
        Back to home
      </Link>
    </header>
  );
}

function Lane({
  title,
  testId,
  status,
  note,
  candidates,
}: {
  title: string;
  testId: string;
  status: SectionStatus;
  note?: string;
  candidates: readonly BrandCandidate[];
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId} data-status={status}>
      <SectionHeading title={title} status={status} testId={testId} />
      {note ? <p className="text-sm">{note}</p> : null}
      {status === "pending" ? <p className="text-sm">Waiting for this section.</p> : null}
      {status === "skipped" ? <p className="text-sm">This lane is not shown for the current mode.</p> : null}
      {status !== "pending" && status !== "skipped" && candidates.length === 0 ? (
        <p className="text-sm opacity-70">No brands in this lane.</p>
      ) : null}
      <ul className="flex max-h-80 flex-col gap-2 overflow-auto">
        {candidates.map((candidate) => (
          <li key={candidate.brand.id} className="rounded-md border border-current/15 px-3 py-2 text-sm">
            <span className="font-medium">{candidate.brand.name}</span>
            <span className="opacity-70"> · {candidate.quadrant.replace(/_/g, " ")}</span>
            {candidate.reachBand ? <span className="opacity-70"> · {candidate.reachBand}</span> : <span className="opacity-70"> · reach unknown</span>}
            {candidate.fit === undefined ? (
              <span className="opacity-70"> · no taste signal</span>
            ) : (
              <span className="opacity-70"> · fit {candidate.fit.toFixed(2)} · Qloo</span>
            )}
            {candidate.flags.renewal ? <span> · renewal</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function WithoutQloo({
  section,
  open,
  onToggle,
}: {
  section: Section<{ name: string; category: string }[]>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="flex flex-col gap-3" data-testid="section-without-qloo" data-status={section.status}>
      <SectionHeading title="Without Qloo" status={section.status} testId="section-without-qloo" />
      {section.note ? <p className="text-sm">{section.note}</p> : null}
      <button
        type="button"
        className="w-fit rounded-md border border-current px-4 py-2 text-sm"
        data-testid="without-qloo-toggle"
        aria-pressed={open}
        onClick={onToggle}
      >
        {open ? "Hide without-Qloo list" : "Show without-Qloo list"}
      </button>
      {open ? (
        <div data-testid="without-qloo-panel" className="flex flex-col gap-2">
          {section.status === "pending" ? <p className="text-sm">Waiting for this section.</p> : null}
          {section.data && section.data.length > 0 ? (
            <ol className="flex max-h-80 list-decimal flex-col gap-1 overflow-auto pl-5 text-sm">
              {section.data.map((brand) => (
                <li key={`${brand.name}-${brand.category}`}>
                  {brand.name} <span className="opacity-70">· {brand.category} · model list, no taste graph</span>
                </li>
              ))}
            </ol>
          ) : section.status !== "pending" ? (
            <p className="text-sm opacity-70">No without-Qloo names to show.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TracePanel({ report }: { report: Report }) {
  return (
    <aside className="flex max-h-[70vh] flex-col gap-2 overflow-auto rounded-md border border-current/15 p-3" data-testid="trace-panel">
      <h2 className="text-sm font-semibold">Trace</h2>
      <p className="text-xs opacity-70">Tool calls, decisions, and the Qloo call count. Credentials are not shown.</p>
      <ol className="flex flex-col gap-2 text-xs">
        {report.trace.map((event) => (
          <li key={event.seq}>
            <span className="opacity-60">{event.seq}</span> {event.kind}
            {event.tool ? ` · ${event.tool}` : ""}
            {event.status ? ` · ${event.status}` : ""}
            <span className="block opacity-80">{event.summary}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function SectionHeading({ title, status, testId }: { title: string; status: SectionStatus; testId: string }) {
  return (
    <h2 className="flex items-baseline justify-between gap-3 text-lg font-semibold">
      <span>{title}</span>
      <span className="text-sm font-medium" data-testid={`${testId}-status`}>
        {status}
      </span>
    </h2>
  );
}

function applyEvent(report: Report, event: ReportStreamEvent): Report {
  if (event.event === "trace") {
    if (report.trace.some((item) => item.seq === event.data.seq)) return report;
    return { ...report, trace: [...report.trace, event.data] };
  }
  if (event.event === "budget") return { ...report, budget: event.data };
  if (event.event === "section") {
    const sections = { ...report.sections, [event.data.name]: event.data.section };
    return {
      ...report,
      sections,
      context: { ...report.context, confidence: confidenceFrom(sections) },
    };
  }
  return report;
}

function confidenceFrom(sections: Report["sections"]): Report["context"]["confidence"] {
  const statuses = [sections.tasteCard.status, sections.candidates.status, sections.withoutQloo.status];
  if (statuses.some((status) => status === "error" || status === "pending")) return "low";
  if (statuses.some((status) => status === "partial" || status === "degraded" || status === "empty" || status === "needs_input")) {
    return "medium";
  }
  return "high";
}

function readEvent(name: ReportStreamEvent["event"], raw: unknown): ReportStreamEvent | undefined {
  const text = typeof raw === "string" ? raw : "";
  try {
    const data: unknown = JSON.parse(text);
    if (name === "trace" || name === "section" || name === "budget" || name === "done" || name === "error") {
      return { event: name, data } as ReportStreamEvent;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const error = "error" in payload ? payload.error : undefined;
  if (!error || typeof error !== "object" || !("message" in error)) return undefined;
  return typeof error.message === "string" ? error.message : undefined;
}
