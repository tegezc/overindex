import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
import { candidateSet, scoreQ1Split, type Q1ShowResult, type Q1Signals } from "../eval/src/q1";
import { llmBrandsOutsideLaneA, mostFrequentBrands, scoreQ2Split, type Q2ShowInput, type Q2ShowMetrics } from "../eval/src/q2";
import { EVAL_SEED, Q2_CUTOFF, type Tier } from "../eval/src/protocol";
import { renderQ1Prompt } from "../eval/src/prompts";
import { seededPermutation } from "../eval/src/rng";
import {
  publishedResultsDir,
  q2Paired,
  summarizeQ1,
  summarizeQ2,
  writeTestAggregate,
  type Q1Aggregate,
  type Q2Aggregate,
  type Q2Paired,
} from "../eval/src/results";
import { splitMismatches } from "../eval/src/split";
import { q1RequestLength, rankPoolByFit } from "../eval/src/tune";

/** Locked in eval-protocol.md §10. These are not the product constants in scoring.ts. */
const LOCKED_ALPHA = 1;
const LOCKED_LAMBDA = 0;
const LOCKED_PROMPT = "A.1a" as const;
const LOCKED_BASELINE = "basket-8";

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
  resolvedShowIds: z.array(z.string()).optional(),
  q1ScoredShowIds: z.array(z.string()).optional(),
  q1RankedShowIds: z.array(z.string()).optional(),
  q2MeasuredShowIds: z.array(z.string()).optional(),
  stopped: z
    .object({
      reason: z.enum(["quota", "error"]),
      code: z.string(),
      stage: z.string(),
    })
    .nullable(),
});

