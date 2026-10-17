import { describe, expect, it } from "vitest";
import { loadEnv } from "@/shared/config/env";
import { buildHealth } from "./health";

describe("buildHealth", () => {
  it("reports llm missing and qloo unchecked in fake mode without keys", () => {
    expect(buildHealth(loadEnv({ USE_FAKE_QLOO: "true" }))).toEqual({ ok: true, qloo: "unchecked", llm: "missing" });
  });

  it("reports llm configured without exposing the key", () => {
    const health = buildHealth(loadEnv({ OPENAI_API_KEY: "test-openai" }));
    expect(health.llm).toBe("configured");
    expect(JSON.stringify(health)).not.toContain("test-openai");
  });
});
