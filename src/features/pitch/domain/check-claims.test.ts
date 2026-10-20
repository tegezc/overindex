import { describe, expect, it } from "vitest";
import { CAUSAL_OR_INDIVIDUAL, NUMBER_NOT_IN_EVIDENCE, checkClaims } from "./check-claims";
import type { Evidence, UncheckedPitch } from "./evidence";

const provenance = {
  callId: "call-1",
  tool: "derived:scoring",
  params: { field: "fit" },
  at: "2026-10-20T02:00:00.000Z",
  status: "ok" as const,
  cached: true,
};

const fit: Evidence = {
  id: "fit",
  kind: "score",
  label: "Fit",
  value: 0.5,
  provenance,
};

function pitch(text: string, extraBody = ""): UncheckedPitch {
  return {
    brandId: "brand-1",
    subject: "Partnerships team",
    body: extraBody ? `${text} ${extraBody}` : text,
    talkingPoints: [text],
    claims: [{ text, source: "qloo", evidenceIds: [fit.id] }],
  };
}

describe("checkClaims", () => {
  it("rejects a number that is not in the cited evidence", () => {
    const text = "Fit is 9.5.";
    const result = checkClaims(pitch(text), [fit]);
    expect(result.passed).toBe(false);
    expect(result.rejected).toEqual([{ text, reason: NUMBER_NOT_IN_EVIDENCE }]);
  });

  it("rejects a causal sentence", () => {
    const text = "This placement will increase sales.";
    const result = checkClaims(pitch(text), [fit]);
    expect(result.passed).toBe(false);
    expect(result.rejected.map((item) => item.reason)).toContain(CAUSAL_OR_INDIVIDUAL);
  });

  it("rejects a claim about individual listeners", () => {
    const text = "Your listeners buy this brand.";
    const result = checkClaims(pitch(text), [fit]);
    expect(result.passed).toBe(false);
    expect(result.rejected.map((item) => item.reason)).toContain(CAUSAL_OR_INDIVIDUAL);

    const grouped = checkClaims(pitch("Listeners are the buyers."), [fit]);
    expect(grouped.passed).toBe(false);
    expect(grouped.rejected.map((item) => item.reason)).toContain(CAUSAL_OR_INDIVIDUAL);
  });

  it("accepts a taste-graph sentence whose number is the evidence value", () => {
    const text = "The audience of this show, as modeled by Qloo's taste graph, has fit 0.5.";
    const result = checkClaims(pitch(text), [fit]);
    expect(result.passed).toBe(true);
    expect(result.rejected).toEqual([]);
  });
});
