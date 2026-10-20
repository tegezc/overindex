import { BRIDGE_COUNT_LABEL, BRIDGE_TITLES_LABEL } from "@/features/sponsor-discovery/domain/bridges";
import { checkClaims } from "./check-claims";
import {
  AFFINITY_LABEL,
  CPM_LABEL,
  DOWNLOADS_LABEL,
  FIT_LABEL,
  LIFT_LABEL,
  PCT_BASE_LABEL,
  PCT_SHOW_LABEL,
  POPULARITY_LABEL,
  REACH_LABEL,
  RENEWAL_LABEL,
  SHOW_QUERY_LABEL,
} from "./candidate-evidence";
import {
  formatEvidenceNumber,
  pitchDraftSchema,
  type Evidence,
  type PitchClaim,
  type PitchDraft,
  type UncheckedPitch,
} from "./evidence";

export type DraftInput = {
  brandId: string;
  brandName: string;
  evidence: readonly Evidence[];
  omitTexts?: ReadonlySet<string>;
};

/** Deterministic pitch. Every sentence is copied from evidence values. No model call. */
export function draftPitch(input: DraftInput): UncheckedPitch {
  const claims: PitchClaim[] = [];
  const omit = input.omitTexts ?? new Set<string>();
  const add = (text: string, source: PitchClaim["source"], evidenceIds: string[]) => {
    if (omit.has(text)) return;
    claims.push({ text, source, evidenceIds });
  };

  for (const item of input.evidence) {
    if (item.label === SHOW_QUERY_LABEL) {
      add("The show name on this report came from your input.", "user_input", [item.id]);
    } else if (item.label === RENEWAL_LABEL) {
      add("This brand is one of the current sponsors you entered.", "user_input", [item.id]);
    } else if (item.label === DOWNLOADS_LABEL && typeof item.value === "number") {
      add(`Downloads per episode from your input is ${format(item.value)}.`, "user_input", [item.id]);
    } else if (item.label === CPM_LABEL && typeof item.value === "number") {
      add(`CPM from your input is ${format(item.value)}.`, "user_input", [item.id]);
    } else if (item.label === FIT_LABEL && typeof item.value === "number") {
      add(
        `The audience of this show, as modeled by Qloo's taste graph, has fit ${format(item.value)}.`,
        "qloo",
        [item.id],
      );
    } else if (item.label === AFFINITY_LABEL && typeof item.value === "number") {
      add(`Affinity for this show is ${format(item.value)}.`, "qloo", [item.id]);
    } else if (item.label === POPULARITY_LABEL && typeof item.value === "number") {
      add(`Popularity is ${format(item.value)}.`, "qloo", [item.id]);
    } else if (item.label === PCT_SHOW_LABEL && typeof item.value === "number") {
      add(`Percentile within this shortlist is ${format(item.value)}.`, "qloo", [item.id]);
    } else if (item.label === PCT_BASE_LABEL && typeof item.value === "number") {
      add(`Baseline percentile is ${format(item.value)}.`, "qloo", [item.id]);
    } else if (item.label === LIFT_LABEL && typeof item.value === "number") {
      add(`Lift versus the baseline basket is ${format(item.value)}.`, "qloo", [item.id]);
    } else if (item.label === REACH_LABEL && typeof item.value === "string") {
      add(`Reach band from Qloo popularity on this report is ${item.value}.`, "qloo", [item.id]);
    } else if (item.label === "Tag category" && typeof item.value === "string") {
      add(`Tag category on this report is ${item.value}.`, "qloo", [item.id]);
    } else if (item.label === BRIDGE_COUNT_LABEL && typeof item.value === "number") {
      add(`Shared TV show count in the two recommendation lists is ${format(item.value)}.`, "qloo", [item.id]);
    } else if (item.label === BRIDGE_TITLES_LABEL && typeof item.value === "string" && item.value.trim()) {
      add(`Shared TV show titles in those lists: ${item.value}.`, "qloo", [item.id]);
    }
  }

  const body = claims.length > 0 ? claims.map((claim) => claim.text).join(" ") : "No sourced claim is available for this brand.";
  return {
    brandId: input.brandId,
    subject: `Partnerships team at ${input.brandName}`,
    body,
    talkingPoints: claims.map((claim) => claim.text),
    claims,
  };
}

/** One rewrite drops rejected sentences. A second failure is returned with those sentences listed. */
export function finalizePitch(input: DraftInput): PitchDraft {
  const first = draftPitch(input);
  const firstCheck = checkClaims(first, input.evidence);
  if (firstCheck.passed) return pitchDraftSchema.parse({ ...first, check: firstCheck });
  const second = draftPitch({
    ...input,
    omitTexts: new Set(firstCheck.rejected.map((item) => item.text)),
  });
  const secondCheck = checkClaims(second, input.evidence);
  return pitchDraftSchema.parse({ ...second, check: secondCheck });
}

function format(value: number): string {
  return formatEvidenceNumber(value);
}
