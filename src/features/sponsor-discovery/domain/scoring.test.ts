import { describe, expect, it } from "vitest";
import { FIT_ALPHA, QUADRANT_FIT_THRESHOLD } from "@/shared/config/scoring";
import { assignLane, assignQuadrant, fit, lift, normalizeLift, percentile, reachBand } from "./scoring";

describe("percentile", () => {
  it("ranks the highest value at 1 and shares ties", () => {
    expect(percentile(2, [1, 1, 2])).toBe(1);
    expect(percentile(1, [1, 1, 2])).toBeCloseTo(2 / 3);
    expect(percentile(5, [5])).toBe(1);
  });

  it("rejects an empty sample and non-finite numbers", () => {
    expect(() => percentile(1, [])).toThrow(RangeError);
    expect(() => percentile(Number.NaN, [1])).toThrow(RangeError);
    expect(() => percentile(1, [Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });
});

describe("lift", () => {
  it("subtracts the baseline percentile from the show percentile", () => {
    expect(lift(0.9, 0.2)).toBeCloseTo(0.7);
    expect(lift(0.2, 0.8)).toBeCloseTo(-0.6);
  });

  it("rejects non-finite percentiles", () => {
    expect(() => lift(Number.NaN, 0.2)).toThrow(RangeError);
  });
});

describe("normalizeLift", () => {
  it("maps the lift range onto 0–1 and clamps the outside", () => {
    expect(normalizeLift(0)).toBe(0.5);
    expect(normalizeLift(1)).toBe(1);
    expect(normalizeLift(-1)).toBe(0);
    expect(normalizeLift(2)).toBe(1);
    expect(normalizeLift(-2)).toBe(0);
  });

  it("rejects a non-finite lift", () => {
    expect(() => normalizeLift(Number.NaN)).toThrow(RangeError);
  });
});

describe("fit", () => {
  it("uses the locked alpha 1 by default", () => {
    expect(FIT_ALPHA).toBe(1);
    expect(fit(1, 0.5)).toBeCloseTo(1);
    expect(fit(1, 0, 1)).toBe(1);
    expect(fit(0.2, 0.8, 0)).toBeCloseTo(0.8);
  });

  it("rejects an alpha outside 0–1", () => {
    expect(() => fit(1, 1, 1.1)).toThrow(RangeError);
    expect(() => fit(Number.NaN, 1, 0.5)).toThrow(RangeError);
  });
});

describe("reachBand", () => {
  it("splits popularity into challenger, established, and household", () => {
    expect(reachBand(0.01)).toBe("challenger");
    expect(reachBand(0.39)).toBe("challenger");
    expect(reachBand(0.4)).toBe("established");
    expect(reachBand(0.849)).toBe("established");
    expect(reachBand(0.85)).toBe("household");
    expect(reachBand(1)).toBe("household");
  });

  it("treats 0, missing, and out-of-range popularity as unknown", () => {
    expect(reachBand(0)).toBeUndefined();
    expect(reachBand(undefined)).toBeUndefined();
    expect(reachBand(1.1)).toBeUndefined();
    expect(reachBand(Number.NaN)).toBeUndefined();
  });
});

describe("assignLane", () => {
  const laneA = new Set(["ag1", "brand alpha"]);

  it("marks a normalized Lane A name as A and everything else as B", () => {
    expect(assignLane("AG1", laneA)).toBe("A");
    expect(assignLane("AG1 Energy", laneA)).toBe("A");
    expect(assignLane("Brand Alpha, Inc.", laneA)).toBe("A");
    expect(assignLane("Brand Beta", laneA)).toBe("B");
    expect(assignLane("Aurora", new Set(["aura"]))).toBe("B");
  });
});

describe("assignQuadrant", () => {
  it("crosses the LLM top-20 with the fit threshold", () => {
    expect(QUADRANT_FIT_THRESHOLD).toBe(0.7);
    expect(assignQuadrant({ fit: 0.7, llmRank: 1 })).toBe("proven");
    expect(assignQuadrant({ fit: 0.7, llmRank: 20 })).toBe("proven");
    expect(assignQuadrant({ fit: 0.9, llmRank: 21 })).toBe("hidden");
    expect(assignQuadrant({ fit: 0.9 })).toBe("hidden");
    expect(assignQuadrant({ fit: 0.699, llmRank: 20 })).toBe("category_only");
    expect(assignQuadrant({ fit: 0.2, llmRank: 21 })).toBe("none");
  });

  it("returns none when fit is missing", () => {
    expect(assignQuadrant({ llmRank: 1 })).toBe("none");
    expect(assignQuadrant({ fit: Number.NaN, llmRank: 1 })).toBe("none");
  });
});
