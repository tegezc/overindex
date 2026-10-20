import { describe, expect, it } from "vitest";
import { readInsightBrands, readTagLabels } from "./entities";

describe("readTagLabels", () => {
  it("reads strings and name fields and ignores other shapes", () => {
    expect(readTagLabels([" Retail ", { name: "Gambling" }, { id: "x" }, 4, null])).toEqual(["Retail", "Gambling"]);
    expect(readTagLabels(undefined)).toEqual([]);
  });
});

describe("readInsightBrands", () => {
  it("keeps id, name, affinity, popularity, and tag categories", () => {
    const brands = readInsightBrands([
      {
        entity_id: "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1",
        name: "Brand Alpha",
        popularity: 0.9,
        tags: [{ name: "Retail" }],
        query: { affinity: 0.8 },
      },
      { name: "Missing id" },
    ]);
    expect(brands).toEqual([
      {
        id: "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1",
        name: "Brand Alpha",
        popularity: 0.9,
        affinity: 0.8,
        categories: [{ label: "Retail", source: "qloo_tags" }],
      },
    ]);
  });
});
