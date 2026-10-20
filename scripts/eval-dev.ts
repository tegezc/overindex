import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { DISCOVER_TAKE, POPULARITY_BANDS, SCORE_BATCH_SIZE } from "../src/shared/config/scoring";
import { getEnv } from "../src/shared/config/env";
import { FileQlooCache } from "../src/shared/cache/file-cache";
import { llmBaselineSchema } from "../src/shared/llm/domain/schemas";
import { renderLlmBaselinePrompt } from "../src/shared/llm/prompts/v1/llm-baseline";
import { BudgetCounter } from "../src/shared/qloo/application/budget";
import { QlooGateway } from "../src/shared/qloo/application/qloo-gateway";
import type { QlooPort } from "../src/shared/qloo/application/qloo-port";
import type { DescribeEnvelope, InsightsResult } from "../src/shared/qloo/domain/envelope";
import type { DescribeInput, InsightsRawInput, ScoreCandidatesInput } from "../src/shared/qloo/domain/inputs";
import { HarnessQloo } from "../src/shared/qloo/infrastructure/harness-qloo";
import { closeSharedMcpClient, getSharedMcpClient } from "../src/shared/qloo/infrastructure/mcp-qloo-client";
import { QlooApiRunner } from "../src/shared/qloo/infrastructure/qloo-api-runner";
import { MemoryTraceSink } from "../src/shared/trace/trace";
import { percentile } from "../src/features/sponsor-discovery/domain/scoring";
import { nameAccepts, normalizeBrandName } from "../src/features/sponsor-discovery/domain/names";
import { readInsightBrands } from "../src/features/sponsor-discovery/domain/entities";
import { selectBrand } from "../src/features/sponsor-discovery/domain/select-brand";
import { BASELINE_BASKET } from "../src/features/sponsor-discovery/domain/basket";
import { FileBaselineStore } from "../src/features/sponsor-discovery/infrastructure/baseline-store";
import { loadLaneACatalog } from "../src/features/sponsor-discovery/infrastructure/lane-a-file";
import { extractShowCandidates } from "../src/features/show/domain/candidates";
import { loadGroundTruthCsv, loadShowsCsv, mentionsFromGroundTruth, type ShowRecord } from "../eval/src/dataset";
import { candidateSet, scoreQ1Split, type Q1Signals } from "../eval/src/q1";
import { mostFrequentBrands, scoreQ2Split, type Q2ShowInput } from "../eval/src/q2";
import { ALPHA_GRID, EVAL_SEED, LAMBDA_GRID, Q2_CUTOFF } from "../eval/src/protocol";
import { renderQ1Prompt, type Q1PromptVariant } from "../eval/src/prompts";
import { seededPermutation } from "../eval/src/rng";
import { publishedResultsDir, summarizeQ1, summarizeQ2, writeAggregateReport } from "../eval/src/results";
import { splitMismatches } from "../eval/src/split";
import { meanMetric, q1RequestLength, rankPoolByFit, selectAlphaLambda, selectPrompt, type GridCell } from "../eval/src/tune";

const MODEL = "gpt-6.1-sol";
const CALL_CEILING = 2000;
const FATAL_QLOO = new Set(["QLOO_AUTH", "BASE_URL", "QLOO_NOT_INSTALLED"]);
const BANNED_FIELDS = new Set([
  "ranking",
  "brands",
  "entityId",
  "entity_id",
  "affinity",
  "brandNorm",
  "brand_norm",
  "name",
  "description",
  "prompt",
  "id",
]);

class StopRun extends Error {
  constructor(
    readonly kind: "quota" | "fatal",
    readonly code: string,
  ) {
    super(kind);
    this.name = "StopRun";
  }
}

type Tracked = { status: string; error?: { code?: string; retryable?: boolean } };

class QuotaOnce implements QlooPort {
  code: string | undefined;

  constructor(private readonly inner: QlooPort) {}

  describe(input: DescribeInput): Promise<DescribeEnvelope> {
    return this.pass(this.inner.describe(input));
  }

  findTags(input: Parameters<QlooPort["findTags"]>[0]) {
    return this.pass(this.inner.findTags(input));
  }

  recommend(input: Parameters<QlooPort["recommend"]>[0]) {
    return this.pass(this.inner.recommend(input));
  }

  compareAudiences(input: Parameters<QlooPort["compareAudiences"]>[0]) {
    return this.pass(this.inner.compareAudiences(input));
  }

  audienceDemographics(input: Parameters<QlooPort["audienceDemographics"]>[0]) {
    return this.pass(this.inner.audienceDemographics(input));
  }

