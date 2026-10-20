import { renderTemplate } from "../render";

export const PARSE_REQUEST_PROMPT_V1 = `You extract a podcast sponsorship request into structured fields for the user to confirm before any research runs.

User request:
{text}

Rules:
- Copy only what the user stated. Use null for every field they did not state.
- Do not invent a show, brand, category, audience, or business number.
- showQuery is the podcast they want sponsors for, or null if they did not name one.
- currentSponsors lists brands they said already sponsor the show.
- excludedCategories lists categories they do not want.
- sizePreference may contain only "challenger", "established", or "household", and only when they stated a size preference.
- demographics is aggregate audience information they stated: ageBands and gender. Use null inside demographics when that part was not stated.
- business is downloadsPerEpisode and cpm only when they stated those numbers. These figures are for confirmation. They are not a taste signal.`;

export function renderParseRequestPrompt(text: string): string {
  return renderTemplate(PARSE_REQUEST_PROMPT_V1, { text });
}
