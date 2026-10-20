"use client";

import { useEffect, useState } from "react";
import { scoreDisplay } from "../domain/candidate-evidence";
import { brandDrawerSchema, type BrandDrawer } from "../domain/drawer";
import { claimSourceLabel, pitchDraftSchema, type Evidence, type PitchDraft } from "../domain/evidence";

export function BrandDrawer({
  reportId,
  brandId,
  brandName,
  onClose,
}: {
  reportId: string;
  brandId: string;
  brandName: string;
  onClose: () => void;
}) {
  const [drawer, setDrawer] = useState<BrandDrawer | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pitch, setPitch] = useState<PitchDraft | undefined>();
  const [pitchError, setPitchError] = useState<string | undefined>();
  const [pitching, setPitching] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void fetch(`/api/report/${reportId}/brand/${encodeURIComponent(brandId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setError(readError(payload) ?? "Brand evidence could not be loaded.");
          return;
        }
        const parsed = brandDrawerSchema.safeParse(payload);
        if (!parsed.success) {
          setError("Brand evidence could not be read.");
          return;
        }
        setDrawer(parsed.data);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Brand evidence could not be loaded.");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reportId, brandId]);

  return (
    <section className="flex flex-col gap-4 rounded-md border border-current/20 p-4" data-testid="brand-drawer" ref={scrollDrawer}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold" data-testid="brand-drawer-name">
          {brandName}
        </h2>
        <button type="button" className="text-sm underline" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? <p data-testid="brand-drawer-error">{error}</p> : null}
      {!drawer && !error ? <p data-testid="brand-drawer-loading">Loading brand evidence.</p> : null}
      {drawer ? (
        <>
          <ScoreList rows={drawer.scores} />
          <EvidenceList evidence={drawer.evidence} />
          <BridgeList bridges={drawer.bridges} />
          <p data-testid="brand-momentum" data-status={drawer.momentum.status}>
            {drawer.momentum.note}
          </p>
          {drawer.categoryNote ? <p className="text-sm">{drawer.categoryNote}</p> : null}
          <button
            type="button"
            className="w-fit rounded-md border border-current px-4 py-2 text-sm disabled:opacity-40"
            data-testid="draft-pitch"
            disabled={pitching}
            onClick={() => void draft(reportId, brandId, setPitch, setPitchError, setPitching)}
          >
            Draft pitch
          </button>
          {pitchError ? <p data-testid="pitch-error">{pitchError}</p> : null}
          {pitch ? <PitchView pitch={pitch} /> : null}
        </>
      ) : null}
    </section>
  );
}

function scrollDrawer(node: HTMLElement | null) {
  node?.scrollIntoView({ block: "nearest" });
}

function ScoreList({ rows }: { rows: BrandDrawer["scores"] }) {
  return (
    <div className="flex flex-col gap-2" data-testid="brand-scores">
      <h3 className="text-sm font-semibold">Score</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((row) => (
          <li key={row.evidenceId} data-testid="brand-score">
            {row.label}: {scoreDisplay(row.value)}{" "}
            <span className="opacity-70">{row.source === "qloo" ? "Qloo" : "computed on this report"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <div className="flex flex-col gap-2" data-testid="brand-evidence">
      <h3 className="text-sm font-semibold">Evidence</h3>
      <ul className="flex flex-col gap-2 text-sm">
        {evidence.map((item) => (
          <li key={item.id}>
            <span data-testid="evidence-source">{evidenceSource(item)}</span>
            <span> · {item.label}</span>
            {item.value !== undefined ? <span> · {scoreDisplay(item.value)}</span> : null}
            {item.provenance ? (
              <span className="block text-xs opacity-70" data-testid="brand-provenance">
                {item.provenance.tool} · {item.provenance.status} · {item.provenance.cached ? "cached" : "not cached"} ·{" "}
                {item.provenance.at.slice(0, 10)}
                {typeof item.provenance.params.note === "string" ? ` · ${item.provenance.params.note}` : ""}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BridgeList({ bridges }: { bridges: BrandDrawer["bridges"] }) {
  return (
    <div className="flex flex-col gap-2" data-testid="brand-bridges" data-status={bridges.status}>
      <h3 className="text-sm font-semibold">Shared TV shows</h3>
      <p className="text-sm">
        Status <span data-testid="brand-bridges-status">{bridges.status}</span>
      </p>
      {bridges.note ? <p className="text-sm">{bridges.note}</p> : null}
      {bridges.data && bridges.data.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {bridges.data.map((title) => (
            <li key={title.id}>{title.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PitchView({ pitch }: { pitch: PitchDraft }) {
  return (
    <div className="flex flex-col gap-3" data-testid="pitch-panel" data-passed={String(pitch.check.passed)}>
      <h3 className="text-sm font-semibold">Pitch</h3>
      <p className="text-sm" data-testid="pitch-subject">
        {pitch.subject}
      </p>
      <p className="text-sm" data-testid="pitch-body">
        {pitch.body}
      </p>
      <ul className="flex flex-col gap-2 text-sm" data-testid="pitch-claims">
        {pitch.claims.map((claim, index) => (
          <li key={`${claim.evidenceIds.join(",")}-${index}`} data-testid="pitch-claim">
            <span data-testid="pitch-claim-source">{claimSourceLabel(claim.source)}</span>
            <span> · {claim.text}</span>
          </li>
        ))}
      </ul>
      {pitch.check.rejected.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="pitch-rejected">
          {pitch.check.rejected.map((item) => (
            <li key={`${item.reason}-${item.text}`}>
              Rejected · {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function evidenceSource(item: Evidence): "Qloo" | "input Anda" | "computed on this report" {
  if (item.kind === "user_input") return "input Anda";
  if (item.provenance?.tool === "derived:lane" || item.provenance?.tool === "derived:quadrant") {
    return "computed on this report";
  }
  return "Qloo";
}

async function draft(
  reportId: string,
  brandId: string,
  setPitch: (pitch: PitchDraft | undefined) => void,
  setPitchError: (message: string | undefined) => void,
  setPitching: (value: boolean) => void,
) {
  setPitching(true);
  setPitchError(undefined);
  try {
    const response = await fetch(`/api/report/${reportId}/pitch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setPitchError(readError(payload) ?? "The pitch could not be drafted.");
      return;
    }
    const parsed = pitchDraftSchema.safeParse(payload);
    if (!parsed.success) {
      setPitchError("The pitch could not be read.");
      return;
    }
    setPitch(parsed.data);
  } catch {
    setPitchError("The pitch could not be drafted.");
  } finally {
    setPitching(false);
  }
}

function readError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return undefined;
  const error = payload.error;
  if (!error || typeof error !== "object" || !("message" in error)) return undefined;
  return typeof error.message === "string" ? error.message : undefined;
}
