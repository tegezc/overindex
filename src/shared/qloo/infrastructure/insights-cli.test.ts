import { describe, expect, it } from "vitest";
import { buildScoreCandidatesArgs, interpretInsightsStdout } from "./insights-cli";

describe("insights cli", () => {
  it("asks qloo api insights for candidate ids and explainability, never rank", () => {
    const args = buildScoreCandidatesArgs({
      type: "brand",
      signalEntityIds: ["AAAAAAAA-BBBB-4CCC-8DDD-000000000001"],
      candidateIds: ["AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1"],
      explainability: true,
    });
    expect(args.slice(0, 2)).toEqual(["api", "insights"]);
    const joined = args.join(" ");
    expect(joined).not.toContain("rank");
    expect(joined).not.toContain("api.qloo.com");
    const params = JSON.parse(args[args.indexOf("--params") + 1] ?? "{}") as Record<string, string>;
    expect(params["filter.results.entities"]).toBe("AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1");
    expect(params["feature.explainability"]).toBe("true");
    expect(args).toContain("--json");
    expect(args).toContain("--signal-entities");
  });

  it("parses a synthetic entity array and a retryable error object", () => {
    const ok = interpretInsightsStdout(
      '[{"name":"Brand Alpha","entity_id":"AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1","popularity":0.4,"query":{"affinity":0.7}}]',
    );
    expect(ok.status).toBe("ok");
    expect(ok.entities[0]?.query?.affinity).toBe(0.7);
    const limited = interpretInsightsStdout('{"error":{"code":"QLOO_RATE_LIMIT","retryable":true}}');
    expect(limited.status).toBe("error");
    expect(limited.error).toMatchObject({ code: "QLOO_RATE_LIMIT", retryable: true });
  });
});
