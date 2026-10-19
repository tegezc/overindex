import type { QlooPort } from "../application/qloo-port";
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
import type { McpQlooClient } from "./mcp-qloo-client";
import type { QlooApiRunner } from "./qloo-api-runner";

export class HarnessQloo implements QlooPort {
  constructor(
    private readonly mcp: McpQlooClient,
    private readonly api: QlooApiRunner,
  ) {}

  describe(input: DescribeInput): Promise<DescribeEnvelope> {
    return this.mcp.describe(input);
  }

  findTags(input: FindTagsInput): Promise<FindTagsEnvelope> {
    return this.mcp.findTags(input);
  }

  recommend(input: RecommendInput): Promise<RecommendEnvelope> {
    return this.mcp.recommend(input);
  }

  compareAudiences(input: CompareInput): Promise<CompareEnvelope> {
    return this.mcp.compareAudiences(input);
  }

  audienceDemographics(input: DemographicsInput): Promise<DemographicsEnvelope> {
    return this.mcp.audienceDemographics(input);
  }

  entityTags(input: EntityTagsInput): Promise<EntityTagsEnvelope> {
    return this.mcp.entityTags(input);
  }

  trends(input: TrendsInput): Promise<TrendsEnvelope> {
    return this.mcp.trends(input);
  }

  scoreCandidates(input: ScoreCandidatesInput): Promise<InsightsResult> {
    return this.api.scoreCandidates(input);
  }

  insightsRaw(input: InsightsRawInput): Promise<InsightsResult> {
    return this.api.insightsRaw(input);
  }

  close(): Promise<void> {
    return this.mcp.close();
  }
}