  entityTags(input: Parameters<QlooPort["entityTags"]>[0]) {
    return this.pass(this.inner.entityTags(input));
  }

  trends(input: Parameters<QlooPort["trends"]>[0]) {
    return this.pass(this.inner.trends(input));
  }

  scoreCandidates(input: ScoreCandidatesInput): Promise<InsightsResult> {
    return this.pass(this.inner.scoreCandidates(input));
  }

  insightsRaw(input: InsightsRawInput): Promise<InsightsResult> {
    return this.pass(this.inner.insightsRaw(input));
  }

  private async pass<T extends Tracked>(pending: Promise<T>): Promise<T> {
    const data = await pending;
    const code = quotaCodeOf(data);
    if (!code) return data;
    this.code = this.code ?? code;
    if (data.error) data.error.retryable = false;
    return data;
  }
}

type LlmCacheFile = {
  rank: Record<string, string[]>;
  baseline: Record<string, { name: string; category: string }[]>;
};

const llmCacheSchema = z.object({
  rank: z.record(z.string(), z.array(z.string())),
  baseline: z.record(z.string(), z.array(z.object({ name: z.string(), category: z.string() }))),
});

const progressSchema = z.object({
  stage: z.string(),
  qlooCalls: z.number().int().nonnegative(),
  openaiCalls: z.number().int().nonnegative(),
  tools: z.record(z.string(), z.number().int().nonnegative()).optional(),
  stopped: z
    .object({
      reason: z.enum(["quota", "error"]),
      code: z.string(),
      stage: z.string(),
    })
    .nullable(),
});

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    process.stderr.write("eval:dev takes no arguments and measures the dev split only\n");
    return 2;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    process.stderr.write("OPENAI_API_KEY is not set in this process. This script does not read key files and does not print the key.\n");
    return 2;
  }
  if (process.env.USE_FAKE_QLOO === "true") {
    process.stderr.write("eval:dev refuses USE_FAKE_QLOO\n");
    return 2;
  }
  if ((process.env.OPENAI_MODEL?.trim() || MODEL) !== MODEL) {
    process.stderr.write("OPENAI_MODEL must be gpt-6.1-sol for this protocol\n");
    return 2;
  }
  if ((process.env.OPENAI_REASONING_EFFORT?.trim() || "medium") !== "medium") {
    process.stderr.write("OPENAI_REASONING_EFFORT must be medium for this protocol\n");
    return 2;
  }

  const env = getEnv();
  const cacheDir = env.CACHE_DIR;
  if (path.resolve(cacheDir).includes(`${path.sep}eval${path.sep}`)) {
    process.stderr.write("cache directory must stay outside eval/\n");
    return 2;
  }
  const privateDir = path.join(cacheDir, "eval-dev");
  const progressPath = path.join(privateDir, "progress.json");
  const llmPath = path.join(privateDir, "llm.json");
  const prior = readProgress(progressPath);
  if (prior?.stopped?.reason === "quota") {
    process.stderr.write(`stopped quota ${prior.stopped.code} stage=${prior.stopped.stage} already recorded\n`);
    return 3;
  }

  const shows = loadShowsCsv(path.join(process.cwd(), "eval/dataset/shows.csv"));
  const groundTruth = loadGroundTruthCsv(path.join(process.cwd(), "eval/dataset/ground_truth.csv"));
  const laneA = loadLaneACatalog(path.join(process.cwd(), "eval/dataset/lane_a_buyers.csv"));
  if (splitMismatches(shows).length > 0) {
    process.stderr.write("stored split does not match the frozen rule\n");
    return 2;
  }
  const devShows = shows.filter((show) => show.split === "dev");
  const testCount = shows.length - devShows.length;
  if (devShows.length !== 10 || testCount !== 20) {
    process.stderr.write("unexpected split sizes\n");
    return 2;
  }
  if (devShows.some((show) => show.split !== "dev")) return 2;

  const mentions = mentionsFromGroundTruth(groundTruth);
  const brandNorms = [...new Set(groundTruth.map((row) => row.brandNorm))].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const sponsorsByShow = new Map<string, string[]>();
  for (const show of shows) {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const row of groundTruth) {
      if (row.showId !== show.showId || seen.has(row.brandNorm)) continue;
      seen.add(row.brandNorm);
      names.push(row.brandNorm);
    }
    sponsorsByShow.set(show.showId, names);
  }

  const budget = new BudgetCounter(CALL_CEILING, CALL_CEILING);
  const guard = new QuotaOnce(new HarnessQloo(getSharedMcpClient(), new QlooApiRunner()));
  const tools: Record<string, number> = { ...(prior?.tools ?? {}) };
  let cacheHits = 0;
  let rankSeen = false;
  const qloo = new QlooGateway(guard, {
    budget,
    trace: new MemoryTraceSink(),
    cache: new FileQlooCache(cacheDir),
    log: (entry) => {
      if (entry.tool.toLowerCase().includes("rank")) rankSeen = true;
      if (entry.cached) cacheHits += 1;
      else tools[entry.tool] = (tools[entry.tool] ?? 0) + 1;
    },
  });
  const openai = new OpenAI({ apiKey, maxRetries: 0 });
  const llm = readLlm(llmPath);
  const entityByNorm = new Map<string, string>();
  const showEntity = new Map<string, string>();
  const showAffinity = new Map<string, Map<string, number>>();
  const baselineMem = new Map<string, number>();
  const baselineStore = new FileBaselineStore(cacheDir);
  const baseQloo = prior?.qlooCalls ?? 0;
  const baseOpenai = prior?.openaiCalls ?? 0;
  let openaiNew = 0;
  let stage = "preflight";
  const showFail = { notConfident: 0, nameMismatch: 0, empty: 0, error: 0 };
  let brandsResolved = 0;

  const counts = () => ({ qloo: baseQloo + budget.used, openai: baseOpenai + openaiNew });
  const saveProgress = (stopped: { reason: "quota" | "error"; code: string; stage: string } | null) => {
    mkdirSync(privateDir, { recursive: true });
    const body = {
      stage,
      devShows: devShows.length,
      testShowsNotMeasured: testCount,
      showsResolved: showEntity.size,
      brandsTotal: brandNorms.length,
      brandsResolved,
      qlooCalls: counts().qloo,
      openaiCalls: counts().openai,
      qlooCacheHitsThisProcess: cacheHits,
      tools,
      stopped,
    };
    writeFileSync(progressPath, `${JSON.stringify(body)}\n`, "utf8");
  };
  const note = (detail: string) => {
    const now = counts();
    process.stderr.write(`stage=${stage} ${detail} qloo=${now.qloo} openai=${now.openai}\n`);
  };
  const afterCall = (data: Tracked) => {
    if (rankSeen) throw new StopRun("fatal", "QLOO_RANK");
    if (guard.code) throw new StopRun("quota", guard.code);
    if (data.status !== "error") return;
    const code = data.error?.code ?? "QLOO_ERROR";
    if (code === "BUDGET_CAP" || budget.used > CALL_CEILING) throw new StopRun("fatal", "CALL_CEILING");
    if (FATAL_QLOO.has(code)) throw new StopRun("fatal", code);
  };

  try {
    stage = "resolve-shows";
    saveProgress(null);
    for (const show of devShows) {
      const resolved = await resolveShow(show.name, qloo, afterCall);
      if (typeof resolved === "string") showFail[resolved] += 1;
      else showEntity.set(show.showId, resolved.id);
      note(`shows ${showEntity.size}/${devShows.length}`);
    }

    stage = "resolve-brands";
    saveProgress(null);
    let attempted = 0;
    for (const brandNorm of brandNorms) {
      attempted += 1;
      const id = await resolveBrand(brandNorm, entityByNorm, qloo, afterCall);
      if (id) brandsResolved += 1;
      if (attempted % 10 === 0 || attempted === brandNorms.length) note(`brands ${attempted}/${brandNorms.length}`);
    }

    stage = "resolve-basket";
    saveProgress(null);
    const basketIds: string[] = [];
    for (const name of BASELINE_BASKET) {
      const resolved = await resolveShow(name, qloo, afterCall);
      if (typeof resolved !== "string") basketIds.push(resolved.id);
    }
    note(`basket ${basketIds.length}/${BASELINE_BASKET.length}`);
    if (basketIds.length === 0) throw new StopRun("fatal", "BASKET_EMPTY");

    const resolvedBrands = new Set(brandNorms.filter((brand) => entityByNorm.has(normalizeBrandName(brand))));
    const q1Measured = devShows.filter((show) => {
      if (!showEntity.has(show.showId)) return false;
      return candidateSet(show.showId, mentions, resolvedBrands).relevant.length > 0;
    });
    if (q1Measured.length === 0) throw new StopRun("fatal", "Q1_EMPTY");

    stage = "score-q1";
    saveProgress(null);
    for (const show of q1Measured) {
      const entityId = showEntity.get(show.showId);
      if (!entityId) throw new StopRun("fatal", "SHOW_ID_MISSING");
      const { candidates } = candidateSet(show.showId, mentions, resolvedBrands);
      const ids = entityIds(candidates, entityByNorm);
      const table = showAffinity.get(show.showId) ?? new Map<string, number>();
      showAffinity.set(show.showId, table);
      await scoreMissing(ids, [entityId], table, qloo, afterCall);
      await ensureBaseline(ids, basketIds, baselineMem, baselineStore, qloo, afterCall);
      note(`scored ${showAffinity.size}/${q1Measured.length}`);
    }

    stage = "rank-m2";
    saveProgress(null);
    const rankings = new Map<Q1PromptVariant, Map<string, string[]>>([
      ["A.1a", new Map()],
      ["A.1b", new Map()],
    ]);
    let shortLists = 0;
    for (const show of q1Measured) {
      const { candidates } = candidateSet(show.showId, mentions, resolvedBrands);
      const length = q1RequestLength(candidates.length);
      if (length < 30) shortLists += 1;
      const shuffled = seededPermutation(candidates, EVAL_SEED).map((id) => ({ id, name: id }));
      for (const variant of ["A.1a", "A.1b"] as const) {
        const ranking = await rankCandidates(show, variant, shuffled, length, llm, llmPath, openai, () => {
          openaiNew += 1;
        });
        rankings.get(variant)?.set(show.showId, ranking);
      }
      note(`ranked ${rankings.get("A.1a")?.size ?? 0}/${q1Measured.length}`);
    }

    const promptMeans = (["A.1a", "A.1b"] as const).map((variant) => {
      const scored = runQ1(shows, mentions, devShows, showEntity, resolvedBrands, showAffinity, entityByNorm, baselineMem, rankings.get(variant) ?? new Map(), 1, 1);
      return { variant, ndcgAt10: meanMetric(scored.measured, "M2", "ndcgAt10") };
    });
    const prompt = selectPrompt(promptMeans);
    const grid: GridCell[] = [];
    const chosenRankings = rankings.get(prompt.variant) ?? new Map<string, string[]>();
    for (const alpha of ALPHA_GRID) {
      for (const lambda of LAMBDA_GRID) {
        const scored = runQ1(shows, mentions, devShows, showEntity, resolvedBrands, showAffinity, entityByNorm, baselineMem, chosenRankings, alpha, lambda);
        grid.push({ alpha, lambda, ndcgAt10: meanMetric(scored.measured, "M4", "ndcgAt10") });
      }
    }
    const chosen = selectAlphaLambda(grid);

    stage = "score-q2";
    saveProgress(null);
    const q2Shows: Q2ShowInput[] = [];
    let q2Skipped = 0;
    for (const show of devShows) {
      if (!showEntity.has(show.showId)) {
        q2Skipped += 1;
        continue;
      }
      const entityId = showEntity.get(show.showId);
      if (!entityId) throw new StopRun("fatal", "SHOW_ID_MISSING");
      const generated = await baselineList(show, llm, llmPath, openai, () => {
        openaiNew += 1;
      });
      const discovered = await discover(entityId, qloo, afterCall);
      for (const brand of discovered) remember(entityByNorm, brand.name, brand.id);
      const resolvedSuggestions: string[] = [];
      for (const brand of generated) {
        const id = await resolveBrand(brand.name, entityByNorm, qloo, afterCall);
        if (id) resolvedSuggestions.push(brand.name);
      }
      const table = showAffinity.get(show.showId) ?? new Map<string, number>();
      showAffinity.set(show.showId, table);
      const poolIds = poolEntityIds(discovered, generated.map((brand) => brand.name), laneA.names, entityByNorm);
      await scoreMissing(poolIds, [entityId], table, qloo, afterCall);
      await ensureBaseline(poolIds, basketIds, baselineMem, baselineStore, qloo, afterCall);
      const pool = poolRows(discovered, generated.map((brand) => brand.name), laneA.names, entityByNorm, table, baselineMem);
      const overindexTop = rankPoolByFit(pool, chosen.alpha, Q2_CUTOFF);
      const llmTop = generated.slice(0, Q2_CUTOFF).map((brand) => brand.name);
      const sponsors = sponsorsByShow.get(show.showId) ?? [];
      if (overindexTop.length === 0 || llmTop.length === 0 || sponsors.length === 0) {
        q2Skipped += 1;
        continue;
      }
      q2Shows.push({
        showId: show.showId,
        tier: show.tier,
        split: "dev",
        overindexTop,
        llmTop,
        sponsors,
        llmSuggestions: generated.map((brand) => brand.name),
        llmResolved: resolvedSuggestions,
      });
      note(`q2 ${q2Shows.length}/${devShows.length}`);
    }
    if (q2Shows.length < 2) throw new StopRun("fatal", "Q2_TOO_FEW");

    const chosenQ1 = runQ1(
      shows,
      mentions,
      devShows,
      showEntity,
      resolvedBrands,
      showAffinity,
      entityByNorm,
      baselineMem,
      chosenRankings,
      chosen.alpha,
      chosen.lambda,
    );
    assertDevOnly(chosenQ1.measured.map((row) => row.showId), devShows);
    const q2Metrics = scoreQ2Split(q2Shows, new Set(mostFrequentBrands(mentions)), "dev");
    assertDevOnly(q2Metrics.map((row) => row.showId), devShows);
    const q1Report = summarizeQ1(chosenQ1.measured, { synthetic: false, split: "dev", excluded: chosenQ1.excluded.length });
    const q2Report = summarizeQ2(q2Metrics, { synthetic: false, split: "dev" });
    const unscored = (pick: (row: (typeof chosenQ1.measured)[number]) => number) =>
      chosenQ1.measured.reduce((sum, row) => sum + pick(row), 0) / chosenQ1.measured.length;
    const directory = publishedResultsDir();
    const q1Path = writeAggregateReport(q1Report, directory);
    const q2Path = writeAggregateReport(q2Report, directory);
    const tuning = {
      split: "dev" as const,
      testSplitMeasured: false,
      finishedAt: wibStamp(new Date()),
      alpha: chosen.alpha,
      lambda: chosen.lambda,
      promptVariant: prompt.variant,
      promptTie: prompt.tie,
      promptNdcgAt10: { "A.1a": promptMeans[0]?.ndcgAt10 ?? 0, "A.1b": promptMeans[1]?.ndcgAt10 ?? 0 },
      baselineLift: "basket-8",
      baselineOptionsScored: 1,
      basketSignals: basketIds.length,
      quadrantThreshold: null,
      configurationLocked: false,
      grid,
      measuredQ1: chosenQ1.measured.length,
      excludedQ1: chosenQ1.excluded.length,
      measuredQ2: q2Metrics.length,
      q2Skipped,
      measuredQ1ShowIds: chosenQ1.measured.map((row) => row.showId).sort(),
      measuredQ2ShowIds: q2Metrics.map((row) => row.showId).sort(),
      showResolution: { attempted: devShows.length, resolved: showEntity.size, ...showFail },
      brandResolution: { attempted: brandNorms.length, resolved: brandsResolved },
      shortCandidateLists: shortLists,
      meanUnscoredM3: unscored((row) => row.unscoredM3),
      meanUnscoredM4: unscored((row) => row.unscoredM4),
      showMatch: "qloo-confident-and-name-accepts",
      publisherConfirmedByUser: false,
      qlooCalls: counts().qloo,
      openaiCalls: counts().openai,
      qlooCacheHitsThisProcess: cacheHits,
      tools,
    };
    const tuningPath = path.join(directory, "tuning.json");
    const published = [q1Path, q2Path, tuningPath];
    try {
      writeFileSync(tuningPath, `${JSON.stringify(tuning, null, 2)}\n`, "utf8");
      for (const file of published) assertPublishable(file);
    } catch (error) {
      for (const file of published) {
        try {
          unlinkSync(file);
        } catch {
          /* already absent */
        }
      }
      throw error;
    }
    stage = "complete";
    saveProgress(null);
    note("wrote results");
    process.stderr.write(`files q1 q2 tuning testMeasured=false\n`);
    return 0;
  } catch (error) {
    if (error instanceof StopRun) {
      saveProgress({ reason: error.kind === "quota" ? "quota" : "error", code: error.code, stage });
      process.stderr.write(`stopped ${error.kind} ${error.code} stage=${stage}\n`);
      return error.kind === "quota" ? 3 : 1;
    }
    saveProgress({ reason: "error", code: "RUN_FAILED", stage });
    process.stderr.write(`stopped fatal RUN_FAILED stage=${stage}\n`);
    return 1;
  } finally {
    await closeSharedMcpClient();
  }
}

