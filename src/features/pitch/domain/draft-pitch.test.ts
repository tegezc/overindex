import { describe, expect, it } from "vitest";
import type { BrandCandidate } from "@/features/sponsor-discovery/domain/types";
import { BRIDGE_COUNT_LABEL, BRIDGE_TITLES_LABEL } from "@/features/sponsor-discovery/domain/bridges";
import { candidateEvidence } from "./candidate-evidence";
import { finalizePitch } from "./draft-pitch";
import { claimSourceLabel } from "./evidence";

const candidate: BrandCandidate = {
  brand: { id: "brand-1", name: "Brand Alpha", type: "brand" },
  origins: ["qloo_discovery"],
  affinityRaw: 0.81,
  pctShow: 1,
  popularity: 0.42,
  reachBand: "established",
  lane: "B",
  quadrant: "none",
  flags: {},
};

describe("finalizePitch", () => {
  it("keeps only claims that pass and labels each one Qloo or input Anda", () => {
    const built = candidateEvidence({
      reportId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-10-20T02:00:00.000Z",
      showQuery: "Show North",
      candidate,
    });
    const evidence = [
      ...built.evidence,
      {
        id: "bridge:brand-1:count",
        kind: "bridge" as const,
        label: BRIDGE_COUNT_LABEL,
        value: 1,
        provenance: {
          callId: "derived:count",
          tool: "derived:scoring",
          params: { field: "bridge-count" },
          at: "2026-10-20T02:00:00.000Z",
          status: "ok" as const,
          cached: true,
        },
      },
      {
        id: "bridge:brand-1:titles",
        kind: "bridge" as const,
        label: BRIDGE_TITLES_LABEL,
        value: "Your listeners buy tickets",
        provenance: {
          callId: "call-brand",
          tool: "qloo_recommend",
          params: { target_type: "tv_show" },
          at: "2026-10-20T02:00:00.000Z",
          status: "ok" as const,
          cached: false,
        },
      },
    ];
    const pitch = finalizePitch({ brandId: candidate.brand.id, brandName: candidate.brand.name, evidence });
    expect(pitch.check.passed).toBe(true);
    expect(pitch.claims.length).toBeGreaterThan(0);
    expect(pitch.claims.every((claim) => claim.source === "qloo" || claim.source === "user_input")).toBe(true);
    expect(new Set(pitch.claims.map((claim) => claimSourceLabel(claim.source)))).toEqual(new Set(["Qloo", "input Anda"]));
    expect(pitch.claims.some((claim) => claim.text.includes("Your listeners buy"))).toBe(false);
    expect(pitch.body.includes("Your listeners buy")).toBe(false);
  });
});
