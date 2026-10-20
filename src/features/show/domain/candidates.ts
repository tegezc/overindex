import { asRecord, readString } from "./records";

export type PodcastCandidate = {
  id: string;
  name: string;
  type: "podcast";
  description?: string;
};

export type ShowExtraction = {
  candidates: PodcastCandidate[];
  /** True only for one exact or identifier match. Alternatives of that match are not a choice. */
  confident: boolean;
};

const EXCLUDED_TYPES = new Set([
  "brand",
  "artist",
  "movie",
  "tv_show",
  "book",
  "person",
  "place",
  "destination",
  "videogame",
  "video_game",
]);

/**
 * Reads podcast candidates out of a describe envelope.
 * `needs_input` candidates live on `resolution.issues[].candidates`.
 * An exact match keeps `selected` and drops search alternatives.
 */
export function extractShowCandidates(envelope: unknown): ShowExtraction {
  const root = asRecord(envelope);
  if (!root) return { candidates: [], confident: false };
  const resolution = asRecord(root.resolution);
  if (resolution && Array.isArray(resolution.issues)) {
    const fromIssues = dedupe(readIssueCandidates(resolution.issues));
    if (fromIssues.length > 0 || resolution.issues.length > 0) {
      return { candidates: fromIssues, confident: false };
    }
  }
  const fromOutcomes = resolution ? readOutcomes(resolution.outcomes) : undefined;
  if (fromOutcomes) return fromOutcomes;
  const fromResults = dedupe(readCandidateList(root.results));
  return { candidates: fromResults, confident: fromResults.length === 1 };
}

function readIssueCandidates(issues: unknown[]): PodcastCandidate[] {
  return issues.flatMap((issue) => {
    const record = asRecord(issue);
    return record ? readCandidateList(record.candidates) : [];
  });
}

function readOutcomes(outcomes: unknown): ShowExtraction | undefined {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return undefined;
  const first = asRecord(outcomes[0]);
  if (!first) return undefined;
  const status = readString(first, ["status"]);
  if (status === "not_found") return { candidates: [], confident: false };
  if (status === "ambiguous") {
    return { candidates: dedupe(readCandidateList(first.candidates)), confident: false };
  }
  const selected = readCandidate(first.selected);
  const alternatives = readCandidateList(first.alternatives);
  const match = readString(first, ["match"]);
  if ((match === "exact" || match === "identifier") && selected) {
    return { candidates: [selected], confident: true };
  }
  const candidates = dedupe([...(selected ? [selected] : []), ...alternatives]);
  return { candidates, confident: false };
}

function readCandidateList(value: unknown): PodcastCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const candidate = readCandidate(item);
    return candidate ? [candidate] : [];
  });
}

function readCandidate(value: unknown): PodcastCandidate | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const properties = asRecord(record.properties);
  const id = readString(record, ["entity_id", "id"]);
  const name = readString(record, ["name"]);
  if (!id || !name || !isPodcast(readString(record, ["type", "subtype"]))) return undefined;
  const description = clip(
    readString(record, ["description", "short_description"]) ??
      (properties ? readString(properties, ["short_description", "description"]) : undefined),
  );
  return { id, name, type: "podcast", ...(description ? { description } : {}) };
}

function isPodcast(type: string | undefined): boolean {
  if (!type) return true;
  const value = type.toLowerCase();
  if (value.includes("podcast")) return true;
  if (value.startsWith("urn:")) return false;
  return !EXCLUDED_TYPES.has(value);
}

function clip(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}...` : trimmed;
}

function dedupe(candidates: PodcastCandidate[]): PodcastCandidate[] {
  const seen = new Set<string>();
  const out: PodcastCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push(candidate);
  }
  return out;
}
