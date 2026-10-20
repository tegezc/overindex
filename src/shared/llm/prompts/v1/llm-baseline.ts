import { renderTemplate } from "../render";

/**
 * Canonical Lampiran A.2 text (`eval-protocol.md`).
 * Product code and the eval harness both import this module.
 * Do not copy `LLM_BASELINE_PROMPT_V1` into another file.
 */
export const LLM_BASELINE_PROMPT_V1 = `You are an experienced podcast advertising strategist.

Podcast: {show_name}
Description: {show_description}

List 40 consumer brands that would be the best sponsorship fit for this podcast's audience, best fit first. Use specific brand names (not categories). Do not include podcast networks, other podcasts, or the show's own products.

Return JSON: {"brands": [{"name": "<brand>", "category": "<short category>"}, ...]} with exactly 40 unique brands.`;

export function renderLlmBaselinePrompt(input: { showName: string; showDescription: string }): string {
  return renderTemplate(LLM_BASELINE_PROMPT_V1, {
    show_name: input.showName,
    show_description: input.showDescription,
  });
}
