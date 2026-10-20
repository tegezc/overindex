import {
  disambiguateResultSchema,
  partialReportInputSchema,
  type DisambiguateModel,
  type DisambiguateResult,
  type ParseRequestModel,
  type PartialReportInput,
  type ShowCandidate,
} from "./schemas";

function cleanStrings(values: string[] | null): string[] | undefined {
  if (!values) return undefined;
  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanNumber(value: number | null): number | undefined {
  if (value === null || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

export function toPartialReportInput(model: ParseRequestModel): PartialReportInput {
  const showQuery = model.showQuery?.trim();
  const currentSponsors = cleanStrings(model.currentSponsors);
  const excludedCategories = cleanStrings(model.excludedCategories);
  const sizePreference = model.sizePreference && model.sizePreference.length > 0 ? model.sizePreference : undefined;
  const ageBands = model.demographics ? cleanStrings(model.demographics.ageBands) : undefined;
  const gender = model.demographics?.gender?.trim();
  const downloadsPerEpisode = model.business ? cleanNumber(model.business.downloadsPerEpisode) : undefined;
  const cpm = model.business ? cleanNumber(model.business.cpm) : undefined;

  const demographics =
    ageBands || gender
      ? {
          ...(ageBands ? { ageBands } : {}),
          ...(gender ? { gender } : {}),
        }
      : undefined;
  const business =
    downloadsPerEpisode !== undefined || cpm !== undefined
      ? {
          ...(downloadsPerEpisode !== undefined ? { downloadsPerEpisode } : {}),
          ...(cpm !== undefined ? { cpm } : {}),
        }
      : undefined;

  return partialReportInputSchema.parse({
    ...(showQuery ? { showQuery } : {}),
    ...(currentSponsors ? { currentSponsors } : {}),
    ...(excludedCategories ? { excludedCategories } : {}),
    ...(sizePreference ? { sizePreference } : {}),
    ...(demographics ? { demographics } : {}),
    ...(business ? { business } : {}),
  });
}

/**
 * An id counts only when it is one of the candidates and the model is not asking.
 * Any other combination asks the user (`tech-spec.md` §7).
 */
export function toDisambiguateResult(model: DisambiguateModel, candidates: readonly ShowCandidate[]): DisambiguateResult {
  const ids = new Set(candidates.map((candidate) => candidate.id));
  const choice = model.choice && ids.has(model.choice) ? model.choice : undefined;
  const ask = model.ask || !choice;
  return disambiguateResultSchema.parse({
    ...(choice && !ask ? { choice } : {}),
    ask,
    reason: model.reason,
  });
}