function runQ1(
  shows: readonly ShowRecord[],
  mentions: ReturnType<typeof mentionsFromGroundTruth>,
  devShows: readonly ShowRecord[],
  showEntity: ReadonlyMap<string, string>,
  resolvedBrands: ReadonlySet<string>,
  showAffinity: ReadonlyMap<string, ReadonlyMap<string, number>>,
  entityByNorm: ReadonlyMap<string, string>,
  baselineMem: ReadonlyMap<string, number>,
  modelRanking: ReadonlyMap<string, readonly string[]>,
  alpha: number,
  lambda: number,
) {
  const devIds = new Set(devShows.map((show) => show.showId));
  const resolvedShows = new Set([...showEntity.keys()].filter((id) => devIds.has(id)));
  const affinityByShow = new Map<string, Map<string, number>>();
  const modelRankingByShow = new Map<string, readonly string[]>();
  const baselinePercentileByShow = new Map<string, Map<string, number>>();
  for (const showId of resolvedShows) {
    const { candidates, relevant } = candidateSet(showId, mentions, resolvedBrands);
    if (relevant.length === 0) continue;
    affinityByShow.set(showId, affinityTable(showId, candidates, showAffinity, entityByNorm));
    const ranking = modelRanking.get(showId);
    if (!ranking) throw new StopRun("fatal", "RANKING_MISSING");
    modelRankingByShow.set(showId, ranking);
    baselinePercentileByShow.set(showId, baselineTable(candidates, entityByNorm, baselineMem));
  }
  const signals: Q1Signals = {
    resolvedShows,
    resolvedBrands,
    affinityByShow,
    baselinePercentile: new Map(),
    baselinePercentileByShow,
    modelRankingByShow,
    alpha,
    lambda,
  };
  const scored = scoreQ1Split(shows, mentions, signals, "dev");
  if (scored.measured.length === 0) throw new StopRun("fatal", "Q1_EMPTY");
  if (scored.measured.some((row) => row.split !== "dev" || !devIds.has(row.showId))) {
    throw new StopRun("fatal", "TEST_SPLIT");
  }
  return scored;
}

