import type {
  CompareEnvelope,
  DemographicsEnvelope,
  DescribeEnvelope,
  EntityTagsEnvelope,
  FindTagsEnvelope,
  InsightsResult,
  RecommendEnvelope,
  TrendsEnvelope,
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

/**
 * Raw Qloo operations. `rank` is intentionally absent (D-021): the spike saw
 * `qloo_rank` return 429, and candidate scores go through insights instead.
 */
export interface QlooPort {
  describe(input: DescribeInput): Promise<DescribeEnvelope>;
  findTags(input: FindTagsInput): Promise<FindTagsEnvelope>;
  recommend(input: RecommendInput): Promise<RecommendEnvelope>;
  compareAudiences(input: CompareInput): Promise<CompareEnvelope>;
  audienceDemographics(input: DemographicsInput): Promise<DemographicsEnvelope>;
  entityTags(input: EntityTagsInput): Promise<EntityTagsEnvelope>;
  trends(input: TrendsInput): Promise<TrendsEnvelope>;
  scoreCandidates(input: ScoreCandidatesInput): Promise<InsightsResult>;
  insightsRaw(input: InsightsRawInput): Promise<InsightsResult>;
}

export const QLOO_TOOLS = [
  "qloo_describe",
  "qloo_find_tags",
  "qloo_recommend",
  "qloo_compare_audiences",
  "qloo_audience_demographics",
  "qloo_entity_tags",
  "qloo_trends",
  "api:insights",
] as const;

export type QlooTool = (typeof QLOO_TOOLS)[number];
