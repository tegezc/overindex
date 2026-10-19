import type { QlooPort } from "../application/qloo-port";
import {
  parseCompare,
  parseDemographics,
  parseDescribe,
  parseEntityTags,
  parseFindTags,
  parseInsightsResult,
  parseRecommend,
  parseTrends,
  type CompareEnvelope,
  type DemographicsEnvelope,
  type DescribeEnvelope,
  type EntityTagsEnvelope,
  type FindTagsEnvelope,
  type InsightsResult,
  type RecommendEnvelope,
  type TrendsEnvelope,
} from "../domain/envelope";
import type {
  CompareInput,
  DemographicsInput,
  DescribeInput,
  EntityTagsInput,
  FindTagsInput,
  InsightsRawInput,
  RecommendInput,
  ScoreCandidatesInput,
  TrendsInput,
} from "../domain/inputs";

const SHOW_NORTH = "AAAAAAAA-BBBB-4CCC-8DDD-000000000001";
const BRAND_ALPHA = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1";
const BRAND_BETA = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000B2";

export type FakeScripts = Partial<Record<FakeMethod, unknown[]>>;

type FakeMethod =
  | "describe"
  | "findTags"
  | "recommend"
  | "compareAudiences"
  | "audienceDemographics"
  | "entityTags"
  | "trends"
  | "scoreCandidates"
  | "insightsRaw";

/**
 * Synthetic Qloo stand-in. Names are fictional ("Brand Alpha", "Show North").
 * This is not a recording of Qloo responses.
 */
export class FakeQloo implements QlooPort {
  readonly calls: { tool: string; args: unknown }[] = [];
  private readonly queues: Map<string, unknown[]>;

  constructor(scripts: FakeScripts = {}) {
    this.queues = new Map(Object.entries(scripts).map(([name, items]) => [name, [...items]]));
  }

  describe(input: DescribeInput): Promise<DescribeEnvelope> {
    return this.step("describe", "qloo_describe", input, parseDescribe, () => ({
      status: "ok",
      summary: "Synthetic describe result",
      results: [{ entity_id: SHOW_NORTH, name: "Show North", type: input.type ?? "podcast" }],
      result_count: 1,
    }));
  }

  findTags(input: FindTagsInput): Promise<FindTagsEnvelope> {
    return this.step("findTags", "qloo_find_tags", input, parseFindTags, () => ({
      status: "ok",
      summary: "Synthetic tags",
      results: [{ id: "tag-alpha", name: "Topic Alpha" }],
      result_count: 1,
    }));
  }

  recommend(input: RecommendInput): Promise<RecommendEnvelope> {
    return this.step("recommend", "qloo_recommend", input, parseRecommend, () => ({
      status: "ok",
      summary: "Synthetic recommendations",
      results: [{ entity_id: BRAND_ALPHA, name: "Brand Alpha", type: input.target_type, popularity: 0.42 }],
      result_count: 1,
    }));
  }

  compareAudiences(input: CompareInput): Promise<CompareEnvelope> {
    return this.step("compareAudiences", "qloo_compare_audiences", input, parseCompare, () => ({
      status: "ok",
      summary: "Synthetic audience comparison",
      results: {
        tags: [],
        a: [{ name: "Topic Alpha" }],
        b: [{ name: "Topic Beta" }],
        matchEntities: [],
      },
      result_count: 0,
    }));
  }

  audienceDemographics(input: DemographicsInput): Promise<DemographicsEnvelope> {
    return this.step("audienceDemographics", "qloo_audience_demographics", input, parseDemographics, () => ({
      status: "empty",
      summary: "Synthetic demographics are empty",
      results: [],
      result_count: 0,
    }));
  }

  entityTags(input: EntityTagsInput): Promise<EntityTagsEnvelope> {
    return this.step("entityTags", "qloo_entity_tags", input, parseEntityTags, () => ({
      status: "ok",
      summary: "Synthetic entity tags",
      results: [{ name: "Topic Alpha" }],
      result_count: 1,
    }));
  }

  trends(input: TrendsInput): Promise<TrendsEnvelope> {
    return this.step("trends", "qloo_trends", input, parseTrends, () => ({
      status: "ok",
      summary: "Synthetic trend",
      results: [{ name: "Brand Alpha", direction: "flat" }],
      result_count: 1,
    }));
  }

  scoreCandidates(input: ScoreCandidatesInput): Promise<InsightsResult> {
    return this.step("scoreCandidates", "api:insights", input, parseInsightsResult, () => ({
      status: "ok",
      entities: [
        { name: "Brand Alpha", entity_id: BRAND_ALPHA, popularity: 0.42, query: { affinity: 0.81 } },
        { name: "Brand Beta", entity_id: BRAND_BETA, popularity: 0.15, query: { affinity: 0.33 } },
      ],
      result_count: 2,
    }));
  }

  insightsRaw(input: InsightsRawInput): Promise<InsightsResult> {
    return this.step("insightsRaw", "api:insights", input, parseInsightsResult, () => ({
      status: "ok",
      entities: [{ name: "Brand Alpha", entity_id: BRAND_ALPHA, popularity: 0.42, query: { affinity: 0.5 } }],
      result_count: 1,
    }));
  }

  private async step<T>(
    method: FakeMethod,
    tool: string,
    args: unknown,
    parse: (raw: unknown) => T,
    synthetic: () => unknown,
  ): Promise<T> {
    this.calls.push({ tool, args });
    const queued = this.queues.get(method);
    const raw = queued && queued.length > 0 ? queued.shift() : synthetic();
    return parse(raw);
  }
}