function affinityTable(
  showId: string,
  candidates: readonly string[],
  showAffinity: ReadonlyMap<string, ReadonlyMap<string, number>>,
  entityByNorm: ReadonlyMap<string, string>,
): Map<string, number> {
  const table = showAffinity.get(showId) ?? new Map<string, number>();
  const out = new Map<string, number>();
  for (const brand of candidates) {
    const id = entityByNorm.get(normalizeBrandName(brand));
    const affinity = id ? table.get(id) : undefined;
    if (affinity !== undefined) out.set(brand, affinity);
  }
  return out;
}

function baselineTable(
  candidates: readonly string[],
  entityByNorm: ReadonlyMap<string, string>,
  baselineMem: ReadonlyMap<string, number>,
): Map<string, number> {
  const raw = new Map<string, number>();
  for (const brand of candidates) {
    const id = entityByNorm.get(normalizeBrandName(brand));
    const affinity = id ? baselineMem.get(id) : undefined;
    if (affinity !== undefined) raw.set(brand, affinity);
  }
  const sample = [...raw.values()];
  const out = new Map<string, number>();
  if (sample.length === 0) return out;
  for (const [brand, affinity] of raw) out.set(brand, percentile(affinity, sample));
  return out;
}

async function resolveShow(
  name: string,
  qloo: QlooGateway,
  afterCall: (data: Tracked) => void,
): Promise<{ id: string } | "notConfident" | "nameMismatch" | "empty" | "error"> {
  const described = await qloo.describe({ entity: name, type: "podcast" });
  afterCall(described.data);
  if (described.data.status === "error") return "error";
  const extracted = extractShowCandidates(described.data);
  if (extracted.candidates.length === 0) return "empty";
  if (!extracted.confident || extracted.candidates.length !== 1) return "notConfident";
  const candidate = extracted.candidates[0];
  if (!candidate || !nameAccepts(name, candidate.name)) return "nameMismatch";
  return { id: candidate.id };
}

