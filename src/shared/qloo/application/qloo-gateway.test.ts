import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileQlooCache } from "@/shared/cache/file-cache";
import { MemoryTraceSink } from "@/shared/trace/trace";
import { FakeQloo } from "../infrastructure/fake-qloo";
import { redactParams } from "../domain/provenance";
import { BudgetCounter } from "./budget";
import { QlooGateway } from "./qloo-gateway";
import { QLOO_TOOLS } from "./qloo-port";
import { RATE_LIMIT_BACKOFF_MS, RETRY_BACKOFF_MS } from "./retry-policy";

const NOW = new Date("2026-10-19T06:00:00.000Z");

const retryable = (code: string) => ({
  status: "error",
  summary: code,
  results: [],
  result_count: 0,
  error: { code, retryable: true },
});

const fatal = {
  status: "error",
  summary: "QLOO_AUTH",
  results: [],
  result_count: 0,
  error: { code: "QLOO_AUTH", retryable: false },
};

describe("QlooGateway", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  function setup(cap: number, scripts: ConstructorParameters<typeof FakeQloo>[0] = {}) {
    dir = mkdtempSync(path.join(tmpdir(), "overindex-qloo-"));
    const fake = new FakeQloo(scripts);
    const trace = new MemoryTraceSink(() => NOW);
    const sleeps: number[] = [];
    const gateway = new QlooGateway(fake, {
      budget: new BudgetCounter(25, cap),
      trace,
      cache: new FileQlooCache(dir, () => NOW),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => NOW,
      log: () => {},
    });
    return { fake, trace, sleeps, gateway };
  }

  const show = { entity: "Show North", type: "podcast" };

  it("retries only retryable errors and uses the longer 429 backoff", async () => {
    const { fake, sleeps, gateway, trace } = setup(40, {
      describe: [retryable("QLOO_RATE_LIMIT"), retryable("QLOO_RATE_LIMIT")],
    });
    const result = await gateway.describe(show);
    expect(result.data.status).toBe("ok");
    expect(result.data.summary).toBe("Synthetic describe result");
    expect(sleeps).toEqual([...RATE_LIMIT_BACKOFF_MS]);
    expect(fake.calls).toHaveLength(3);
    expect(gateway.budget.used).toBe(3);
    expect(result.provenance.cached).toBe(false);
    expect(result.provenance.tool).toBe("qloo_describe");
    expect(JSON.stringify(trace.events())).not.toContain("rank");
  });

  it("uses the standard backoff for other retryable errors and stops after two retries", async () => {
    const { fake, sleeps, gateway } = setup(40, {
      describe: [retryable("QLOO_UPSTREAM"), retryable("QLOO_UPSTREAM"), retryable("QLOO_UPSTREAM")],
    });
    const result = await gateway.describe(show);
    expect(result.data.status).toBe("error");
    expect(result.data.error?.code).toBe("QLOO_UPSTREAM");
    expect(sleeps).toEqual([...RETRY_BACKOFF_MS]);
    expect(fake.calls).toHaveLength(3);
    expect(gateway.budget.used).toBe(3);
  });

  it("does not retry when error.retryable is false", async () => {
    const { fake, sleeps, gateway } = setup(40, { describe: [fatal, retryable("QLOO_UPSTREAM")] });
    const result = await gateway.describe(show);
    expect(result.data.status).toBe("error");
    expect(result.data.error?.code).toBe("QLOO_AUTH");
    expect(sleeps).toEqual([]);
    expect(fake.calls).toHaveLength(1);
    expect(gateway.budget.used).toBe(1);
  });

  it("blocks the next call at the budget cap", async () => {
    const { fake, gateway, trace } = setup(1);
    const first = await gateway.describe(show);
    const second = await gateway.describe({ entity: "Show South", type: "podcast" });
    expect(first.data.status).toBe("ok");
    expect(second.data.status).toBe("error");
    expect(second.data.error?.code).toBe("BUDGET_CAP");
    expect(second.data.error?.retryable).toBe(false);
    expect(fake.calls).toHaveLength(1);
    expect(gateway.budget.used).toBe(1);
    expect(trace.events().some((event) => event.kind === "error" && event.summary.includes("budget cap"))).toBe(true);
  });

  it("skips a further retry once the cap is already spent", async () => {
    const { fake, sleeps, gateway } = setup(2, {
      describe: [retryable("QLOO_RATE_LIMIT"), retryable("QLOO_RATE_LIMIT")],
    });
    const result = await gateway.describe(show);
    expect(result.data.status).toBe("error");
    expect(result.data.error?.code).toBe("QLOO_RATE_LIMIT");
    expect(sleeps).toEqual([RATE_LIMIT_BACKOFF_MS[0]]);
    expect(fake.calls).toHaveLength(2);
    expect(gateway.budget.used).toBe(2);
  });

  it("serves a second identical call from the filesystem cache without spending budget", async () => {
    const { fake, gateway } = setup(40);
    const first = await gateway.describe(show);
    const second = await gateway.describe(show);
    expect(first.provenance.cached).toBe(false);
    expect(second.provenance.cached).toBe(true);
    expect(second.data.summary).toBe("Synthetic describe result");
    expect(fake.calls).toHaveLength(1);
    expect(gateway.budget.used).toBe(1);
    expect(second.provenance.params).toMatchObject({ entity: "Show North", type: "podcast" });
  });

  it("does not cache error envelopes", async () => {
    const { fake, gateway } = setup(40, { describe: [fatal, fatal] });
    await gateway.describe(show);
    await gateway.describe(show);
    expect(fake.calls).toHaveLength(2);
    expect(gateway.budget.used).toBe(2);
  });

  it("scores candidates through the insights path with synthetic brands", async () => {
    const { gateway, fake } = setup(40);
    const scored = await gateway.scoreCandidates({
      signalEntityIds: ["AAAAAAAA-BBBB-4CCC-8DDD-000000000001"],
      candidateIds: ["AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1"],
      explainability: true,
    });
    expect(scored.data.status).toBe("ok");
    expect(scored.data.entities.map((entity) => entity.name)).toEqual(["Brand Alpha", "Brand Beta"]);
    expect(fake.calls[0]?.tool).toBe("api:insights");
    expect(QLOO_TOOLS.join(" ")).not.toContain("rank");
  });

  it("redacts credential-like parameter names", () => {
    expect(redactParams({ entity: "Show North", apiKey: "should-not-leak" })).toEqual({
      entity: "Show North",
      apiKey: "[redacted]",
    });
  });
});
