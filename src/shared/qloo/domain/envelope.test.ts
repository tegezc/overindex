import { describe, expect, it } from "vitest";
import { parseCompare, parseDescribe } from "./envelope";

describe("workflow envelope parser", () => {
  it("accepts an error object that has no status field", () => {
    const parsed = parseDescribe({
      error: { code: "QLOO_AUTH", retryable: false, recovery: "check the host" },
      operation: "describe",
      correlation_id: "local-test",
    });
    expect(parsed.status).toBe("error");
    expect(parsed.error).toMatchObject({ code: "QLOO_AUTH", retryable: false });
    expect(parsed.summary).toBe("QLOO_AUTH");
  });

  it("keeps retryable true only when the flag is true", () => {
    expect(parseDescribe({ error: { code: "QLOO_RATE_LIMIT", retryable: true } }).error?.retryable).toBe(true);
    const missingFlag = parseDescribe({
      status: "error",
      summary: "QLOO_AUTH",
      results: [],
      error: { code: "QLOO_AUTH" },
    });
    expect(missingFlag.error?.retryable).toBe(false);
  });

  it("accepts compare results as an object", () => {
    const parsed = parseCompare({
      status: "ok",
      summary: "Synthetic audience comparison",
      results: { tags: [], a: [{ name: "Topic Alpha" }], b: [], matchEntities: [] },
      result_count: 0,
    });
    expect(parsed.status).toBe("ok");
    expect(parsed.results).toMatchObject({ a: [{ name: "Topic Alpha" }], matchEntities: [] });
  });
});