async function resolveBrand(
  name: string,
  entityByNorm: Map<string, string>,
  qloo: QlooGateway,
  afterCall: (data: Tracked) => void,
): Promise<string | undefined> {
  const key = normalizeBrandName(name);
  if (!key) return undefined;
  const known = entityByNorm.get(key);
  if (known) return known;
  const described = await qloo.describe({ entity: name, type: "brand" });
  afterCall(described.data);
  if (described.data.status === "error") return undefined;
  const hit = selectBrand(described.data, name);
  if (!hit) return undefined;
  entityByNorm.set(key, hit.id);
  return hit.id;
}

function remember(entityByNorm: Map<string, string>, name: string, id: string): void {
  const key = normalizeBrandName(name);
  if (!key || entityByNorm.has(key)) return;
  entityByNorm.set(key, id);
}

async function scoreMissing(
  ids: readonly string[],
  signals: readonly string[],
  into: Map<string, number>,
  qloo: QlooGateway,
  afterCall: (data: Tracked) => void,
): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => !into.has(id));
  if (missing.length === 0 || signals.length === 0) return;
  for (let offset = 0; offset < missing.length; offset += SCORE_BATCH_SIZE) {
    const batch = missing.slice(offset, offset + SCORE_BATCH_SIZE);
    const called = await qloo.scoreCandidates({
      type: "brand",
      signalEntityIds: signals.slice(0, 10),
      candidateIds: batch,
      take: batch.length,
    });
    afterCall(called.data);
    if (called.data.status === "error") continue;
    for (const brand of readInsightBrands(called.data.entities)) {
      if (brand.affinity !== undefined) into.set(brand.id, brand.affinity);
    }
  }
}

