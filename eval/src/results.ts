import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapMeanCi, bootstrapPairedMeanCi, type BootstrapCi, type BootstrapOptions } from "./bootstrap";
import type { Q1ShowResult } from "./q1";
import type { Q2ShowMetrics } from "./q2";
import { METHOD_IDS, type MethodId, type Split, type Tier } from "./protocol";

const PUBLISHED_RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));

export type MetricSummary = BootstrapCi & { n: number };

export type MethodMetrics = Record<MethodId, { recallAt10: MetricSummary; ndcgAt10: MetricSummary }>;

export type PairedContrasts = {
  m3MinusM1: MetricSummary;
  m3MinusM2: MetricSummary;
  m4MinusM1: MetricSummary;
  m4MinusM2: MetricSummary;
};

export type Q1Aggregate = {
  synthetic: boolean;
  kind: "q1";
  split: Split;
  measured: number;
  excluded: number;
  methods: MethodMetrics;
  strata: Record<Tier, MethodMetrics | null>;
  paired: { recallAt10: PairedContrasts; ndcgAt10: PairedContrasts };
};

export type Q2Aggregate = {
  synthetic: boolean;
  kind: "q2";
  split: Split;
  measured: number;
  specificityOverindex: MetricSummary;
  specificityLlm: MetricSummary;
  genericOverindex: MetricSummary;
  genericLlm: MetricSummary;
  recallOverindex: MetricSummary;
  recallLlm: MetricSummary;
  hitOverindex: MetricSummary;
  hitLlm: MetricSummary;
  llmCoverage: MetricSummary;
};

type StoredAggregate = Q1Aggregate | Q2Aggregate;

/**
 * Show ids are sorted before resampling so the interval does not depend on input order.
 * The returned object stays in memory until a caller writes it.
 */
export function summarizeQ1(
  measured: readonly Q1ShowResult[],
  meta: { synthetic: boolean; split: Split; excluded: number },
  options: BootstrapOptions = {},
): Q1Aggregate {
  const ordered = [...measured].sort((left, right) => (left.showId < right.showId ? -1 : left.showId > right.showId ? 1 : 0));
  if (ordered.length === 0) throw new RangeError("summarizeQ1 needs at least one measured show");
  if (ordered.some((row) => row.split !== meta.split)) throw new Error("measured rows must belong to the summarized split");
  return {
    synthetic: meta.synthetic,
    kind: "q1",
    split: meta.split,
    measured: ordered.length,
    excluded: meta.excluded,
    methods: methodBlock(ordered, options),
    strata: {
      besar: stratumBlock(ordered, "besar", options),
      mid: stratumBlock(ordered, "mid", options),
    },
    paired: {
      recallAt10: pairedBlock(ordered, "recallAt10", options),
      ndcgAt10: pairedBlock(ordered, "ndcgAt10", options),
    },
  };
}

export function summarizeQ2(
  measured: readonly Q2ShowMetrics[],
  meta: { synthetic: boolean; split: Split },
  options: BootstrapOptions = {},
): Q2Aggregate {
  const ordered = [...measured].sort((left, right) => (left.showId < right.showId ? -1 : left.showId > right.showId ? 1 : 0));
  if (ordered.length === 0) throw new RangeError("summarizeQ2 needs at least one measured show");
  const column = (key: keyof Omit<Q2ShowMetrics, "showId" | "tier">) =>
    summary(ordered.map((row) => row[key]), options);
  return {
    synthetic: meta.synthetic,
    kind: "q2",
    split: meta.split,
    measured: ordered.length,
    specificityOverindex: column("specificityOverindex"),
    specificityLlm: column("specificityLlm"),
    genericOverindex: column("genericOverindex"),
    genericLlm: column("genericLlm"),
    recallOverindex: column("recallOverindex"),
    recallLlm: column("recallLlm"),
    hitOverindex: column("hitOverindex"),
    hitLlm: column("hitLlm"),
    llmCoverage: column("llmCoverage"),
  };
}

/**
 * Writes one JSON file. Synthetic reports are refused when the directory is `eval/results`,
 * so a unit test cannot publish stand-in scores.
 */
