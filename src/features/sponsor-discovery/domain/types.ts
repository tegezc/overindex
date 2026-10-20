import { z } from "zod";

export const candidateOriginSchema = z.enum(["qloo_discovery", "llm_baseline", "lane_a", "user_sponsor"]);
export const reachBandSchema = z.enum(["challenger", "established", "household"]);
export const laneSchema = z.enum(["A", "B"]);
export const quadrantSchema = z.enum(["proven", "hidden", "category_only", "none"]);

export const brandCandidateSchema = z.object({
  brand: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("brand"),
  }),
  origins: z.array(candidateOriginSchema).min(1),
  affinityRaw: z.number().optional(),
  pctShow: z.number().optional(),
  pctBase: z.number().optional(),
  lift: z.number().optional(),
  popularity: z.number().optional(),
  reachBand: reachBandSchema.optional(),
  fit: z.number().optional(),
  llmRank: z.number().int().positive().optional(),
  lane: laneSchema,
  quadrant: quadrantSchema,
  flags: z.object({
    renewal: z.boolean().optional(),
    noTasteSignal: z.boolean().optional(),
    category: z
      .object({
        label: z.string().min(1),
        source: z.enum(["qloo_tags", "ai_classified"]),
      })
      .optional(),
  }),
});

export type CandidateOrigin = z.infer<typeof candidateOriginSchema>;
export type ReachBand = z.infer<typeof reachBandSchema>;
export type Lane = z.infer<typeof laneSchema>;
export type Quadrant = z.infer<typeof quadrantSchema>;
export type BrandCandidate = z.infer<typeof brandCandidateSchema>;

export type CategoryLabel = {
  label: string;
  source: "qloo_tags" | "ai_classified";
};

export type PoolItem = {
  id: string;
  name: string;
  origins: CandidateOrigin[];
  popularity?: number;
  categories: CategoryLabel[];
  llmRank?: number;
  affinityShow?: number;
  affinityBase?: number;
};
