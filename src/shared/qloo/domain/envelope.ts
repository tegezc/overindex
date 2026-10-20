import { z } from "zod";

export const envelopeStatusSchema = z.enum([
  "ok",
  "empty",
  "needs_input",
  "partial",
  "degraded",
  "error",
]);

export type EnvelopeStatus = z.infer<typeof envelopeStatusSchema>;

export const workflowErrorSchema = z.looseObject({
  code: z.string(),
  retryable: z.boolean(),
  recovery: z.string().optional(),
});

export type WorkflowError = z.infer<typeof workflowErrorSchema>;

const CACHEABLE: ReadonlySet<EnvelopeStatus> = new Set(["ok", "empty", "needs_input"]);

export function isCacheableStatus(status: EnvelopeStatus): boolean {
  return CACHEABLE.has(status);
}

export function workflowEnvelopeSchema<T extends z.ZodType>(results: T) {
  return z.looseObject({
    status: envelopeStatusSchema,
    summary: z.string(),
    results,
    result_count: z.number().optional(),
    error: workflowErrorSchema.optional(),
  });
}

export const describeEnvelopeSchema = workflowEnvelopeSchema(z.array(z.unknown())).extend({
  resolution: z.unknown().optional(),
});
export const findTagsEnvelopeSchema = workflowEnvelopeSchema(z.array(z.unknown()));
export const recommendEnvelopeSchema = workflowEnvelopeSchema(z.array(z.unknown()));
export const demographicsEnvelopeSchema = workflowEnvelopeSchema(z.array(z.unknown()));
export const entityTagsEnvelopeSchema = workflowEnvelopeSchema(z.array(z.unknown()));
export const trendsEnvelopeSchema = workflowEnvelopeSchema(z.array(z.unknown()));

export const compareResultsSchema = z.looseObject({
  tags: z.array(z.unknown()).optional(),
  a: z.unknown().optional(),
  b: z.unknown().optional(),
  matchEntities: z.array(z.unknown()).optional(),
});

export const compareEnvelopeSchema = workflowEnvelopeSchema(compareResultsSchema);

export type DescribeEnvelope = z.infer<typeof describeEnvelopeSchema>;
export type FindTagsEnvelope = z.infer<typeof findTagsEnvelopeSchema>;
export type RecommendEnvelope = z.infer<typeof recommendEnvelopeSchema>;
export type DemographicsEnvelope = z.infer<typeof demographicsEnvelopeSchema>;
export type EntityTagsEnvelope = z.infer<typeof entityTagsEnvelopeSchema>;
export type TrendsEnvelope = z.infer<typeof trendsEnvelopeSchema>;
export type CompareEnvelope = z.infer<typeof compareEnvelopeSchema>;

export const insightEntitySchema = z.looseObject({
  name: z.string().optional(),
  entity_id: z.string().optional(),
  popularity: z.number().optional(),
  query: z
    .looseObject({
      affinity: z.number().optional(),
    })
    .optional(),
});

export const insightsResultSchema = z.looseObject({
  status: envelopeStatusSchema,
  entities: z.array(insightEntitySchema),
  result_count: z.number(),
  error: workflowErrorSchema.optional(),
});

export type InsightEntity = z.infer<typeof insightEntitySchema>;
export type InsightsResult = z.infer<typeof insightsResultSchema>;

type TrackedResult = {
  status: EnvelopeStatus;
  error?: { code?: string; retryable?: boolean };
};

export function isRetryable(result: TrackedResult): boolean {
  return result.status === "error" && result.error?.retryable === true;
}

export function workflowError(code: string, retryable: boolean, results: unknown): {
  status: "error";
  summary: string;
  results: unknown;
  result_count: number;
  error: { code: string; retryable: boolean };
} {
  return {
    status: "error",
    summary: code,
    results,
    result_count: 0,
    error: { code, retryable },
  };
}

export function insightsError(code: string, retryable: boolean): InsightsResult {
  return {
    status: "error",
    entities: [],
    result_count: 0,
    error: { code, retryable },
  };
}

/**
 * Auth failures from `qloo exec` are `{ error, operation, correlation_id }`
 * without `status`. Fold that shape into an envelope before zod runs.
 * The returned summary is the error code only.
 */
export function normalizeWorkflowPayload(raw: unknown, resultsFallback: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.status === "string") {
    const error = normalizeError(obj.error);
    return {
      ...obj,
      summary: typeof obj.summary === "string" ? obj.summary : error?.code ?? String(obj.status),
      results: obj.results === undefined ? resultsFallback : obj.results,
      ...(error ? { error } : {}),
    };
  }
  const error = normalizeError(obj.error) ?? { code: "UNKNOWN", retryable: false };
  return {
    status: "error",
    summary: error.code,
    results: resultsFallback,
    result_count: 0,
    error,
  };
}

function normalizeError(error: unknown): { code: string; retryable: boolean; recovery?: string } | undefined {
  if (!error || typeof error !== "object") return undefined;
  const obj = error as Record<string, unknown>;
  const code = typeof obj.code === "string" && obj.code ? obj.code : "UNKNOWN";
  const recovery = typeof obj.recovery === "string" ? obj.recovery : undefined;
  return {
    code,
    retryable: obj.retryable === true,
    ...(recovery ? { recovery } : {}),
  };
}

function parseWorkflow<T>(schema: z.ZodType<T>, raw: unknown, resultsFallback: unknown, emptyResults: unknown): T {
  const parsed = schema.safeParse(normalizeWorkflowPayload(raw, resultsFallback));
  if (parsed.success) return parsed.data;
  return schema.parse(workflowError("SCHEMA", false, emptyResults));
}

export function parseDescribe(raw: unknown): DescribeEnvelope {
  return parseWorkflow(describeEnvelopeSchema, raw, [], []);
}

export function parseFindTags(raw: unknown): FindTagsEnvelope {
  return parseWorkflow(findTagsEnvelopeSchema, raw, [], []);
}

export function parseRecommend(raw: unknown): RecommendEnvelope {
  return parseWorkflow(recommendEnvelopeSchema, raw, [], []);
}

export function parseDemographics(raw: unknown): DemographicsEnvelope {
  return parseWorkflow(demographicsEnvelopeSchema, raw, [], []);
}

export function parseEntityTags(raw: unknown): EntityTagsEnvelope {
  return parseWorkflow(entityTagsEnvelopeSchema, raw, [], []);
}

export function parseTrends(raw: unknown): TrendsEnvelope {
  return parseWorkflow(trendsEnvelopeSchema, raw, [], []);
}

export function parseCompare(raw: unknown): CompareEnvelope {
  const empty = { tags: [], a: [], b: [], matchEntities: [] };
  return parseWorkflow(compareEnvelopeSchema, raw, empty, empty);
}

export function parseInsightsResult(raw: unknown): InsightsResult {
  const parsed = insightsResultSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return insightsError("SCHEMA", false);
}
