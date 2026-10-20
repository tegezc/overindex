import { describe, expect, it } from "vitest";
import { METHOD_KIT_NOTE, METHOD_RESULTS, METHOD_RESULTS_NOTE } from "./method-copy";

describe("method copy before evaluation", () => {
  it("says results are pending and does not invent a figure", () => {
    expect(METHOD_RESULTS).toBe("results pending");
    expect(METHOD_RESULTS).not.toMatch(/\d/);
    expect(METHOD_RESULTS_NOTE).not.toMatch(/\d/);
    expect(METHOD_KIT_NOTE).toContain("results pending");
    expect(METHOD_KIT_NOTE).not.toMatch(/\d/);
  });
});
