import type { InsightsRawInput, ScoreCandidatesInput } from "../domain/inputs";
import { insightsError, parseInsightsResult, type InsightsResult } from "../domain/envelope";

export function buildInsightsArgs(input: InsightsRawInput): string[] {
  const args = ["api", "insights", "--type", input.type];
  if (input.signalEntityIds && input.signalEntityIds.length > 0) {
    args.push("--signal-entities", input.signalEntityIds.join(","));
  }
  if (input.take !== undefined) args.push("--take", String(input.take));
  if (input.params && Object.keys(input.params).length > 0) {
    const params: Record<string, string> = {};
    for (const key of Object.keys(input.params).sort()) {
      params[key] = String(input.params[key]);
    }
    args.push("--params", JSON.stringify(params));
  }
  args.push("--json");
  return args;
}

export function buildScoreCandidatesArgs(input: ScoreCandidatesInput & { type: string }): string[] {
  const params: Record<string, string> = {
    "filter.results.entities": input.candidateIds.join(","),
  };
  if (input.explainability) params["feature.explainability"] = "true";
  return buildInsightsArgs({
    type: input.type,
    signalEntityIds: input.signalEntityIds,
    take: input.take ?? input.candidateIds.length,
    params,
  });
}

/** Parse `qloo api insights --json` stdout. The body is never copied into the error. */
export function interpretInsightsStdout(stdout: string): InsightsResult {
  const parsed = firstJson(stdout);
  if (parsed === undefined) return insightsError("QLOO_API_FAILED", false);
  if (Array.isArray(parsed)) {
    const result = parseInsightsResult({
      status: parsed.length === 0 ? "empty" : "ok",
      entities: parsed,
      result_count: parsed.length,
    });
    return result;
  }
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  const error = record?.error;
  if (error && typeof error === "object") {
    const body = error as Record<string, unknown>;
    const code = typeof body.code === "string" && body.code ? body.code : "QLOO_API_FAILED";
    return insightsError(code, body.retryable === true);
  }
  if (record && typeof record.status === "string") {
    return parseInsightsResult(record);
  }
  return insightsError("QLOO_API_FAILED", false);
}

function firstJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = Math.min(...["[", "{"].map((mark) => {
      const index = trimmed.indexOf(mark);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    }));
    if (!Number.isFinite(start)) return undefined;
    try {
      return JSON.parse(trimmed.slice(start));
    } catch {
      return undefined;
    }
  }
}