async function ensureBaseline(
  ids: readonly string[],
  basketIds: readonly string[],
  baselineMem: Map<string, number>,
  store: FileBaselineStore,
  qloo: QlooGateway,
  afterCall: (data: Tracked) => void,
): Promise<void> {
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (baselineMem.has(id)) continue;
    const stored = await store.get(id);
    if (stored === undefined) missing.push(id);
    else baselineMem.set(id, stored);
  }
  await scoreMissing(missing, basketIds, baselineMem, qloo, afterCall);
  for (const id of missing) {
    const affinity = baselineMem.get(id);
    if (affinity !== undefined) await store.set(id, affinity);
  }
}

async function discover(
  showEntityId: string,
  qloo: QlooGateway,
  afterCall: (data: Tracked) => void,
): Promise<{ id: string; name: string }[]> {
  const found = new Map<string, { id: string; name: string }>();
  for (const band of POPULARITY_BANDS) {
    const params: Record<string, number> = { "filter.popularity.min": band.min };
    if ("max" in band) params["filter.popularity.max"] = band.max;
    const called = await qloo.insightsRaw({
      type: "brand",
      signalEntityIds: [showEntityId],
      take: DISCOVER_TAKE,
      params,
    });
    afterCall(called.data);
    if (called.data.status === "error") continue;
    for (const brand of readInsightBrands(called.data.entities).slice(0, DISCOVER_TAKE)) {
      if (!found.has(brand.id)) found.set(brand.id, { id: brand.id, name: brand.name });
    }
  }
  return [...found.values()];
}

