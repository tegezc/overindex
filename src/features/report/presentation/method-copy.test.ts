import { describe, expect, it } from "vitest";
import { METHOD_KIT_NOTE, METHOD_LIMITATIONS, METHOD_PROTOCOL } from "./method-copy";

describe("method copy after the test split", () => {
  it("points the print note at the Method page and does not say the results are still pending", () => {
    expect(METHOD_KIT_NOTE).toContain("Method page");
    expect(METHOD_KIT_NOTE).not.toContain("results pending");
    expect(METHOD_KIT_NOTE).not.toMatch(/\d/);
    expect(METHOD_PROTOCOL.join(" ")).not.toContain("The numbers are not");
    expect(METHOD_LIMITATIONS.join(" ")).toContain("split by show size");
  });
});
