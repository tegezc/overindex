import { renderTemplate } from "../render";

export const DISAMBIGUATE_SHOW_PROMPT_V1 = `You decide whether one podcast candidate is clearly the show the user asked for.

Query: {query}

Candidates (id: name — description):
{candidates}

Set choice to a candidate id only when that candidate is clearly the show. Otherwise set choice to null.
Set ask to true when you are not sure, including when choice is null.
Set ask to false only when choice is one of the ids above.
Never invent an id. reason is one sentence.`;

export function formatShowCandidates(
  candidates: readonly { id: string; name: string; description: string }[],
): string {
  return candidates.map((candidate) => `${candidate.id}: ${candidate.name} — ${candidate.description}`).join("\n");
}

export function renderDisambiguateShowPrompt(input: {
  query: string;
  candidates: readonly { id: string; name: string; description: string }[];
}): string {
  return renderTemplate(DISAMBIGUATE_SHOW_PROMPT_V1, {
    query: input.query,
    candidates: formatShowCandidates(input.candidates),
  });
}