function poolEntityIds(
  discovered: readonly { id: string }[],
  llmNames: readonly string[],
  laneNames: readonly string[],
  entityByNorm: ReadonlyMap<string, string>,
): string[] {
  const ids = new Set<string>(discovered.map((brand) => brand.id));
  for (const name of [...llmNames, ...laneNames]) {
    const id = entityByNorm.get(normalizeBrandName(name));
    if (id) ids.add(id);
  }
  return [...ids];
}

function poolRows(
  discovered: readonly { id: string; name: string }[],
  llmNames: readonly string[],
  laneNames: readonly string[],
  entityByNorm: ReadonlyMap<string, string>,
  showScores: ReadonlyMap<string, number>,
  baselineMem: ReadonlyMap<string, number>,
): { name: string; affinityShow?: number; affinityBase?: number }[] {
  const rows = new Map<string, { name: string; entityId?: string }>();
  const add = (name: string, entityId?: string) => {
    const key = normalizeBrandName(name);
    if (!key) return;
    const current = rows.get(key);
    if (!current) rows.set(key, { name, entityId });
    else if (!current.entityId && entityId) current.entityId = entityId;
  };
  for (const brand of discovered) add(brand.name, brand.id);
  for (const name of llmNames) add(name, entityByNorm.get(normalizeBrandName(name)));
  for (const name of laneNames) add(name, entityByNorm.get(normalizeBrandName(name)));
  return [...rows.values()].map((row) => {
    const affinityShow = row.entityId ? showScores.get(row.entityId) : undefined;
    const affinityBase = row.entityId ? baselineMem.get(row.entityId) : undefined;
    return {
      name: row.name,
      ...(affinityShow !== undefined ? { affinityShow } : {}),
      ...(affinityBase !== undefined ? { affinityBase } : {}),
    };
  });
}

async function rankCandidates(
  show: ShowRecord,
  variant: Q1PromptVariant,
  brands: { id: string; name: string }[],
  length: number,
  llm: LlmCacheFile,
  llmPath: string,
  openai: OpenAI,
  countCall: () => void,
): Promise<string[]> {
  const key = `${show.showId}|${variant}|${length}`;
  const cached = llm.rank[key];
  if (cached) return cached;
  const schema = z.object({ ranking: z.array(z.string().min(1)).length(length) });
  const parsed = await complete(openai, schema, "q1_ranking", q1Prompt(variant, show, brands, length), countCall);
  llm.rank[key] = parsed.ranking;
  saveLlm(llmPath, llm);
  return parsed.ranking;
}

