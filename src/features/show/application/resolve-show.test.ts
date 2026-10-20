import { describe, expect, it } from "vitest";
import type { DisambiguateResult } from "@/shared/llm/domain/schemas";
import { BudgetCounter } from "@/shared/qloo/application/budget";
import type { QlooCache } from "@/shared/qloo/application/qloo-cache";
import { QlooGateway } from "@/shared/qloo/application/qloo-gateway";
import { FakeQloo, type FakeScripts } from "@/shared/qloo/infrastructure/fake-qloo";
import { MemoryTraceSink } from "@/shared/trace/trace";
import { resolveShow } from "./resolve-show";

const NORTH = "AAAAAAAA-BBBB-4CCC-8DDD-000000000001";
const EXTRA = "AAAAAAAA-BBBB-4CCC-8DDD-000000000002";

const cache: QlooCache = {
  async get() {
    return undefined;
  },
  async set() {},
};

function setup(scripts: FakeScripts, decision?: DisambiguateResult | "throw") {
  const qloo = new QlooGateway(new FakeQloo(scripts), {
    budget: new BudgetCounter(25, 40),
    trace: new MemoryTraceSink(),
    cache,
  });
  const calls: unknown[] = [];
  return {
    calls,
    run: (query: string) =>
      resolveShow(query, {
        describe: (input) => qloo.describe(input),
        disambiguate: async (input) => {
          calls.push(input);
          if (decision === "throw") throw new Error("llm down");
          return decision ?? { ask: true, reason: "Synthetic uncertainty" };
        },
      }),
  };
}

describe("resolveShow", () => {
  it("confirms one exact show without calling disambiguate", async () => {
    const { calls, run } = setup({
      describe: [
        {
          status: "ok",
          summary: "Synthetic describe result",
          results: [{ entity_id: NORTH, name: "Show North", type: "podcast" }],
          result_count: 1,
          resolution: {
            outcomes: [
              {
                status: "resolved",
                match: "exact",
                selected: { id: NORTH, name: "Show North", type: "urn:entity:podcast" },
                alternatives: [{ id: EXTRA, name: "Show North Night", type: "podcast" }],
              },
            ],
          },
        },
      ],
    });
    const result = await run("Show North");
    expect(result).toMatchObject({ status: "ok", mode: "direct", candidates: [{ id: NORTH, name: "Show North" }] });
    expect(calls).toHaveLength(0);
  });

  it("shows every needs_input candidate even when the model names one", async () => {
    const { calls, run } = setup(
      {
        describe: [
          {
            status: "needs_input",
            summary: "Choose the intended Qloo entity.",
            results: [],
            result_count: 0,
            resolution: {
              issues: [
                {
                  kind: "ambiguous",
                  candidates: [
                    { id: NORTH, name: "Show North", type: "podcast", description: "North" },
                    { id: EXTRA, name: "Show North Night", type: "podcast", description: "Night" },
                  ],
                },
              ],
            },
          },
        ],
      },
      { choice: NORTH, ask: false, reason: "The name matches." },
    );
    const result = await run("North");
    expect(result.status).toBe("needs_input");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([NORTH, EXTRA]);
    expect(calls).toHaveLength(1);
  });

  it("returns empty for a not_found describe and does not call the model", async () => {
    const { calls, run } = setup({
      describe: [
        {
          status: "needs_input",
          summary: "Choose the intended Qloo entity.",
          results: [],
          result_count: 0,
          resolution: { issues: [{ kind: "not_found", input: "zzqx" }] },
        },
      ],
    });
    await expect(run("zzqx")).resolves.toEqual({ status: "empty", candidates: [], mode: "proxy_suggestions" });
    expect(calls).toHaveLength(0);
  });

  it("narrows a semantic match when the model is sure", async () => {
    const { run } = setup(
      {
        describe: [
          {
            status: "ok",
            summary: "Synthetic describe result",
            results: [{ entity_id: NORTH, name: "Show North", type: "podcast" }],
            result_count: 1,
            resolution: {
              outcomes: [
                {
                  status: "resolved",
                  match: "semantic",
                  selected: { id: NORTH, name: "Show North", type: "podcast" },
                  alternatives: [{ id: EXTRA, name: "Show North Night", type: "podcast" }],
                },
              ],
            },
          },
        ],
      },
      { choice: EXTRA, ask: false, reason: "The night edition matches the query." },
    );
    const result = await run("North night edition");
    expect(result.status).toBe("ok");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([EXTRA]);
  });

  it("still lists candidates when disambiguation fails", async () => {
    const { run } = setup(
      {
        describe: [
          {
            status: "needs_input",
            summary: "Choose the intended Qloo entity.",
            results: [],
            resolution: {
              issues: [{ candidates: [{ id: NORTH, name: "Show North", type: "podcast" }] }],
            },
          },
        ],
      },
      "throw",
    );
    const result = await run("North");
    expect(result.status).toBe("needs_input");
    expect(result.candidates).toHaveLength(1);
  });

  it("returns error without an error page payload", async () => {
    const { calls, run } = setup({
      describe: [
        {
          status: "error",
          summary: "QLOO_CALL_FAILED",
          results: [],
          result_count: 0,
          error: { code: "QLOO_CALL_FAILED", retryable: false },
        },
      ],
    });
    await expect(run("Show North")).resolves.toEqual({
      status: "error",
      candidates: [],
      mode: "direct",
      errorCode: "QLOO_CALL_FAILED",
    });
    expect(calls).toHaveLength(0);
  });
});
