import { describe, expect, it } from "vitest";
import { FEATURED_SHOW_QUERIES, showsToGenerate } from "./generate-featured";

describe("generate-featured arguments", () => {
  it("uses the working list when no show is passed", () => {
    expect(showsToGenerate([])).toEqual([...FEATURED_SHOW_QUERIES]);
    expect(FEATURED_SHOW_QUERIES.length).toBeGreaterThanOrEqual(4);
  });

  it("uses the names on the command line instead of the working list", () => {
    expect(showsToGenerate(["  Show North  ", "--help", ""])).toEqual(["Show North"]);
  });
});
