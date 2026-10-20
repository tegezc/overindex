import { describe, expect, it } from "vitest";
import { pairedScoreCalls, withinPlan } from "./budget-plan";

describe("pairedScoreCalls", () => {
  it("counts one show batch and one baseline batch per 30 candidates", () => {
    expect(pairedScoreCalls(0)).toBe(0);
    expect(pairedScoreCalls(1)).toBe(2);
    expect(pairedScoreCalls(30)).toBe(2);
    expect(pairedScoreCalls(31)).toBe(4);
  });

  it("rejects a non-positive batch size", () => {
    expect(() => pairedScoreCalls(1, 0)).toThrow(RangeError);
  });
});

describe("withinPlan", () => {
  it("holds slack back from an extra resolve", () => {
    expect(withinPlan(10, 40, 1, 30, 2)).toBe(true);
    expect(withinPlan(36, 40, 1, 30, 2)).toBe(false);
    expect(withinPlan(36, 40, 1, 30, 0)).toBe(true);
  });

  it("rejects a negative extra call", () => {
    expect(withinPlan(0, 40, -1, 0, 0)).toBe(false);
  });
});
