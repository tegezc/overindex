import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "./env";

describe("loadEnv", () => {
  it("applies defaults in fake mode without secrets", () => {
    const env = loadEnv({ USE_FAKE_QLOO: "true" });
    expect(env.USE_FAKE_QLOO).toBe(true);
    expect(env.OPENAI_MODEL).toBe("gpt-6.1-sol");
    expect(env.OPENAI_REASONING_EFFORT).toBe("medium");
    expect(env.QLOO_BUDGET_TARGET).toBe(25);
    expect(env.QLOO_BUDGET_CAP).toBe(40);
    expect(env.QLOO_CONCURRENCY).toBe(2);
    expect(env.LIVE_REPORTS_PER_IP_PER_DAY).toBe(3);
    expect(env.LIVE_REPORTS_GLOBAL_PER_DAY).toBe(50);
    expect(env.CACHE_DIR).toBe("./.cache");
  });

  it("requires OPENAI_API_KEY outside fake mode", () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    expect(() => loadEnv({})).toThrow(/OPENAI_API_KEY/);
  });

  it("treats empty strings as missing", () => {
    expect(() => loadEnv({ OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY/);
  });

  it("allows dev without QLOO_API_KEY (harness config is used locally)", () => {
    const env = loadEnv({ NODE_ENV: "development", OPENAI_API_KEY: "test-openai" });
    expect(env.QLOO_API_KEY).toBeUndefined();
  });

  it("requires QLOO_API_KEY in production and defaults CACHE_DIR to /data", () => {
    expect(() => loadEnv({ NODE_ENV: "production", OPENAI_API_KEY: "test-openai" })).toThrow(/QLOO_API_KEY/);
    const env = loadEnv({ NODE_ENV: "production", OPENAI_API_KEY: "test-openai", QLOO_API_KEY: "test-qloo" });
    expect(env.CACHE_DIR).toBe("/data");
  });

  it("coerces numbers and rejects target above cap", () => {
    const env = loadEnv({ USE_FAKE_QLOO: "true", QLOO_BUDGET_TARGET: "10", QLOO_BUDGET_CAP: "12" });
    expect(env.QLOO_BUDGET_TARGET).toBe(10);
    expect(() => loadEnv({ USE_FAKE_QLOO: "true", QLOO_BUDGET_TARGET: "50" })).toThrow(/QLOO_BUDGET_TARGET/);
  });

  it("rejects invalid flag values", () => {
    expect(() => loadEnv({ USE_FAKE_QLOO: "yes" })).toThrow(/USE_FAKE_QLOO/);
  });

  it("never includes secret values in the error message", () => {
    try {
      loadEnv({ NODE_ENV: "production", OPENAI_API_KEY: "sk-should-not-leak" });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain("sk-should-not-leak");
    }
  });
});