export function writeAggregateReport(report: StoredAggregate, directory: string): string {
  if (report.synthetic && isInsidePublishedResults(directory)) {
    throw new Error("Synthetic aggregate scores cannot be written to eval/results");
  }
  mkdirSync(directory, { recursive: true });
  const fileName = report.synthetic ? `synthetic-${report.kind}.json` : `${report.kind}.json`;
  const filePath = path.join(directory, fileName);
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return filePath;
}

export function publishedResultsDir(): string {
  return PUBLISHED_RESULTS_DIR;
}

export type Q2Paired = {
  specificityOverindexMinusLlm: MetricSummary;
  recallOverindexMinusLlm: MetricSummary;
};

/** Paired mean of L-OI − L-LLM on the rows given, in show-id order. */
export function q2Paired(rows: readonly Q2ShowMetrics[], options: BootstrapOptions = {}): Q2Paired {
  const ordered = [...rows].sort((left, right) => (left.showId < right.showId ? -1 : left.showId > right.showId ? 1 : 0));
  if (ordered.length === 0) throw new RangeError("q2Paired needs at least one measured show");
  const contrast = (left: readonly number[], right: readonly number[]) =>
    withCount(bootstrapPairedMeanCi(left, right, options), ordered.length);
  return {
    specificityOverindexMinusLlm: contrast(
      ordered.map((row) => row.specificityOverindex),
      ordered.map((row) => row.specificityLlm),
    ),
    recallOverindexMinusLlm: contrast(
      ordered.map((row) => row.recallOverindex),
      ordered.map((row) => row.recallLlm),
    ),
  };
}

const DEV_RESULT_FILES = new Set(["q1.json", "q2.json", "tuning.json"]);

/**
 * Writes a test-split aggregate under a name that is not a dev result file.
 * `q1.json`, `q2.json`, and `tuning.json` are refused so a test run cannot replace them.
 */
export function writeTestAggregate<T extends { synthetic: boolean; split: Split }>(
  report: T,
  directory: string,
  fileName: string,
): string {
  if (report.synthetic && isInsidePublishedResults(directory)) {
    throw new Error("Synthetic aggregate scores cannot be written to eval/results");
  }
  if (report.split !== "test") throw new Error("writeTestAggregate only writes the test split");
  if (fileName !== path.basename(fileName) || DEV_RESULT_FILES.has(fileName)) {
    throw new Error("dev result files stay untouched");
  }
  if (!/^q[12]-test\.json$|^test-run\.json$/.test(fileName)) {
    throw new Error("test aggregate file name is not allowed");
  }
  mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, fileName);
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return filePath;
}

function methodBlock(rows: readonly Q1ShowResult[], options: BootstrapOptions): MethodMetrics {
  const block = {} as MethodMetrics;
  for (const method of METHOD_IDS) {
    block[method] = {
      recallAt10: summary(rows.map((row) => row.metrics[method].recallAt10), options),
      ndcgAt10: summary(rows.map((row) => row.metrics[method].ndcgAt10), options),
    };
  }
  return block;
}

function stratumBlock(rows: readonly Q1ShowResult[], tier: Tier, options: BootstrapOptions): MethodMetrics | null {
  const selected = rows.filter((row) => row.tier === tier);
  if (selected.length === 0) return null;
  return methodBlock(selected, options);
}

function pairedBlock(
  rows: readonly Q1ShowResult[],
  metric: "recallAt10" | "ndcgAt10",
  options: BootstrapOptions,
): PairedContrasts {
  const series = (method: MethodId) => rows.map((row) => row.metrics[method][metric]);
  const contrast = (left: MethodId, right: MethodId) =>
    withCount(bootstrapPairedMeanCi(series(left), series(right), options), rows.length);
  return {
    m3MinusM1: contrast("M3", "M1"),
    m3MinusM2: contrast("M3", "M2"),
    m4MinusM1: contrast("M4", "M1"),
    m4MinusM2: contrast("M4", "M2"),
  };
}

function summary(values: readonly number[], options: BootstrapOptions): MetricSummary {
  return withCount(bootstrapMeanCi(values, options), values.length);
}

function withCount(ci: BootstrapCi, n: number): MetricSummary {
  return { ...ci, n };
}

function isInsidePublishedResults(directory: string): boolean {
  const target = path.resolve(directory);
  const published = path.resolve(PUBLISHED_RESULTS_DIR);
  const relative = path.relative(published, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
