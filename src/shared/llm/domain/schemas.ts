import { z } from "zod";

export const BASELINE_BRAND_COUNT = 40;

const nonEmpty = z.string().min(1);

export const sizePreferenceSchema = z.enum(["challenger", "established", "household"]);

export const reportInputSchema = z.object({
  showQuery: nonEmpty,
  currentSponsors: z.array(nonEmpty).optional(),
  excludedCategories: z.array(nonEmpty).optional(),
  sizePreference: z.array(sizePreferenceSchema).optional(),
  demographics: z
    .object({
      ageBands: z.array(nonEmpty).optional(),
      gender: nonEmpty.optional(),
    })
    .optional(),
  business: z
    .object({
      downloadsPerEpisode: z.number().nonnegative().optional(),
      cpm: z.number().nonnegative().optional(),
    })
    .optional(),
});

export type ReportInput = z.infer<typeof reportInputSchema>;

/** Fields the user actually stated. Every key is optional. */
export const partialReportInputSchema = z.object({
  showQuery: nonEmpty.optional(),
  currentSponsors: z.array(nonEmpty).optional(),
  excludedCategories: z.array(nonEmpty).optional(),
  sizePreference: z.array(sizePreferenceSchema).optional(),
  demographics: z
    .object({
      ageBands: z.array(nonEmpty).optional(),
      gender: nonEmpty.optional(),
    })
    .optional(),
  business: z
    .object({
      downloadsPerEpisode: z.number().nonnegative().optional(),
      cpm: z.number().nonnegative().optional(),
    })
    .optional(),
});

export type PartialReportInput = z.infer<typeof partialReportInputSchema>;

export const llmBaselineBrandSchema = z.object({
  name: nonEmpty,
  category: nonEmpty,
});

export const llmBaselineModelSchema = z.object({
  brands: z.array(llmBaselineBrandSchema).length(BASELINE_BRAND_COUNT),
});

function brandKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Model schema plus the A.2 uniqueness rule, which JSON Schema cannot express. */
export const llmBaselineSchema = llmBaselineModelSchema.superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [index, brand] of value.brands.entries()) {
    const name = brandKey(brand.name);
    const category = brand.category.trim();
    if (!name || !category) {
      ctx.addIssue({
        code: "custom",
        path: ["brands", index],
        message: "brand name and category are required",
      });
      continue;
    }
    if (seen.has(name)) {
      ctx.addIssue({
        code: "custom",
        path: ["brands", index, "name"],
        message: "brand names must be unique",
      });
    }
    seen.add(name);
  }
});

export type LlmBaseline = z.infer<typeof llmBaselineSchema>;

export const parseRequestModelSchema = z.object({
  showQuery: z.string().nullable(),
  currentSponsors: z.array(z.string()).nullable(),
  excludedCategories: z.array(z.string()).nullable(),
  sizePreference: z.array(sizePreferenceSchema).nullable(),
  demographics: z
    .object({
      ageBands: z.array(z.string()).nullable(),
      gender: z.string().nullable(),
    })
    .nullable(),
  business: z
    .object({
      downloadsPerEpisode: z.number().nullable(),
      cpm: z.number().nullable(),
    })
    .nullable(),
});

export type ParseRequestModel = z.infer<typeof parseRequestModelSchema>;

export const showCandidateSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim(),
});

export const disambiguateInputSchema = z.object({
  query: z.string().trim().min(1),
  candidates: z.array(showCandidateSchema).min(1),
});

export type DisambiguateInput = z.infer<typeof disambiguateInputSchema>;
export type ShowCandidate = z.infer<typeof showCandidateSchema>;

export const disambiguateModelSchema = z.object({
  choice: z.string().nullable(),
  ask: z.boolean(),
  reason: nonEmpty,
});

export type DisambiguateModel = z.infer<typeof disambiguateModelSchema>;

export const disambiguateResultSchema = z.object({
  choice: nonEmpty.optional(),
  ask: z.boolean(),
  reason: nonEmpty,
});

export type DisambiguateResult = z.infer<typeof disambiguateResultSchema>;

export const llmBaselineInputSchema = z.object({
  showName: z.string().trim().min(1),
  showDescription: z.string().trim().min(1),
});

export const parseRequestInputSchema = z.object({
  text: z.string().trim().min(1),
});
