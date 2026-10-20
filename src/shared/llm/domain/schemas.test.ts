import { describe, expect, it } from "vitest";
import { BASELINE_BRAND_COUNT, llmBaselineSchema } from "./schemas";

const brand = (name: string, category = "Synthetic") => ({ name, category });

describe("llmBaselineSchema", () => {
  it("accepts 40 unique brands", () => {
    const brands = Array.from({ length: BASELINE_BRAND_COUNT }, (_, index) => brand(`Brand Alpha ${index + 1}`));
    expect(llmBaselineSchema.parse({ brands }).brands).toHaveLength(40);
  });

  it("rejects the wrong count, blank fields, and duplicate names", () => {
    const brands = Array.from({ length: BASELINE_BRAND_COUNT }, (_, index) => brand(`Brand Alpha ${index + 1}`));
    expect(() => llmBaselineSchema.parse({ brands: brands.slice(0, 39) })).toThrow();
    expect(() => llmBaselineSchema.parse({ brands: brands.map((item) => ({ ...item, name: "   " })) })).toThrow();
    const duplicated = brands.map((item, index) => (index === 1 ? brand("brand alpha 1") : item));
    expect(() => llmBaselineSchema.parse({ brands: duplicated })).toThrow();
  });
});
