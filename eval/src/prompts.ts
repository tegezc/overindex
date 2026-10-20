import { renderTemplate } from "@/shared/llm/prompts/render";

/**
 * Lampiran A.1. The product `llm_baseline` prompt stays in the shared module.
 * Rendering a prompt does not call a model.
 */
export const Q1_PROMPT_A1A = `You are an experienced podcast advertising strategist.

Podcast: {show_name}
Description: {show_description}

Below is a list of brands, each with an ID. Rank the 30 brands from this list that are the most likely to sponsor this podcast, most likely first. Use only IDs from the list.

Brands:
{brand_block}

Return JSON: {"ranking": ["<id>", ...]} with exactly 30 unique IDs.`;

export const Q1_PROMPT_A1B = `You are an experienced podcast advertising strategist. Think about who listens to this podcast, what else they spend money on, and which brands have reasons to reach them.

Podcast: {show_name}
Description: {show_description}

From the brand list below, select and rank the 30 brands that are the best sponsorship fit for this podcast's audience, best fit first. Use only IDs from the list.

Brands:
{brand_block}

Return JSON: {"ranking": ["<id>", ...]} with exactly 30 unique IDs.`;

export type Q1PromptVariant = "A.1a" | "A.1b";

export function renderQ1Prompt(
  variant: Q1PromptVariant,
  input: { showName: string; showDescription: string; brands: readonly { id: string; name: string }[] },
): string {
  if (input.brands.length === 0) throw new RangeError("brand list must not be empty");
  const lines = input.brands.map((brand) => {
    if (!brand.id || !brand.name || /[\r\n]/.test(brand.id) || /[\r\n]/.test(brand.name)) {
      throw new Error("each brand needs a single-line id and name");
    }
    return `${brand.id}: ${brand.name}`;
  });
  return renderTemplate(variant === "A.1a" ? Q1_PROMPT_A1A : Q1_PROMPT_A1B, {
    show_name: input.showName,
    show_description: input.showDescription,
    brand_block: lines.join("\n"),
  });
}
