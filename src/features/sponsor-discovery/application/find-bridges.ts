import type { RecommendEnvelope } from "@/shared/qloo/domain/envelope";
import type { RecommendInput } from "@/shared/qloo/domain/inputs";
import { provenanceSchema, type Provenance, type QlooCall } from "@/shared/qloo/domain/provenance";
import {
  BRIDGE_BRAND_CALL_LABEL,
  BRIDGE_COUNT_LABEL,
  BRIDGE_SHOW_CALL_LABEL,
  BRIDGE_TITLES_LABEL,
  intersectBridgeTitles,
  readBridgeTitles,
  type BridgeTitle,
} from "../domain/bridges";

type BridgeEvidence = {
  id: string;
  kind: "bridge";
  label: string;
  value?: number | string;
  provenance?: Provenance;
};

/** Same cap as the recommend workflow. The taste card uses a smaller limit, so this call is separate. */
export const BRIDGE_LIMIT = 20;

export type BridgeResult = {
  status: "ok" | "empty" | "partial" | "error";
  note?: string;
  shared: BridgeTitle[];
  evidence: BridgeEvidence[];
};

type Recommend = (input: RecommendInput) => Promise<QlooCall<RecommendEnvelope>>;

/**
 * Intersection of `qloo_recommend` tv_show from the show and from the brand.
 * Does not call `qloo_compare_audiences` or `qloo_trends`.
 */
export async function findBridges(input: {
  reportId: string;
  showId: string;
  brandId: string;
  recommend: Recommend;
  at: string;
}): Promise<BridgeResult> {
  const showCall = await input.recommend(recommendInput(input.showId));
  if (showCall.data.status === "error") {
    return failed(showCall.data.error?.code);
  }
  const brandCall = await input.recommend(recommendInput(input.brandId));
  if (brandCall.data.status === "error") {
    return failed(brandCall.data.error?.code);
  }

  const shared = intersectBridgeTitles(
    readBridgeTitles(showCall.data.results, BRIDGE_LIMIT),
    readBridgeTitles(brandCall.data.results, BRIDGE_LIMIT),
  );
  const degraded = [showCall.data.status, brandCall.data.status].some((status) => status === "partial" || status === "degraded");
  const status = degraded ? "partial" : shared.length === 0 ? "empty" : "ok";
  const evidence: BridgeEvidence[] = [
    {
      id: `bridge:${input.brandId}:show-call`,
      kind: "bridge",
      label: BRIDGE_SHOW_CALL_LABEL,
      provenance: showCall.provenance,
    },
    {
      id: `bridge:${input.brandId}:brand-call`,
      kind: "bridge",
      label: BRIDGE_BRAND_CALL_LABEL,
      provenance: brandCall.provenance,
    },
    {
      id: `bridge:${input.brandId}:count`,
      kind: "bridge",
      label: BRIDGE_COUNT_LABEL,
      value: shared.length,
      provenance: provenanceSchema.parse({
        callId: `derived:${input.reportId}:${input.brandId}:bridge-count`,
        tool: "derived:scoring",
        params: { field: "bridge-count", note: "Count of ids present in both TV recommendation lists." },
        at: input.at,
        status: "ok",
        cached: true,
      }),
    },
  ];
  if (shared.length > 0) {
    evidence.push({
      id: `bridge:${input.brandId}:titles`,
      kind: "bridge",
      label: BRIDGE_TITLES_LABEL,
      value: shared.map((title) => title.name).join("; "),
      provenance: brandCall.provenance,
    });
  }
  const note =
    status === "empty"
      ? "No TV show id is in both recommendation lists."
      : status === "partial"
        ? "At least one TV recommendation list is incomplete."
        : undefined;
  return {
    status,
    ...(note ? { note } : {}),
    shared,
    evidence,
  };
}

function recommendInput(entityId: string): RecommendInput {
  return {
    target_type: "tv_show",
    signals: [entityId],
    limit: BRIDGE_LIMIT,
    explain: false,
  };
}

function failed(code: string | undefined): BridgeResult {
  const capped = code === "BUDGET_CAP";
  return {
    status: capped ? "partial" : "error",
    note: capped
      ? "TV recommendations were not requested because the report is at its Qloo call cap."
      : `TV recommendations failed${code ? ` (${code})` : ""}.`,
    shared: [],
    evidence: [],
  };
}
