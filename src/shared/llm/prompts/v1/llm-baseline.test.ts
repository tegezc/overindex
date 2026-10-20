import { describe, expect, it } from "vitest";
import { LLM_BASELINE_PROMPT_V1, renderLlmBaselinePrompt } from "./llm-baseline";

const APPENDIX_A2 = `You are an experienced podcast advertising strategist.

Podcast: {show_name}
Description: {show_description}

List 40 consumer brands that would be the best sponsorship fit for this podcast's audience, best fit first. Use specific brand names (not categories). Do not include podcast networks, other podcasts, or the show's own products.

Return JSON: {"brands": [{"name": "<brand>", "category": "<short category>"}, ...]} with exactly 40 unique brands.`;

describe("llm_baseline prompt v1", () => {
  it("is the Lampiran A.2 text", () => {
    expect(LLM_BASELINE_PROMPT_V1).toBe(APPENDIX_A2);
  });

  it("fills the two placeholders and does not rescan inserted text", () => {
    const rendered = renderLlmBaselinePrompt({
      showName: "Show {show_description}",
      showDescription: "A show about {show_name}.",
    });
    expect(rendered).toContain("Podcast: Show {show_description}");
    expect(rendered).toContain("Description: A show about {show_name}.");
    expect(rendered).not.toContain("affinity");
    expect(rendered).toContain("exactly 40 unique brands");
  });
});
