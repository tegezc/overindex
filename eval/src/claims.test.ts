import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatMetric, q1ClaimSentence, q1SecondaryClaim, q2ClaimSentence, q2MainClaim } from "./claims";
import q1Test from "../results/q1-test.json";
import q2Test from "../results/q2-test.json";

const point = (mean: number, low: number, high: number, n = 4) => ({
  mean,
  low,
  high,
  resamples: 8,
  seed: 20261017,
  n,
});

describe("locked claim rules", () => {
  it("accepts the main comparison only when both intervals meet the written rule", () => {
    expect(q2MainClaim({ low: -0.2, high: -0.01 }, { low: -0.1, high: 0.2 })).toBe(true);
    expect(q2MainClaim({ low: -0.2, high: -0.01 }, { low: -0.2, high: -0.01 })).toBe(false);
    expect(q2MainClaim({ low: -0.2, high: 0.01 }, { low: 0, high: 0.2 })).toBe(false);
    expect(q2MainClaim({ low: -0.2, high: 0 }, { low: 0, high: 0.2 })).toBe(false);
    expect(q2MainClaim({ low: -0.2, high: -0.01 }, { low: -0.1, high: 0 })).toBe(true);
  });

  it("accepts the secondary ranking claim only when the interval is entirely above zero", () => {
    expect(q1SecondaryClaim({ low: 0.01, high: 0.2 })).toBe(true);
    expect(q1SecondaryClaim({ low: 0, high: 0.2 })).toBe(false);
    expect(q1SecondaryClaim({ low: -0.1, high: 0.2 })).toBe(false);
  });

  it("states that a difference was not detected when the interval does not qualify", () => {
    expect(q2ClaimSentence(point(0.01, -0.02, 0.04), point(0, -0.1, 0.1))).toContain("No difference was detected");
    expect(q2ClaimSentence(null, null)).toContain("could not be computed");
    expect(q1ClaimSentence(point(0.01, -0.02, 0.04))).toContain("No difference was detected");
    expect(q1ClaimSentence(null)).toContain("n = 0");
  });

  it("keeps a non-zero bound visible when four decimal places would round it to zero", () => {
    expect(formatMetric(0.00004)).toBe("0.00004");
    expect(formatMetric(0)).toBe("0.0000");
  });

  it("does not claim a win from the recorded test intervals", () => {
    const jaccard = q2Test.paired.specificityOverindexMinusLlm;
    const recall = q2Test.paired.recallOverindexMinusLlm;
    const ndcg = q1Test.paired.ndcgAt10.m4MinusM2;
    expect(q2MainClaim(jaccard, recall)).toBe(false);
    expect(q1SecondaryClaim(ndcg)).toBe(false);
    expect(q2ClaimSentence(jaccard, recall)).toContain("No difference was detected");
    expect(q1ClaimSentence(ndcg)).toContain("No difference was detected");
    expect(q2Test.measured).toBe(15);
    expect(q1Test.measured).toBe(9);
  });

  it("does not read the product fit constant from the test runner", () => {
    const source = readFileSync(new URL("../../scripts/eval-test.ts", import.meta.url), "utf8");
    expect(source).not.toContain("FIT_ALPHA");
    expect(source).not.toContain("QUADRANT_FIT_THRESHOLD");
    expect(source).toContain("LOCKED_ALPHA = 1");
    expect(source).toContain("LOCKED_LAMBDA = 0");
    expect(source).toContain('LOCKED_PROMPT = "A.1a"');
    expect(source).toContain("TUNING_CHANGED");
    expect(source).not.toMatch(/writeFileSync\([\s\S]{0,120}tuning\.json/);
    expect(source).toContain("allowTestSplit: true");
  });
});
