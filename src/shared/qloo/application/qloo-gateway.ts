import { randomUUID } from "node:crypto";
import { cacheKey } from "@/shared/cache/cache-key";
import type { MemoryTraceSink } from "@/shared/trace/trace";
import { BudgetCounter } from "./budget";
import type { QlooCache } from "./qloo-cache";
import type { QlooPort } from "./qloo-port";
import { backoffMs, MAX_ATTEMPTS } from "./retry-policy";
import {
  compareEnvelopeSchema,
  demographicsEnvelopeSchema,
  describeEnvelopeSchema,
  entityTagsEnvelopeSchema,
  findTagsEnvelopeSchema,
  insightsError,
  insightsResultSchema,
  isCacheableStatus,
  isRetryable,
  recommendEnvelopeSchema,
  trendsEnvelopeSchema,
  workflowError,
  type CompareEnvelope,
  type DemographicsEnvelope,
  type DescribeEnvelope,
  type EntityTagsEnvelope,
  type EnvelopeStatus,
  type FindTagsEnvelope,
  type InsightsResult,
  type RecommendEnvelope,
  type TrendsEnvelope,
} from "../domain/envelope";
import {
  compareInputSchema,
  demographicsInputSchema,
  describeInputSchema,
  entityTagsInputSchema,
  findTagsInputSchema,
  insightsRawInputSchema,
  recommendInputSchema,
  scoreCandidatesInputSchema,
  trendsInputSchema,
  type CompareInput,
  type DemographicsInput,
  type DescribeInput,
  type EntityTagsInput,
  type FindTagsInput,
  type InsightsRawInput,
  type RecommendInput,
  type ScoreCandidatesInput,
  type TrendsInput,
} from "../domain/inputs";
import { provenanceSchema, redactParams, type Provenance, type QlooCall } from "../domain/provenance";
import type { z } from "zod";

export type QlooLog = {
  tool: string;
  status: EnvelopeStatus;
  durationMs: number;
  resultCount?: number;
  cached: boolean;
  attempt: number;
};

type Tracked = {
  status: EnvelopeStatus;
  error?: { code?: string; retryable?: boolean };
  result_count?: number;
};

