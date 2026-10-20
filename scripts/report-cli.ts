import path from "node:path";
import { getEnv, EnvError } from "../src/shared/config/env";
import { FileQlooCache } from "../src/shared/cache/file-cache";
import { LlmGateway } from "../src/shared/llm/application/llm-gateway";
import { FakeLlm } from "../src/shared/llm/infrastructure/fake-llm";
import { createOpenAiLlmFromEnv } from "../src/shared/llm/infrastructure/openai-llm";
import { BudgetCounter } from "../src/shared/qloo/application/budget";
import { QlooGateway } from "../src/shared/qloo/application/qloo-gateway";
import { FakeQloo } from "../src/shared/qloo/infrastructure/fake-qloo";
import { HarnessQloo } from "../src/shared/qloo/infrastructure/harness-qloo";
import { closeSharedMcpClient, getSharedMcpClient } from "../src/shared/qloo/infrastructure/mcp-qloo-client";
import { QlooApiRunner } from "../src/shared/qloo/infrastructure/qloo-api-runner";
import { MemoryTraceSink } from "../src/shared/trace/trace";
import { runSponsorDiscovery } from "../src/features/sponsor-discovery/application/run-sponsor-discovery";
import { FileBaselineStore } from "../src/features/sponsor-discovery/infrastructure/baseline-store";
import { loadLaneACatalog } from "../src/features/sponsor-discovery/infrastructure/lane-a-file";
import type { BrandCandidate } from "../src/features/sponsor-discovery/domain/types";

type Flags = {
  show: string;
  sponsors: string[];
  exclude: string[];
};

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags) {
    process.stderr.write('usage: npm run report:cli -- "<show>" [--sponsors "A,B"] [--exclude "gambling"]\n');
    return 2;
  }
  let env;
  try {
    env = getEnv();
  } catch (error) {
    const message = error instanceof EnvError ? error.message : "Invalid environment";
    process.stderr.write(`${message}\n`);
    return 2;
  }

  const trace = new MemoryTraceSink();
  const budget = new BudgetCounter(env.QLOO_BUDGET_TARGET, env.QLOO_BUDGET_CAP);
  const qloo = new QlooGateway(env.USE_FAKE_QLOO ? new FakeQloo() : new HarnessQloo(getSharedMcpClient(), new QlooApiRunner()), {
    budget,
    trace,
    cache: new FileQlooCache(env.CACHE_DIR),
  });
  const llm = new LlmGateway(env.USE_FAKE_QLOO ? new FakeLlm() : createOpenAiLlmFromEnv(env));
  try {
    const laneA = loadLaneACatalog(path.join(process.cwd(), "eval/dataset/lane_a_buyers.csv"));
    const result = await runSponsorDiscovery(
      { showQuery: flags.show, currentSponsors: flags.sponsors, excludedCategories: flags.exclude },
      {
        describe: (input) => qloo.describe(input),
        insightsRaw: (input) => qloo.insightsRaw(input),
        scoreCandidates: (input) => qloo.scoreCandidates(input),
        llmBaseline: (input) => llm.llmBaseline(input),
        disambiguate: (input) => llm.disambiguateShow(input),
        trace,
        budget,
        laneA,
        baselineStore: new FileBaselineStore(env.CACHE_DIR),
      },
    );
    process.stdout.write(`${table(result.candidates)}\n`);
    process.stderr.write(summary(result.status, result.counts, result.showCandidates, result.errorCode));
    for (const event of trace.events()) {
      if (event.kind === "tool_call") continue;
      process.stderr.write(`${event.seq} ${event.kind} ${event.tool ?? "-"} ${event.status ?? "-"} ${event.summary}\n`);
    }
    if (result.candidates.length === 0 || result.counts.qlooCalls > env.QLOO_BUDGET_CAP) return 1;
    return 0;
  } finally {
    if (!env.USE_FAKE_QLOO) await closeSharedMcpClient();
  }
}

function parseArgs(argv: string[]): Flags | undefined {
  const show = argv[0];
  if (!show || show.startsWith("--")) return undefined;
  const sponsors: string[] = [];
  const exclude: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === "--sponsors" || flag === "--exclude") && value && !value.startsWith("--")) {
      const items = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (flag === "--sponsors") sponsors.push(...items);
      else exclude.push(...items);
      index += 1;
      continue;
    }
    return undefined;
  }
  return { show, sponsors, exclude };
}

function table(candidates: readonly BrandCandidate[]): string {
  const lines = ["name\tlane\tquadrant\trenewal\treach\tfit"];
  for (const candidate of candidates) {
    const name = candidate.brand.name.replace(/[\t\r\n]+/g, " ");
    const fit = candidate.fit === undefined ? "" : candidate.fit.toFixed(3);
    lines.push(
      [name, candidate.lane, candidate.quadrant, candidate.flags.renewal ? "yes" : "no", candidate.reachBand ?? "", fit].join(
        "\t",
      ),
    );
  }
  return lines.join("\n");
}

function summary(
  status: string,
  counts: {
    candidates: number;
    laneA: number;
    laneB: number;
    proven: number;
    hidden: number;
    categoryOnly: number;
    none: number;
    renewal: number;
    excluded: number;
    qlooCalls: number;
    discoverOverlap: number;
    laneAPending: number;
    basketSignals: number;
  },
  showCandidates: number | undefined,
  errorCode: string | undefined,
): string {
  const lines = [
    `status:${status}`,
    `candidates:${counts.candidates}`,
    `laneA:${counts.laneA}`,
    `laneB:${counts.laneB}`,
    `proven:${counts.proven}`,
    `hidden:${counts.hidden}`,
    `category_only:${counts.categoryOnly}`,
    `none:${counts.none}`,
    `renewal:${counts.renewal}`,
    `excluded:${counts.excluded}`,
    `qlooCalls:${counts.qlooCalls}`,
    `discoverOverlap:${counts.discoverOverlap}`,
    `laneAPending:${counts.laneAPending}`,
    `basketSignals:${counts.basketSignals}`,
  ];
  if (showCandidates !== undefined) lines.push(`showCandidates:${showCandidates}`);
  if (errorCode) lines.push(`errorCode:${errorCode}`);
  return `${lines.join("\n")}\n`;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "report failed";
    process.stderr.write(`report:cli failed: ${message.slice(0, 200)}\n`);
    process.exitCode = 1;
  });
