import { z } from "zod";

const limitSchema = z.number().int().min(1).max(20);

export const describeInputSchema = z.object({
  entity: z.string().min(1),
  type: z.string().min(1).optional(),
});

export const findTagsInputSchema = z.object({
  query: z.string().min(1),
  semantic: z.boolean().optional(),
  limit: limitSchema.optional(),
});

export const recommendInputSchema = z.object({
  target_type: z.string().min(1),
  signals: z.array(z.string().min(1)).max(10).optional(),
  signal_tags: z.array(z.string().min(1)).max(10).optional(),
  signal_tags_operator: z.enum(["union", "intersection"]).optional(),
  signal_location: z.string().min(1).optional(),
  demographic: z.string().min(1).optional(),
  filter_location: z.string().min(1).optional(),
  include_tags: z.array(z.string().min(1)).max(10).optional(),
  exclude_tags: z.array(z.string().min(1)).max(10).optional(),
  explain: z.boolean().optional(),
  limit: limitSchema.optional(),
});

export const compareInputSchema = z.object({
  group_a: z.array(z.string().min(1)).min(1).max(10),
  group_b: z.array(z.string().min(1)).min(1).max(10),
  target_type: z.string().min(1).optional(),
  limit: limitSchema.optional(),
});

export const demographicsInputSchema = z.object({
  entity: z.string().min(1),
  entity_type: z.string().min(1).optional(),
  limit: limitSchema.optional(),
});

export const entityTagsInputSchema = z.object({
  entities: z.array(z.string().min(1)).min(1).max(10),
  entity_type: z.string().min(1).optional(),
  limit: limitSchema.optional(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const trendsInputSchema = z.object({
  entities: z.array(z.string().min(1)).min(1).max(5),
  entity_type: z.string().min(1),
  start_date: isoDate,
  end_date: isoDate,
  limit: limitSchema.optional(),
});

export const scoreCandidatesInputSchema = z.object({
  signalEntityIds: z.array(z.string().min(1)).max(10),
  candidateIds: z.array(z.string().min(1)).min(1),
  take: z.number().int().positive().optional(),
  explainability: z.boolean().optional(),
  type: z.string().min(1).default("brand"),
});

export const insightsRawInputSchema = z.object({
  type: z.string().min(1),
  signalEntityIds: z.array(z.string().min(1)).max(10).optional(),
  take: z.number().int().positive().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export type DescribeInput = z.input<typeof describeInputSchema>;
export type FindTagsInput = z.input<typeof findTagsInputSchema>;
export type RecommendInput = z.input<typeof recommendInputSchema>;
export type CompareInput = z.input<typeof compareInputSchema>;
export type DemographicsInput = z.input<typeof demographicsInputSchema>;
export type EntityTagsInput = z.input<typeof entityTagsInputSchema>;
export type TrendsInput = z.input<typeof trendsInputSchema>;
export type ScoreCandidatesInput = z.input<typeof scoreCandidatesInputSchema>;
export type InsightsRawInput = z.input<typeof insightsRawInputSchema>;
