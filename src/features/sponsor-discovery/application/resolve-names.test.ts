import { describe, expect, it } from "vitest";
import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { DescribeEnvelope } from "@/shared/qloo/domain/envelope";
import { resolveBrandName } from "./resolve-names";

const RIGHT = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1";

function described(data: DescribeEnvelope): QlooCall<DescribeEnvelope> {
  return {
    data,
    provenance: {
      callId: "local",
      tool: "qloo_describe",
      params: {},
      at: "2026-10-20T00:00:00.000Z",
      status: data.status,
      cached: false,
    },
  };
}

describe("resolveBrandName", () => {
  it("describes one brand name and keeps a needs_input candidate that matches", async () => {
    const seen: { entity: string; type: string }[] = [];
    const hit = await resolveBrandName("AG1", async (input) => {
      seen.push(input);
      return described({
        status: "needs_input",
        summary: "choose",
        results: [],
        result_count: 0,
        resolution: {
          issues: [{ candidates: [{ id: RIGHT, name: "AG1 Energy", type: "brand" }] }],
        },
      });
    });
    expect(seen).toEqual([{ entity: "AG1", type: "brand" }]);
    expect(hit).toEqual({ id: RIGHT, name: "AG1 Energy" });
  });

  it("returns undefined on an error envelope and does not throw", async () => {
    const hit = await resolveBrandName("Brand Alpha", async () =>
      described({
        status: "error",
        summary: "QLOO_AUTH",
        results: [],
        result_count: 0,
        error: { code: "QLOO_AUTH", retryable: false },
      }),
    );
    expect(hit).toBeUndefined();
  });
});
