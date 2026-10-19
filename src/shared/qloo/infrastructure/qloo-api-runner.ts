import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scoreCandidatesInputSchema, insightsRawInputSchema } from "../domain/inputs";
import type { InsightsRawInput, ScoreCandidatesInput } from "../domain/inputs";
import { insightsError, type InsightsResult } from "../domain/envelope";
import { assertHackathonBaseUrl, BaseUrlError } from "./base-url";
import { buildInsightsArgs, buildScoreCandidatesArgs, interpretInsightsStdout } from "./insights-cli";
import { qlooArgs, resolveQlooLaunch } from "./qloo-launch";

const execFileAsync = promisify(execFile);

type ExecFail = NodeJS.ErrnoException & {
  stdout?: string | Buffer;
  killed?: boolean;
  signal?: NodeJS.Signals;
};

/**
 * One `qloo api insights --json` process per call. Arguments are an array
 * with no shell, so JSON `--params` is not rewritten by PowerShell.
 * `qloo_rank` is not a command this runner can issue.
 */
export class QlooApiRunner {
  constructor(private readonly timeoutMs = 20_000) {}

  async scoreCandidates(input: ScoreCandidatesInput): Promise<InsightsResult> {
    const args = scoreCandidatesInputSchema.parse(input);
    return this.run(buildScoreCandidatesArgs(args));
  }

  async insightsRaw(input: InsightsRawInput): Promise<InsightsResult> {
    const args = insightsRawInputSchema.parse(input);
    return this.run(buildInsightsArgs(args));
  }

  private async run(args: string[]): Promise<InsightsResult> {
    try {
      await assertHackathonBaseUrl();
    } catch (error) {
      if (error instanceof BaseUrlError) return insightsError("BASE_URL", false);
      return insightsError("QLOO_NOT_INSTALLED", false);
    }
    let launch;
    try {
      launch = resolveQlooLaunch();
    } catch {
      return insightsError("QLOO_NOT_INSTALLED", false);
    }
    try {
      const result = await execFileAsync(launch.command, qlooArgs(launch, args), {
        encoding: "utf8",
        timeout: this.timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      return interpretInsightsStdout(result.stdout);
    } catch (error) {
      return this.fromFailure(error);
    }
  }

  private fromFailure(error: unknown): InsightsResult {
    if (!error || typeof error !== "object") return insightsError("QLOO_API_FAILED", false);
    const failed = error as ExecFail;
    if (failed.code === "ENOENT") return insightsError("QLOO_NOT_INSTALLED", false);
    if (failed.killed === true && failed.signal === "SIGTERM") return insightsError("TIMEOUT", true);
    const stdout = typeof failed.stdout === "string" ? failed.stdout : "";
    if (stdout.trim()) return interpretInsightsStdout(stdout);
    return insightsError("QLOO_API_FAILED", false);
  }
}
