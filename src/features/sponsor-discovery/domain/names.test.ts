import { describe, expect, it } from "vitest";
import { isCategoryExcluded, nameAccepts, normalizeBrandName, resolutionQueue, selectNamed } from "./names";

describe("normalizeBrandName", () => {
  it("lowercases, strips punctuation, and drops Inc LLC and Co", () => {
    expect(normalizeBrandName("  AG1  ")).toBe("ag1");
    expect(normalizeBrandName("Brand Alpha, Inc.")).toBe("brand alpha");
    expect(normalizeBrandName("Acme LLC")).toBe("acme");
    expect(normalizeBrandName("North & Co")).toBe("north and");
    expect(normalizeBrandName("5-hour Energy")).toBe("5 hour energy");
  });
});

describe("nameAccepts", () => {
  it("accepts an equal name or a longer catalog name that contains the query", () => {
    expect(nameAccepts("AG1", "AG1 Energy")).toBe(true);
    expect(nameAccepts("Brand Alpha, Inc.", "brand alpha")).toBe(true);
    expect(nameAccepts("Meta", "Facebook")).toBe(false);
    expect(nameAccepts("Co", "Acme Co")).toBe(false);
  });
});

describe("selectNamed", () => {
  const candidates = [
    { id: "long", name: "AG1 Energy" },
    { id: "exact", name: "AG1" },
    { id: "other", name: "Other" },
  ];

  it("prefers the exact normalized name", () => {
    expect(selectNamed("AG1", candidates)?.id).toBe("exact");
  });

  it("returns undefined when no candidate name matches", () => {
    expect(selectNamed("Missing", candidates)).toBeUndefined();
  });
});

describe("isCategoryExcluded", () => {
  it("matches a whole token or a multi-word phrase and ignores a fragment", () => {
    expect(isCategoryExcluded(["Sports Betting Apps"], ["sports betting"])).toBe(true);
    expect(isCategoryExcluded(["Cryptocurrency"], ["crypto"])).toBe(false);
    expect(isCategoryExcluded(["Cryptocurrency exchange"], ["cryptocurrency"])).toBe(true);
    expect(isCategoryExcluded(["Engineering"], ["gin"])).toBe(false);
    expect(isCategoryExcluded(["Retail"], [])).toBe(false);
  });
});

describe("resolutionQueue", () => {
  it("orders sponsors, then LLM names, then Lane A, and skips names already in hand", () => {
    const queued = resolutionQueue({
      sponsors: ["Sponsor Gamma"],
      llmNames: ["Brand Alpha", "Sponsor Gamma", "Brand Zeta"],
      laneANames: ["Brand Alpha", "Unseen Buyer"],
      already: new Set(["brand alpha"]),
    });
    expect(queued).toEqual([
      { name: "Sponsor Gamma", kind: "user_sponsor" },
      { name: "Brand Zeta", kind: "llm_baseline" },
      { name: "Unseen Buyer", kind: "lane_a" },
    ]);
  });
});