async function baselineList(
  show: ShowRecord,
  llm: LlmCacheFile,
  llmPath: string,
  openai: OpenAI,
  countCall: () => void,
): Promise<{ name: string; category: string }[]> {
  const cached = llm.baseline[show.showId];
  if (cached && cached.length === 40) return cached;
  const parsed = await complete(
    openai,
    llmBaselineSchema,
    "llm_baseline",
    renderLlmBaselinePrompt({ showName: show.name, showDescription: show.description }),
    countCall,
  );
  llm.baseline[show.showId] = parsed.brands;
  saveLlm(llmPath, llm);
  return parsed.brands;
}

async function complete<T>(
  openai: OpenAI,
  schema: z.ZodType<T>,
  name: string,
  prompt: string,
  countCall: () => void,
): Promise<T> {
  let counted = false;
  try {
    const response = await openai.responses.parse({
      model: MODEL,
      reasoning: { effort: "medium" },
      input: prompt,
      text: { format: zodTextFormat(schema, name) },
    });
    countCall();
    counted = true;
    if (response.output_parsed == null) throw new StopRun("fatal", "OPENAI_EMPTY");
    return schema.parse(response.output_parsed);
  } catch (error) {
    if (error instanceof StopRun) throw error;
    if (!counted) countCall();
    if (isOpenAiQuota(error)) throw new StopRun("quota", "OPENAI_429");
    throw new StopRun("fatal", openAiCode(error));
  }
}

function q1Prompt(variant: Q1PromptVariant, show: ShowRecord, brands: { id: string; name: string }[], length: number): string {
  const text = renderQ1Prompt(variant, { showName: show.name, showDescription: show.description, brands });
  if (length === 30) return text;
  return text
    .replaceAll("Rank the 30 brands", `Rank the ${length} brands`)
    .replaceAll("select and rank the 30 brands", `select and rank the ${length} brands`)
    .replaceAll("exactly 30 unique IDs", `exactly ${length} unique IDs`);
}

function entityIds(brands: readonly string[], entityByNorm: ReadonlyMap<string, string>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const brand of brands) {
    const id = entityByNorm.get(normalizeBrandName(brand));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function assertDevOnly(ids: readonly string[], devShows: readonly ShowRecord[]): void {
  const devIds = new Set(devShows.map((show) => show.showId));
  if (ids.some((id) => !devIds.has(id))) throw new StopRun("fatal", "TEST_SPLIT");
}

function quotaCodeOf(data: Tracked): string | undefined {
  if (data.status !== "error") return undefined;
  const code = data.error?.code ?? "";
  if (code === "QLOO_RATE_LIMIT" || /429|quota|rate[_ -]?limit/i.test(code)) return code || "QLOO_RATE_LIMIT";
  return undefined;
}

function isOpenAiQuota(error: unknown): boolean {
  return openAiStatus(error) === 429 || openAiErrorCode(error) === "insufficient_quota";
}

function openAiCode(error: unknown): string {
  const status = openAiStatus(error);
  if (status === 429) return "OPENAI_429";
  const code = openAiErrorCode(error);
  if (code === "insufficient_quota") return "OPENAI_429";
  if (status !== undefined) return `OPENAI_${status}`;
  return "OPENAI_ERROR";
}

function openAiStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function openAiErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const nested = (error as { error?: { code?: unknown } }).error;
  if (nested && typeof nested === "object" && typeof nested.code === "string") return nested.code;
  return undefined;
}

function readProgress(file: string): z.infer<typeof progressSchema> | undefined {
  try {
    const parsed = progressSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function readLlm(file: string): LlmCacheFile {
  try {
    const parsed = llmCacheSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    /* A missing cache only means the calls have not been made. */
  }
  return { rank: {}, baseline: {} };
}

function saveLlm(file: string, cache: LlmCacheFile): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache), "utf8");
  renameSync(tmp, file);
}

function assertPublishable(file: string): void {
  const text = readFileSync(file, "utf8");
  if (/urn:entity|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) {
    throw new StopRun("fatal", "PUBLISH_LEAK");
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || !("split" in parsed) || (parsed as { split?: unknown }).split !== "dev") {
    throw new StopRun("fatal", "TEST_SPLIT");
  }
  walkFields(parsed);
}

function walkFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) walkFields(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (BANNED_FIELDS.has(key)) throw new StopRun("fatal", "PUBLISH_FIELD");
    walkFields(child);
  }
}

function wibStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${read("year")}-${read("month")}-${read("day")} ${read("hour")}:${read("minute")} WIB`;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    process.stderr.write("stopped fatal RUN_FAILED stage=preflight\n");
    process.exitCode = 1;
  });
