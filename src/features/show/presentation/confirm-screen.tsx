"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { reportAcceptedSchema } from "@/features/report/domain/report";
import { resolveResponseSchema, type ResolveResponse } from "../domain/contracts";
import type { PodcastCandidate } from "../domain/candidates";
import { tasteCardSchema, type TasteCard } from "../domain/taste-card";
import { postJson } from "./show-client";
import { TasteCardView } from "./taste-card-view";

type ProfileState =
  | { kind: "idle" }
  | { kind: "loading"; show: PodcastCandidate }
  | { kind: "ready"; show: PodcastCandidate; card: TasteCard }
  | { kind: "failed"; show: PodcastCandidate };

export function ConfirmScreen() {
  const params = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  if (!query) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Confirm show</h1>
        <p>Enter a podcast name on the home page.</p>
        <Link className="text-sm underline" href="/">
          Back to home
        </Link>
      </div>
    );
  }
  return <ConfirmResult key={query} query={query} />;
}

function ConfirmResult({ query }: { query: string }) {
  const [resolveState, setResolveState] = useState<{ status: "loading" | "ready" | "failed"; result?: ResolveResponse }>({
    status: "loading",
  });
  const [profile, setProfile] = useState<ProfileState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    postJson(`resolve:${query}`, "/api/resolve", { query }, resolveResponseSchema).then(
      (result) => {
        if (!cancelled) setResolveState({ status: "ready", result });
      },
      () => {
        if (!cancelled) setResolveState({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Confirm show</h1>
        <p className="text-sm opacity-80">
          Query <span data-testid="confirm-query">{query}</span>
        </p>
        <Link className="text-sm underline" href="/">
          Back to home
        </Link>
      </div>
      {resolveState.status === "loading" ? <p data-testid="confirm-loading">Resolving show.</p> : null}
      {resolveState.status === "failed" ? (
        <p data-testid="confirm-failed">The confirm screen could not load a result.</p>
      ) : null}
      {resolveState.status === "ready" && resolveState.result ? (
        <ResolveBody result={resolveState.result} profile={profile} onPick={(show) => void loadProfile(show, setProfile)} />
      ) : null}
    </div>
  );
}

function ResolveBody({
  result,
  profile,
  onPick,
}: {
  result: ResolveResponse;
  profile: ProfileState;
  onPick: (show: PodcastCandidate) => void;
}) {
  if (result.status === "error") {
    return (
      <section data-testid="resolve-status" data-status="error">
        <p>
          Status <strong>error</strong>
          {result.errorCode ? <span data-testid="resolve-error-code"> {result.errorCode}</span> : null}
        </p>
        <p>Qloo could not resolve that name.</p>
      </section>
    );
  }
  if (result.candidates.length === 0 || result.status === "empty") {
    return (
      <section data-testid="resolve-status" data-status="empty">
        <p>
          Status <strong>empty</strong>
        </p>
        <p>No podcast matched that name.</p>
      </section>
    );
  }
  if (result.status === "needs_input" || result.candidates.length > 1) {
    return (
      <div className="flex flex-col gap-4">
        <section data-testid="resolve-status" data-status="needs_input">
          <p>
            Status <strong>needs_input</strong>
          </p>
          <p>{result.candidates.length} candidates. Choose the show.</p>
        </section>
        <ul className="flex flex-col gap-3" data-testid="candidate-list">
          {result.candidates.map((candidate) => (
            <li key={candidate.id} className="rounded-md border border-current/15 p-3">
              <button type="button" className="text-left text-base font-medium" data-testid="candidate-option" onClick={() => onPick(candidate)}>
                {candidate.name}
              </button>
              <BuildReport show={candidate} />
              {candidate.description ? <p className="mt-1 text-sm opacity-80">{candidate.description}</p> : null}
            </li>
          ))}
        </ul>
        <ProfileResult profile={profile} />
      </div>
    );
  }

  const show = result.candidates[0];
  if (!show) return null;
  return (
    <div className="flex flex-col gap-4">
      <section data-testid="resolve-status" data-status={result.status}>
        <p>
          Status <strong>{result.status}</strong>
        </p>
        <h2 className="text-lg font-medium" data-testid="confirm-show-name">
          {show.name}
        </h2>
        {show.description ? <p className="text-sm opacity-80">{show.description}</p> : null}
      </section>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="w-fit rounded-md border border-current px-4 py-2 text-sm" data-testid="confirm-show" onClick={() => onPick(show)}>
          Confirm show
        </button>
        <BuildReport show={show} />
      </div>
      <ProfileResult profile={profile} />
    </div>
  );
}

function ProfileResult({ profile }: { profile: ProfileState }) {
  if (profile.kind === "loading") return <p data-testid="profile-loading">Loading taste card.</p>;
  if (profile.kind === "failed") return <p data-testid="profile-failed">The taste card could not be loaded.</p>;
  if (profile.kind === "ready") return <TasteCardView card={profile.card} />;
  return null;
}

function BuildReport({ show }: { show: PodcastCandidate }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "starting" | "failed">("idle");
  const [message, setMessage] = useState<string | undefined>();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="w-fit rounded-md border border-current px-4 py-2 text-sm disabled:opacity-40"
        data-testid="build-report"
        disabled={state === "starting"}
        onClick={() => void startReport(show, router, setState, setMessage)}
      >
        Build report
      </button>
      {state === "starting" ? <p data-testid="report-starting">Starting report.</p> : null}
      {state === "failed" ? <p data-testid="report-start-error">{message ?? "The report could not be started."}</p> : null}
    </div>
  );
}

async function startReport(
  show: PodcastCandidate,
  router: ReturnType<typeof useRouter>,
  setState: (state: "idle" | "starting" | "failed") => void,
  setMessage: (message: string | undefined) => void,
) {
  setState("starting");
  setMessage(undefined);
  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { showQuery: show.name }, showId: show.id }),
    });
    const payload: unknown = await response.json().catch(() => null);
    const parsed = reportAcceptedSchema.safeParse(payload);
    if (!response.ok || !parsed.success) {
      setState("failed");
      setMessage(readStartError(payload));
      return;
    }
    router.push(`/r/${parsed.data.reportId}`);
  } catch {
    setState("failed");
    setMessage("The report could not be started.");
  }
}

function readStartError(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "The report could not be started.";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("message" in error) || typeof error.message !== "string") {
    return "The report could not be started.";
  }
  return error.message;
}

async function loadProfile(show: PodcastCandidate, setProfile: (state: ProfileState) => void) {
  setProfile({ kind: "loading", show });
  try {
    const card = await postJson(`profile:${show.id}`, "/api/profile", { entityId: show.id, name: show.name }, tasteCardSchema);
    setProfile({ kind: "ready", show, card });
  } catch {
    setProfile({ kind: "failed", show });
  }
}