export type QlooGatewayOptions = {
  budget: BudgetCounter;
  trace: MemoryTraceSink;
  cache: QlooCache;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (entry: QlooLog) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Budget, trace, provenance, retry, and filesystem cache around a QlooPort.
 * A cache hit is traced but does not spend budget: the cap counts Qloo calls.
 * Retry runs only when `error.retryable === true`.
 */
export class QlooGateway {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly log?: (entry: QlooLog) => void;

  constructor(
    private readonly inner: QlooPort,
    private readonly options: QlooGatewayOptions,
  ) {
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
    this.log = options.log;
  }

  get budget(): BudgetCounter {
    return this.options.budget;
  }

  describe(input: DescribeInput): Promise<QlooCall<DescribeEnvelope>> {
    const args = describeInputSchema.parse(input);
    return this.execute("qloo_describe", args, describeEnvelopeSchema, () => this.inner.describe(args), arrayFailure);
  }

  findTags(input: FindTagsInput): Promise<QlooCall<FindTagsEnvelope>> {
    const args = findTagsInputSchema.parse(input);
    return this.execute("qloo_find_tags", args, findTagsEnvelopeSchema, () => this.inner.findTags(args), arrayFailure);
  }

  recommend(input: RecommendInput): Promise<QlooCall<RecommendEnvelope>> {
    const args = recommendInputSchema.parse(input);
    return this.execute("qloo_recommend", args, recommendEnvelopeSchema, () => this.inner.recommend(args), arrayFailure);
  }

  compareAudiences(input: CompareInput): Promise<QlooCall<CompareEnvelope>> {
    const args = compareInputSchema.parse(input);
    return this.execute(
      "qloo_compare_audiences",
      args,
      compareEnvelopeSchema,
      () => this.inner.compareAudiences(args),
      compareFailure,
    );
  }

  audienceDemographics(input: DemographicsInput): Promise<QlooCall<DemographicsEnvelope>> {
    const args = demographicsInputSchema.parse(input);
    return this.execute(
      "qloo_audience_demographics",
      args,
      demographicsEnvelopeSchema,
      () => this.inner.audienceDemographics(args),
      arrayFailure,
    );
  }

  entityTags(input: EntityTagsInput): Promise<QlooCall<EntityTagsEnvelope>> {
    const args = entityTagsInputSchema.parse(input);
    return this.execute(
      "qloo_entity_tags",
      args,
      entityTagsEnvelopeSchema,
      () => this.inner.entityTags(args),
      arrayFailure,
    );
  }

  trends(input: TrendsInput): Promise<QlooCall<TrendsEnvelope>> {
    const args = trendsInputSchema.parse(input);
    return this.execute("qloo_trends", args, trendsEnvelopeSchema, () => this.inner.trends(args), arrayFailure);
  }

  scoreCandidates(input: ScoreCandidatesInput): Promise<QlooCall<InsightsResult>> {
    const args = scoreCandidatesInputSchema.parse(input);
    return this.execute(
      "api:insights",
      args,
      insightsResultSchema,
      () => this.inner.scoreCandidates(args),
      insightsFailure,
    );
  }

  insightsRaw(input: InsightsRawInput): Promise<QlooCall<InsightsResult>> {
    const args = insightsRawInputSchema.parse(input);
    return this.execute("api:insights", args, insightsResultSchema, () => this.inner.insightsRaw(args), insightsFailure);
  }

  private async execute<T extends Tracked>(
    tool: string,
    args: unknown,
    schema: z.ZodType<T>,
    run: () => Promise<unknown>,
    failure: (code: string, retryable: boolean) => unknown,
  ): Promise<QlooCall<T>> {
    const params = redactParams(args);
    const key = cacheKey(tool, params);
    const stored = await this.options.cache.get(key);
    const cached = stored === undefined ? undefined : schema.safeParse(stored);
    if (cached?.success && isCacheableStatus(cached.data.status)) {
      const data = cached.data;
      this.options.trace.emit({ kind: "tool_call", tool, summary: `${tool} start cached` });
      this.record(tool, data, 0, true, 0);
      return { data, provenance: this.provenance(tool, params, data.status, true) };
    }

    let lastError: T | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        if (!lastError || !isRetryable(lastError)) break;
        if (this.options.budget.used >= this.options.budget.cap) {
          this.options.trace.emit({
            kind: "budget",
            tool,
            status: "error",
            summary: `${tool} retry skipped at budget cap`,
          });
          break;
        }
        await this.sleep(backoffMs(lastError.error?.code, attempt - 1));
      }

      if (!this.options.budget.tryTake()) {
        const data = schema.parse(failure("BUDGET_CAP", false));
        this.options.trace.emit({
          kind: "error",
          tool,
          status: "error",
          summary: `${tool} blocked by budget cap`,
        });
        return { data, provenance: this.provenance(tool, params, "error", false) };
      }

      const started = this.now().getTime();
      this.options.trace.emit({ kind: "tool_call", tool, summary: `${tool} start` });
      const data = await this.read(schema, run, failure);
      const durationMs = Math.max(0, this.now().getTime() - started);
      this.record(tool, data, durationMs, false, attempt);
      if (!isRetryable(data)) {
        if (isCacheableStatus(data.status)) await this.options.cache.set(key, data);
        return { data, provenance: this.provenance(tool, params, data.status, false) };
      }
      lastError = data;
    }

    const data = lastError ?? schema.parse(failure("QLOO_CALL_FAILED", false));
    return { data, provenance: this.provenance(tool, params, data.status, false) };
  }

  private async read<T>(
    schema: z.ZodType<T>,
    run: () => Promise<unknown>,
    failure: (code: string, retryable: boolean) => unknown,
  ): Promise<T> {
    try {
      return schema.parse(await run());
    } catch {
      return schema.parse(failure("QLOO_CALL_FAILED", false));
    }
  }

  private record(tool: string, data: Tracked, durationMs: number, cached: boolean, attempt: number): void {
    const count = typeof data.result_count === "number" ? ` count=${data.result_count}` : "";
    this.options.trace.emit({
      kind: "tool_result",
      tool,
      status: data.status,
      summary: `${tool} ${data.status}${cached ? " cached" : ""}${count}`,
      durationMs,
    });
    this.log?.({
      tool,
      status: data.status,
      durationMs,
      resultCount: data.result_count,
      cached,
      attempt,
    });
  }

  private provenance(tool: string, params: Record<string, unknown>, status: EnvelopeStatus, cached: boolean): Provenance {
    return provenanceSchema.parse({
      callId: randomUUID(),
      tool,
      params,
      at: this.now().toISOString(),
      status,
      cached,
    });
  }
}

function arrayFailure(code: string, retryable: boolean) {
  return workflowError(code, retryable, []);
}

function compareFailure(code: string, retryable: boolean) {
  return workflowError(code, retryable, { tags: [], a: [], b: [], matchEntities: [] });
}

function insightsFailure(code: string, retryable: boolean) {
  return insightsError(code, retryable);
}
