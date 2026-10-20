import { describe, expect, it } from "vitest";
import { LLM_BASELINE_PROMPT_V1, renderLlmBaselinePrompt } from "@/shared/llm/prompts/v1/llm-baseline";

describe("eval harness llm_baseline prompt", () => {
  it("imports the same module the product uses", () => {
    const rendered = renderLlmBaselinePrompt({ showName: "Show North", showDescription: "Wood stories." });
    expect(rendered.startsWith(LLM_BASELINE_PROMPT_V1.slice(0, 48))).toBe(true);
    expect(rendered).toContain("Podcast: Show North");
    expect(rendered).toContain("Description: Wood stories.");
    expect(rendered).toContain("exactly 40 unique brands");
  });
});
