import path from "node:path";
import { pathToFileURL } from "node:url";
import { calendarDayWib } from "../src/features/report/domain/live-quota";
import { createReportServices, startReport } from "../src/features/report/application/execute-report";
import { writeFeatured } from "../src/features/report/infrastructure/featured-store";
import { getEnv, EnvError } from "../src/shared/config/env";
import { closeSharedMcpClient } from "../src/shared/qloo/infrastructure/mcp-qloo-client";

/**
 * Working list for the generator. Not a locked editorial set (D-O7 is still open).
 * Roles: startup/tech, comedy, sports, mid-tier niche.
 * A proxy-mode example is omitted: G1 was 20/20 and no uncovered show has been chosen.
 * Running this script executes the report pipeline. Output stays in CACHE_DIR and is never committed.
 */
export const FEATURED_SHOW_QUERIES = ["This Week in Startups", "SmartLess", "New Heights", "Gastropod"] as const;

export function showsToGenerate(argv: readonly string[]): string[] {
  const names = argv.map((arg) => arg.trim()).filter((arg) => arg.length > 0 && !arg.startsWith("--"));
  return names.length > 0 ? names : [...FEATURED_SHOW_QUERIES];
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stderr.write('usage: npm run featured:generate -- ["Show A" "Show B"]\n');
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
  const shows = showsToGenerate(argv);
  let failed = false;
  try {
    for (const showQuery of shows) {
      const services = createReportServices(env);
      const run = startReport({ input: { showQuery } }, services);
      await run.whenFinished();
      const dataDate = calendarDayWib(new Date(run.report.createdAt));
      const summary = await writeFeatured(env.CACHE_DIR, run.report, dataDate);
      process.stderr.write(`saved ${summary.id} ${summary.dataDate} ${summary.mode} calls=${run.report.budget.used}\n`);
    }
  } catch {
    process.stderr.write("featured generation stopped before every show was saved\n");
    failed = true;
  } finally {
    if (!env.USE_FAKE_QLOO) await closeSharedMcpClient();
  }
  return failed ? 1 : 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
