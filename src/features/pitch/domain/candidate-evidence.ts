import type { BrandCandidate } from "@/features/sponsor-discovery/domain/types";
import type { ScoreRow } from "./drawer";
import { derivedProvenance, formatEvidenceNumber, type Evidence } from "./evidence";

export const SHOW_QUERY_LABEL = "Show name typed for this report";
export const RENEWAL_LABEL = "Current sponsor from your input";
export const DOWNLOADS_LABEL = "Downloads per episode from your input";
export const CPM_LABEL = "CPM from your input";
export const AFFINITY_LABEL = "Affinity for this show";
export const POPULARITY_LABEL = "Popularity";
export const PCT_SHOW_LABEL = "Percentile within this shortlist";
export const PCT_BASE_LABEL = "Baseline percentile";
export const LIFT_LABEL = "Lift versus the baseline basket";
export const FIT_LABEL = "Fit";
export const REACH_LABEL = "Reach band";
export const LANE_LABEL = "Lane";
export const QUADRANT_LABEL = "Quadrant";

const DERIVED_NOTE = "Computed on this report from Qloo values already on the shortlist. Opening the brand did not call Qloo again for this number.";

export function candidateEvidence(input: {
  reportId: string;
  createdAt: string;
  showQuery: string;
  candidate: BrandCandidate;
}): { scores: ScoreRow[]; evidence: Evidence[]; categoryNote?: string } {
  const { candidate } = input;
  const brandId = candidate.brand.id;
  const evidence: Evidence[] = [
    {
      id: `user:${input.reportId}:show-query`,
      kind: "user_input",
      label: SHOW_QUERY_LABEL,
      value: input.showQuery,
    },
  ];
  if (candidate.flags.renewal) {
    evidence.push({
      id: `user:${input.reportId}:${brandId}:renewal`,
      kind: "user_input",
      label: RENEWAL_LABEL,
      value: "renewal",
    });
  }

  const scores: ScoreRow[] = [];
  const addNumber = (field: string, label: string, value: number | undefined, kind: Evidence["kind"]) => {
    if (value === undefined || !Number.isFinite(value)) return;
    const id = `score:${brandId}:${field}`;
    evidence.push({
      id,
      kind,
      label,
      value,
      provenance: derivedProvenance({
        reportId: input.reportId,
        brandId,
        field,
        at: input.createdAt,
        note: DERIVED_NOTE,
      }),
    });
    scores.push({ evidenceId: id, label, value, source: "qloo" });
  };
  const addText = (field: string, label: string, value: string, source: ScoreRow["source"]) => {
    const id = `score:${brandId}:${field}`;
    evidence.push({
      id,
      kind: "score",
      label,
      value,
      provenance: derivedProvenance({
        reportId: input.reportId,
        brandId,
        field,
        at: input.createdAt,
        tool: source === "computed" ? `derived:${field}` : "derived:scoring",
        note: source === "computed" ? "Computed on this report. This is not a raw Qloo measurement." : DERIVED_NOTE,
      }),
    });
    scores.push({ evidenceId: id, label, value, source });
  };

  addNumber("affinity", AFFINITY_LABEL, candidate.affinityRaw, "score");
  addNumber("popularity", POPULARITY_LABEL, candidate.popularity, "score");
  addNumber("pct-show", PCT_SHOW_LABEL, candidate.pctShow, "score");
  addNumber("pct-base", PCT_BASE_LABEL, candidate.pctBase, "score");
  addNumber("lift", LIFT_LABEL, candidate.lift, "lift");
  addNumber("fit", FIT_LABEL, candidate.fit, "score");
  if (candidate.reachBand) addText("reach", REACH_LABEL, candidate.reachBand, "qloo");
  addText("lane", LANE_LABEL, candidate.lane, "computed");
  addText("quadrant", QUADRANT_LABEL, candidate.quadrant, "computed");

  const category = candidate.flags.category;
  if (category?.source === "qloo_tags") {
    const id = `score:${brandId}:category`;
    evidence.push({
      id,
      kind: "tag",
      label: "Tag category",
      value: category.label,
      provenance: derivedProvenance({
        reportId: input.reportId,
        brandId,
        field: "category",
        at: input.createdAt,
        note: "Category label taken from tags already on the shortlist.",
      }),
    });
  }

  return {
    scores,
    evidence,
    ...(category?.source === "ai_classified" ? { categoryNote: "Category was classified by AI and is not used as a Qloo claim." } : {}),
  };
}

export function businessEvidence(
  reportId: string,
  business: { downloadsPerEpisode?: number; cpm?: number } | undefined,
): Evidence[] {
  if (!business) return [];
  const evidence: Evidence[] = [];
  if (business.downloadsPerEpisode !== undefined && Number.isFinite(business.downloadsPerEpisode)) {
    evidence.push({
      id: `user:${reportId}:downloads`,
      kind: "user_input",
      label: DOWNLOADS_LABEL,
      value: business.downloadsPerEpisode,
    });
  }
  if (business.cpm !== undefined && Number.isFinite(business.cpm)) {
    evidence.push({
      id: `user:${reportId}:cpm`,
      kind: "user_input",
      label: CPM_LABEL,
      value: business.cpm,
    });
  }
  return evidence;
}

export function scoreDisplay(value: number | string): string {
  return typeof value === "number" ? formatEvidenceNumber(value) : value.replaceAll("_", " ");
}
