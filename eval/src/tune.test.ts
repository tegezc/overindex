import { describe, expect, it } from "vitest";
import { meanMetric, q1RequestLength, rankPoolByFit, selectAlphaLambda, selectPrompt } from "./tune";
import type { Q1ShowResult } from "./q1";

describe("dev tuning grid", () => {
  it("keeps the higher M4 nDCG and breaks a tie toward alpha 1 then lambda 1", () => {
    expect(
      selectAlphaLambda([
        { alpha: 0.25, lambda: 1, ndcgAt10: 0.4 },
        { alpha: 1, lambda: 0.25, ndcgAt10: 0.4 },
        { alpha: 0, lambda: 0, ndcgAt10: 0.2 },
      ]),
    ).toEqual({ alpha: 1, lambda: 0.25, ndcgAt10: 0.4 });
    expect(
      selectAlphaLambda([
        { alpha: 1, lambda: 0.25, ndcgAt10: 0.4 },
        { alpha: 1, lambda: 1, ndcgAt10: 0.4 },
      ]).lambda,
    ).toBe(1);
  });

  it("keeps the stronger M2 prompt and uses A.1a when the means match", () => {
    expect(selectPrompt([{ variant: "A.1a", ndcgAt10: 0.2 }, { variant: "A.1b", ndcgAt10: 0.4 }]).variant).toBe("A.1b");
    const tied = selectPrompt([{ variant: "A.1a", ndcgAt10: 0.4 }, { variant: "A.1b", ndcgAt10: 0.4 }]);
    expect(tied).toEqual({ variant: "A.1a", ndcgAt10: 0.4, tie: true });
  });

  it("asks for every candidate when the list is shorter than 30", () => {
    expect(q1RequestLength(30)).toBe(30);
    expect(q1RequestLength(12)).toBe(12);
  });

  it("orders a pool by fit and leaves an unscored name after scored names", () => {
    expect(
      rankPoolByFit(
        [
          { name: "Low", affinityShow: 0.1, affinityBase: 0.1 },
          { name: "High", affinityShow: 0.9, affinityBase: 0.1 },
          { name: "Missing" },
        ],
        1,
        20,
      ),
    ).toEqual(["High", "Low", "Missing"]);
  });

  it("averages one method without reading another split", () => {
    const row = (showId: string, ndcg: number): Q1ShowResult => ({
      showId,
      tier: "mid",
      split: "dev",
      relevantCount: 1,
      unscoredM3: 0,
      unscoredM4: 0,
      metrics: {
        M1: { recallAt10: 0, ndcgAt10: 0 },
        M2: { recallAt10: 0, ndcgAt10: ndcg },
        M3: { recallAt10: 0, ndcgAt10: 0 },
        M4: { recallAt10: 0, ndcgAt10: 0 },
      },
    });
    expect(meanMetric([row("a", 0.25), row("b", 0.75)], "M2", "ndcgAt10")).toBe(0.5);
  });
});
