import { describe, expect, it } from "vitest";
import { HACKATHON_BASE_URL, isHackathonBaseUrlOutput } from "./base-url";

describe("isHackathonBaseUrlOutput", () => {
  it("accepts only the hackathon host", () => {
    expect(isHackathonBaseUrlOutput(HACKATHON_BASE_URL)).toBe(true);
    expect(isHackathonBaseUrlOutput(`${HACKATHON_BASE_URL}/`)).toBe(true);
    expect(isHackathonBaseUrlOutput(`base-url = ${HACKATHON_BASE_URL}`)).toBe(true);
    expect(isHackathonBaseUrlOutput("https://api.qloo.com")).toBe(false);
    expect(isHackathonBaseUrlOutput("(not set)")).toBe(false);
    expect(isHackathonBaseUrlOutput(`docs https://example.com\n${HACKATHON_BASE_URL}`)).toBe(true);
    expect(isHackathonBaseUrlOutput(`${HACKATHON_BASE_URL}\nhttps://api.qloo.com`)).toBe(false);
  });
});