type StopNote = { reason: "quota" | "error"; code: string; stage: string };

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    process.stderr.write("eval:test takes no arguments and measures the test split only\n");
    return 2;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    process.stderr.write("OPENAI_API_KEY is not set in this process. This script does not read key files and does not print the key.\n");
    return 2;
  }
  if (process.env.USE_FAKE_QLOO === "true") {
    process.stderr.write("eval:test refuses USE_FAKE_QLOO\n");
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
  const directory = publishedResultsDir();
  const tuningPath = path.join(directory, "tuning.json");
  const tuningRaw = readFileSync(tuningPath, "utf8");
  if (!lockedConfigMatches(tuningRaw)) {
    process.stderr.write("locked configuration does not match the values fixed before this run\n");
    return 2;
  }
  const privateDir = path.join(cacheDir, "eval-test");
  const progressPath = path.join(privateDir, "progress.json");
  const llmPath = path.join(privateDir, "llm.json");
  const prior = readProgress(progressPath);
  const existingRun = readJson(path.join(directory, "test-run.json"));
  if (prior?.stopped?.reason === "quota" || stoppedReason(existingRun) === "quota") {
    const code = prior?.stopped?.code ?? stringField(existingRun, "code") ?? "QUOTA";
    const stage = prior?.stopped?.stage ?? stringField(existingRun, "stage") ?? "unknown";
    process.stderr.write(`stopped quota ${code} stage=${stage} already recorded\n`);
    return 3;
  }
  if (existingRun && boolField(existingRun, "finished") === true) {
    process.stderr.write("test split was already measured\n");
    return 2;
  }
  for (const stale of ["q1-test.json", "q2-test.json"]) {
    const stalePath = path.join(directory, stale);
    if (existsSync(stalePath)) unlinkSync(stalePath);
  }

  const shows = loadShowsCsv(path.join(process.cwd(), "eval/dataset/shows.csv"));
  const groundTruth = loadGroundTruthCsv(path.join(process.cwd(), "eval/dataset/ground_truth.csv"));
  const laneA = loadLaneACatalog(path.join(process.cwd(), "eval/dataset/lane_a_buyers.csv"));
  if (splitMismatches(shows).length > 0) {
    process.stderr.write("stored split does not match the frozen rule\n");
    return 2;
  }
  const testShows = shows.filter((show) => show.split === "test");
  const devCount = shows.length - testShows.length;
  if (testShows.length !== 20 || devCount !== 10) {
    process.stderr.write("unexpected split sizes\n");
    return 2;
  }
  if (testShows.some((show) => show.split !== "test")) return 2;

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
  const completed = {
    resolvedShowIds: [...(prior?.resolvedShowIds ?? [])],
    q1ScoredShowIds: [...(prior?.q1ScoredShowIds ?? [])],
    q1RankedShowIds: [...(prior?.q1RankedShowIds ?? [])],
    q2MeasuredShowIds: [...(prior?.q2MeasuredShowIds ?? [])],
  };
  const firstFailure: StopNote | null =
    prior?.stopped?.reason === "error"
      ? prior.stopped
      : stoppedReason(existingRun) === "error"
        ? {
            reason: "error",
            code: stringField(existingRun, "code") ?? "RUN_FAILED",
            stage: stringField(existingRun, "stage") ?? "unknown",
          }
        : null;

  const counts = () => ({ qloo: baseQloo + budget.used, openai: baseOpenai + openaiNew });
  const saveProgress = (stopped: StopNote | null) => {
    mkdirSync(privateDir, { recursive: true });
    const body = {
      stage,
      testShows: testShows.length,
      devShowsNotMeasured: devCount,
      showsResolved: showEntity.size,
      brandsTotal: brandNorms.length,
      brandsResolved,
      qlooCalls: counts().qloo,
      openaiCalls: counts().openai,
      qlooCacheHitsThisProcess: cacheHits,
      tools,
      ...completed,
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
  const rememberShow = (bucket: string[], showId: string) => {
    if (!bucket.includes(showId)) bucket.push(showId);
  };

  try {
    stage = "resolve-shows";
    saveProgress(null);
    note(`testShows=${testShows.length} alpha=${LOCKED_ALPHA} lambda=${LOCKED_LAMBDA} prompt=${LOCKED_PROMPT} baseline=${LOCKED_BASELINE} quadrant=null`);
    for (const show of testShows) {
      const resolved = await resolveShow(show.name, qloo, afterCall);
      if (typeof resolved === "string") showFail[resolved] += 1;
      else {
        showEntity.set(show.showId, resolved.id);
        rememberShow(completed.resolvedShowIds, show.showId);
      }
      note(`shows ${showEntity.size}/${testShows.length}`);
    }

    stage = "resolve-brands";
    saveProgress(null);
    let attempted = 0;
    for (const brandNorm of brandNorms) {
      attempted += 1;
      const id = await resolveBrand(brandNorm, entityByNorm, qloo, afterCall);
      if (id) brandsResolved += 1;
      if (attempted % 25 === 0 || attempted === brandNorms.length) note(`brands ${attempted}/${brandNorms.length}`);
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
    if (BASELINE_BASKET.length !== 8) throw new StopRun("fatal", "BASKET_SHAPE");

    const resolvedBrands = new Set(brandNorms.filter((brand) => entityByNorm.has(normalizeBrandName(brand))));
    const q1Measured = testShows.filter((show) => {
      if (!showEntity.has(show.showId)) return false;
      return candidateSet(show.showId, mentions, resolvedBrands).relevant.length > 0;
    });

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
      rememberShow(completed.q1ScoredShowIds, show.showId);
      note(`scored ${completed.q1ScoredShowIds.length}/${q1Measured.length}`);
    }

    stage = "rank-m2";
    saveProgress(null);
    const rankings = new Map<string, string[]>();
    let shortLists = 0;
    for (const show of q1Measured) {
      const { candidates } = candidateSet(show.showId, mentions, resolvedBrands);
      const length = q1RequestLength(candidates.length);
      if (length < 30) shortLists += 1;
      const shuffled = seededPermutation(candidates, EVAL_SEED).map((id) => ({ id, name: id }));
      const ranking = await rankCandidates(show, shuffled, length, llm, llmPath, openai, () => {
        openaiNew += 1;
      });
      rankings.set(show.showId, ranking);
      rememberShow(completed.q1RankedShowIds, show.showId);
      note(`ranked ${rankings.size}/${q1Measured.length}`);
    }

    stage = "score-q2";
    saveProgress(null);
    const q2Shows: Q2ShowInput[] = [];
    const secondaryShows: Q2ShowInput[] = [];
    let q2Skipped = 0;
    let secondarySkipped = 0;
    for (const show of testShows) {
      if (!showEntity.has(show.showId)) {
        q2Skipped += 1;
        secondarySkipped += 1;
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
      const overindexTop = rankPoolByFit(pool, LOCKED_ALPHA, Q2_CUTOFF);
      const llmTop = generated.slice(0, Q2_CUTOFF).map((brand) => brand.name);
      const sponsors = sponsorsByShow.get(show.showId) ?? [];
      const laneBPool = pool.filter((row) => !laneA.normalized.has(normalizeBrandName(row.name)));
      const overindexLaneB = rankPoolByFit(laneBPool, LOCKED_ALPHA, Q2_CUTOFF);
      const llmLaneB = llmBrandsOutsideLaneA(
        generated.map((brand) => brand.name),
        laneA.normalized,
        Q2_CUTOFF,
      );
      if (overindexTop.length === 0 || llmTop.length === 0 || sponsors.length === 0) {
        q2Skipped += 1;
        secondarySkipped += 1;
        continue;
      }
      const base = {
        showId: show.showId,
        tier: show.tier,
        split: "test" as const,
        sponsors,
        llmSuggestions: generated.map((brand) => brand.name),
        llmResolved: resolvedSuggestions,
      };
      q2Shows.push({ ...base, overindexTop, llmTop });
      if (overindexLaneB.length === 0 || llmLaneB.length === 0) secondarySkipped += 1;
      else secondaryShows.push({ ...base, overindexTop: overindexLaneB, llmTop: llmLaneB });
      rememberShow(completed.q2MeasuredShowIds, show.showId);
      note(`q2 ${q2Shows.length}/${testShows.length}`);
    }

    const chosenQ1 =
      q1Measured.length === 0
        ? { measured: [] as Q1ShowResult[], excluded: testShows.map((show) => ({ showId: show.showId, reason: showEntity.has(show.showId) ? "empty_relevance" as const : "show_unresolved" as const })) }
        : runQ1(shows, mentions, testShows, showEntity, resolvedBrands, showAffinity, entityByNorm, baselineMem, rankings);
    assertTestOnly(chosenQ1.measured.map((row) => row.showId), testShows);
    const frequent = new Set(mostFrequentBrands(mentions));
    const q2Metrics = q2Shows.length >= 2 ? scoreQ2Split(q2Shows, frequent, "test") : [];
    const secondaryMetrics = secondaryShows.length >= 2 ? scoreQ2Split(secondaryShows, frequent, "test") : [];
    assertTestOnly(q2Metrics.map((row) => row.showId), testShows);
    assertTestOnly(secondaryMetrics.map((row) => row.showId), testShows);
    if (readFileSync(tuningPath, "utf8") !== tuningRaw) throw new StopRun("fatal", "TUNING_CHANGED");

    const unscored = (pick: (row: Q1ShowResult) => number) =>
      chosenQ1.measured.length === 0 ? 0 : chosenQ1.measured.reduce((sum, row) => sum + pick(row), 0) / chosenQ1.measured.length;
    const exclusionCounts = { show_unresolved: 0, empty_relevance: 0 };
    for (const row of chosenQ1.excluded) exclusionCounts[row.reason] += 1;
    const q1Report = q1File(chosenQ1.measured, chosenQ1.excluded.length);
    const q2Report = q2File(q2Metrics, secondaryMetrics, q2Shows.length, secondaryShows.length, secondarySkipped);
    const runReport = {
      synthetic: false as const,
      kind: "test-run" as const,
      split: "test" as const,
      finished: true,
      finishedAt: wibStamp(new Date()),
      locked: {
        alpha: LOCKED_ALPHA,
        lambda: LOCKED_LAMBDA,
        promptVariant: LOCKED_PROMPT,
        baselineLift: LOCKED_BASELINE,
        quadrantThreshold: null,
      },
      repeatedBecause: firstFailure,
      measuredQ1: chosenQ1.measured.length,
      excludedQ1: chosenQ1.excluded.length,
      exclusionCounts,
      measuredQ2: q2Metrics.length,
      q2Collected: q2Shows.length,
      q2Skipped,
      secondaryMeasured: secondaryMetrics.length,
      secondaryCollected: secondaryShows.length,
      secondarySkipped,
      measuredQ1ShowIds: chosenQ1.measured.map((row) => row.showId).sort(),
      measuredQ2ShowIds: q2Metrics.map((row) => row.showId).sort(),
      ...completed,
      showResolution: { attempted: testShows.length, resolved: showEntity.size, ...showFail },
      brandResolution: { attempted: brandNorms.length, resolved: brandsResolved },
      shortCandidateLists: shortLists,
      meanUnscoredM3: unscored((row) => row.unscoredM3),
      meanUnscoredM4: unscored((row) => row.unscoredM4),
      showMatch: "qloo-confident-and-name-accepts",
      publisherConfirmedByUser: false,
      basketSignals: basketIds.length,
      qlooCalls: counts().qloo,
      openaiCalls: counts().openai,
      qlooCacheHitsThisProcess: cacheHits,
      tools,
      stopped: null,
    };
    const published = [
      writeTestAggregate(q1Report, directory, "q1-test.json"),
      writeTestAggregate(q2Report, directory, "q2-test.json"),
      writeTestAggregate(runReport, directory, "test-run.json"),
    ];
    try {
      if (readFileSync(tuningPath, "utf8") !== tuningRaw) throw new StopRun("fatal", "TUNING_CHANGED");
      for (const file of published) assertPublishable(file);
      for (const tool of Object.keys(tools)) {
        if (tool.toLowerCase().includes("rank")) throw new StopRun("fatal", "QLOO_RANK");
      }
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
    process.stderr.write(
      `files q1-test q2-test test-run measuredQ1=${chosenQ1.measured.length} measuredQ2=${q2Metrics.length} qloo=${counts().qloo} openai=${counts().openai}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof StopRun) {
      const stopped = { reason: error.kind === "quota" ? "quota" as const : "error" as const, code: error.code, stage };
      saveProgress(stopped);
      writeStopped(directory, stopped, counts(), tools, completed, firstFailure, testShows.length);
      process.stderr.write(`stopped ${error.kind} ${error.code} stage=${stage}\n`);
      return error.kind === "quota" ? 3 : 1;
    }
    const stopped = { reason: "error" as const, code: "RUN_FAILED", stage };
    saveProgress(stopped);
    writeStopped(directory, stopped, counts(), tools, completed, firstFailure, testShows.length);
    process.stderr.write(`stopped fatal RUN_FAILED stage=${stage}\n`);
    return 1;
  } finally {
    await closeSharedMcpClient();
  }
}

function q1File(measured: readonly Q1ShowResult[], excluded: number): Q1Aggregate | EmptyQ1 {
  if (measured.length === 0) {
    return {
      synthetic: false,
      kind: "q1",
      split: "test",
      measured: 0,
      excluded,
      methods: null,
      strata: { besar: null, mid: null },
      paired: null,
    };
  }
  return summarizeQ1(measured, { synthetic: false, split: "test", excluded });
}

type EmptyQ1 = {
  synthetic: false;
  kind: "q1";
  split: "test";
  measured: 0;
  excluded: number;
  methods: null;
  strata: { besar: null; mid: null };
  paired: null;
};

function q2File(
  main: readonly Q2ShowMetrics[],
  secondary: readonly Q2ShowMetrics[],
  collected: number,
  secondaryCollected: number,
  secondarySkipped: number,
) {
  if (main.length < 2) {
    return {
      synthetic: false as const,
      kind: "q2" as const,
      split: "test" as const,
      measured: main.length,
      collected,
      metrics: null,
      strata: { besar: null, mid: null },
      paired: null,
      pairedStrata: { besar: null, mid: null },
      secondary: secondaryBlock(secondary, secondaryCollected, secondarySkipped),
    };
  }
  const summary = summarizeQ2(main, { synthetic: false, split: "test" });
  return {
    ...summary,
    collected,
    strata: {
      besar: stratumQ2(main, "besar"),
      mid: stratumQ2(main, "mid"),
    },
    paired: q2Paired(main),
    pairedStrata: {
      besar: stratumPaired(main, "besar"),
      mid: stratumPaired(main, "mid"),
    },
    secondary: secondaryBlock(secondary, secondaryCollected, secondarySkipped),
  };
}

function secondaryBlock(rows: readonly Q2ShowMetrics[], collected: number, skipped: number): Record<string, unknown> {
  if (rows.length < 2) return { measured: rows.length, collected, skipped, metrics: null };
  const summary = summarizeQ2(rows, { synthetic: false, split: "test" });
  return {
    measured: summary.measured,
    collected,
    skipped,
    specificityOverindex: summary.specificityOverindex,
    specificityLlm: summary.specificityLlm,
    recallOverindex: summary.recallOverindex,
    recallLlm: summary.recallLlm,
    hitOverindex: summary.hitOverindex,
    hitLlm: summary.hitLlm,
    strata: {
      besar: stratumSecondary(rows, "besar"),
      mid: stratumSecondary(rows, "mid"),
    },
    paired: q2Paired(rows),
    pairedStrata: {
      besar: stratumPaired(rows, "besar"),
      mid: stratumPaired(rows, "mid"),
    },
  };
}

function stratumQ2(rows: readonly Q2ShowMetrics[], tier: Tier): Q2Aggregate | null {
  const selected = rows.filter((row) => row.tier === tier);
  if (selected.length === 0) return null;
  return summarizeQ2(selected, { synthetic: false, split: "test" });
}

function stratumSecondary(rows: readonly Q2ShowMetrics[], tier: Tier): Record<string, unknown> | null {
  const selected = rows.filter((row) => row.tier === tier);
  if (selected.length === 0) return null;
  const summary = summarizeQ2(selected, { synthetic: false, split: "test" });
  return {
    measured: summary.measured,
    specificityOverindex: summary.specificityOverindex,
    specificityLlm: summary.specificityLlm,
    recallOverindex: summary.recallOverindex,
    recallLlm: summary.recallLlm,
    hitOverindex: summary.hitOverindex,
    hitLlm: summary.hitLlm,
  };
}

function stratumPaired(rows: readonly Q2ShowMetrics[], tier: Tier): Q2Paired | null {
  const selected = rows.filter((row) => row.tier === tier);
  if (selected.length === 0) return null;
  return q2Paired(selected);
}

function writeStopped(
  directory: string,
  stopped: StopNote,
  counts: { qloo: number; openai: number },
  tools: Record<string, number>,
  completed: {
    resolvedShowIds: string[];
    q1ScoredShowIds: string[];
    q1RankedShowIds: string[];
    q2MeasuredShowIds: string[];
  },
  firstFailure: StopNote | null,
  testShows: number,
): void {
  const body = {
    synthetic: false as const,
    kind: "test-run" as const,
    split: "test" as const,
    finished: false,
    finishedAt: null,
    locked: {
      alpha: LOCKED_ALPHA,
      lambda: LOCKED_LAMBDA,
      promptVariant: LOCKED_PROMPT,
      baselineLift: LOCKED_BASELINE,
      quadrantThreshold: null,
    },
    repeatedBecause: firstFailure,
    testShows,
    ...completed,
    qlooCalls: counts.qloo,
    openaiCalls: counts.openai,
    tools,
    stopped,
  };
  const file = writeTestAggregate(body, directory, "test-run.json");
  assertPublishable(file);
}

function lockedConfigMatches(raw: string): boolean {
  const parsed = JSON.parse(raw) as {
    alpha?: unknown;
    lambda?: unknown;
    promptVariant?: unknown;
    baselineLift?: unknown;
    quadrantThreshold?: unknown;
    configurationLocked?: unknown;
    split?: unknown;
  };
  return (
    parsed.split === "dev" &&
    parsed.alpha === LOCKED_ALPHA &&
    parsed.lambda === LOCKED_LAMBDA &&
    parsed.promptVariant === LOCKED_PROMPT &&
    parsed.baselineLift === LOCKED_BASELINE &&
    parsed.quadrantThreshold === null &&
    parsed.configurationLocked === true
  );
}

function runQ1(
  shows: readonly ShowRecord[],
  mentions: ReturnType<typeof mentionsFromGroundTruth>,
  testShows: readonly ShowRecord[],
  showEntity: ReadonlyMap<string, string>,
  resolvedBrands: ReadonlySet<string>,
  showAffinity: ReadonlyMap<string, ReadonlyMap<string, number>>,
  entityByNorm: ReadonlyMap<string, string>,
  baselineMem: ReadonlyMap<string, number>,
  modelRanking: ReadonlyMap<string, readonly string[]>,
) {
  const testIds = new Set(testShows.map((show) => show.showId));
  const resolvedShows = new Set([...showEntity.keys()].filter((id) => testIds.has(id)));
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
    alpha: LOCKED_ALPHA,
    lambda: LOCKED_LAMBDA,
  };
  const scored = scoreQ1Split(shows, mentions, signals, "test", { allowTestSplit: true });
  if (scored.measured.some((row) => row.split !== "test" || !testIds.has(row.showId))) {
    throw new StopRun("fatal", "DEV_SPLIT");
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
  brands: { id: string; name: string }[],
  length: number,
  llm: LlmCacheFile,
  llmPath: string,
  openai: OpenAI,
  countCall: () => void,
): Promise<string[]> {
  const key = `${show.showId}|${LOCKED_PROMPT}|${length}`;
  const cached = llm.rank[key];
  if (cached && cached.length === length) return cached;
  const schema = z.object({ ranking: z.array(z.string().min(1)).length(length) });
  const parsed = await complete(openai, schema, "q1_ranking", q1Prompt(show, brands, length), countCall);
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

function q1Prompt(show: ShowRecord, brands: { id: string; name: string }[], length: number): string {
  const text = renderQ1Prompt(LOCKED_PROMPT, { showName: show.name, showDescription: show.description, brands });
  if (length === 30) return text;
  return text.replaceAll("Rank the 30 brands", `Rank the ${length} brands`).replaceAll("exactly 30 unique IDs", `exactly ${length} unique IDs`);
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

function assertTestOnly(ids: readonly string[], testShows: readonly ShowRecord[]): void {
  const testIds = new Set(testShows.map((show) => show.showId));
  if (ids.some((id) => !testIds.has(id))) throw new StopRun("fatal", "DEV_SPLIT");
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

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function stoppedReason(value: unknown): "quota" | "error" | undefined {
  if (!value || typeof value !== "object" || !("stopped" in value)) return undefined;
  const stopped = (value as { stopped?: unknown }).stopped;
  if (!stopped || typeof stopped !== "object" || !("reason" in stopped)) return undefined;
  const reason = (stopped as { reason?: unknown }).reason;
  return reason === "quota" || reason === "error" ? reason : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const stopped = (value as { stopped?: unknown }).stopped;
  if (!stopped || typeof stopped !== "object" || !(key in stopped)) return undefined;
  const field = (stopped as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function boolField(value: unknown, key: string): boolean | undefined {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "boolean" ? field : undefined;
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
  if (!parsed || typeof parsed !== "object" || !("split" in parsed) || (parsed as { split?: unknown }).split !== "test") {
    throw new StopRun("fatal", "DEV_SPLIT");
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
