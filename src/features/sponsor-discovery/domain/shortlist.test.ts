import { describe, expect, it } from "vitest";
import { buildShortlist } from "./shortlist";
import type { PoolItem } from "./types";

const laneA = new Set(["brand alpha"]);

function item(overrides: Partial<PoolItem> & Pick<PoolItem, "id" | "name">): PoolItem {
  return {
    origins: ["qloo_discovery"],
    categories: [],
    ...overrides,
  };
}

describe("buildShortlist", () => {
  it("drops an excluded category and does not let it affect percentiles", () => {
    const { candidates, excluded } = buildShortlist({
      items: [
        item({
          id: "alpha",
          name: "Brand Alpha",
          origins: ["qloo_discovery", "llm_baseline"],
          popularity: 0.9,
          categories: [{ label: "Retail", source: "qloo_tags" }],
          llmRank: 1,
          affinityShow: 0.9,
          affinityBase: 0.1,
        }),
        item({
          id: "beta",
          name: "Brand Beta",
          popularity: 0.5,
          affinityShow: 0.2,
          affinityBase: 0.8,
        }),
        item({
          id: "delta",
          name: "Brand Delta",
          categories: [{ label: "Gambling", source: "qloo_tags" }],
          affinityShow: 0.99,
          affinityBase: 0.01,
        }),
      ],
      laneA,
      excludedCategories: ["gambling"],
      renewalNames: new Set(["brand alpha"]),
      renewalIds: new Set(),
    });
    expect(excluded).toBe(1);
    expect(candidates.map((candidate) => candidate.brand.name)).toEqual(["Brand Alpha", "Brand Beta"]);
    const alpha = candidates[0];
    const beta = candidates[1];
    expect(alpha?.lane).toBe("A");
    expect(alpha?.quadrant).toBe("proven");
    expect(alpha?.flags.renewal).toBe(true);
    expect(alpha?.reachBand).toBe("household");
    expect(alpha?.fit).toBeCloseTo(1);
    expect(alpha?.origins).toEqual(["qloo_discovery", "llm_baseline", "lane_a", "user_sponsor"]);
    expect(beta?.lane).toBe("B");
    expect(beta?.quadrant).toBe("none");
    expect(beta?.fit).toBeCloseTo(0.5);
    expect(beta?.reachBand).toBe("established");
    expect(beta?.flags.renewal).toBeUndefined();
  });

  it("marks a high-fit brand the LLM did not suggest as hidden, and a low-fit suggestion as category-only", () => {
    const { candidates } = buildShortlist({
      items: [
        item({ id: "high", name: "Brand High", affinityShow: 1, affinityBase: 0, popularity: 0.2 }),
        item({ id: "low", name: "Brand Low", affinityShow: 0, affinityBase: 1, llmRank: 1, popularity: 0 }),
      ],
      laneA: new Set(),
      excludedCategories: [],
      renewalNames: new Set(),
      renewalIds: new Set(),
    });
    expect(candidates.find((candidate) => candidate.brand.id === "high")).toMatchObject({
      quadrant: "hidden",
      lane: "B",
      reachBand: "challenger",
    });
    const low = candidates.find((candidate) => candidate.brand.id === "low");
    expect(low?.quadrant).toBe("category_only");
    expect(low?.flags.noTasteSignal).toBeUndefined();
    expect(low?.reachBand).toBeUndefined();
  });

  it("keeps an unresolved current sponsor as a renewal with no taste signal", () => {
    const { candidates } = buildShortlist({
      items: [
        item({
          id: "unresolved:missing-sponsor",
          name: "Missing Sponsor",
          origins: ["user_sponsor"],
        }),
      ],
      laneA: new Set(),
      excludedCategories: [],
      renewalNames: new Set(["missing sponsor"]),
      renewalIds: new Set(),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      lane: "B",
      quadrant: "none",
      flags: { renewal: true, noTasteSignal: true },
    });
    expect(candidates[0]?.fit).toBeUndefined();
  });
});
