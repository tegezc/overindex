import { describe, expect, it } from "vitest";
import { BudgetCounter } from "@/shared/qloo/application/budget";
import type { QlooCache } from "@/shared/qloo/application/qloo-cache";
import { QlooGateway } from "@/shared/qloo/application/qloo-gateway";
import { FakeQloo } from "@/shared/qloo/infrastructure/fake-qloo";
import { MemoryTraceSink } from "@/shared/trace/trace";
import { TASTE_DOMAINS } from "../domain/taste-card";
import { showProfile } from "./show-profile";

const SHOW = "AAAAAAAA-BBBB-4CCC-8DDD-000000000001";

const cache: QlooCache = {
  async get() {
    return undefined;
  },
  async set() {},
};

describe("showProfile", () => {
  it("builds four domain sections and hides empty demographics", async () => {
    const fake = new FakeQloo({
      recommend: [
        {
          status: "error",
          summary: "QLOO_CALL_FAILED",
          results: [],
          result_count: 0,
          error: { code: "QLOO_CALL_FAILED", retryable: false },
        },
      ],
    });
    const qloo = new QlooGateway(fake, {
      budget: new BudgetCounter(25, 40),
      trace: new MemoryTraceSink(),
      cache,
    });
    const card = await showProfile({ id: SHOW, name: "Show North" }, qloo);
    expect(Object.keys(card.domains)).toEqual([...TASTE_DOMAINS]);
    expect(card.domains.artist.status).toBe("error");
    expect(card.domains.tv_show.status).toBe("ok");
    expect(card.domains.movie.data?.[0]?.name).toBe("Brand Alpha");
    expect(card.domains.book.status).toBe("ok");
    expect(card.tags.status).toBe("ok");
    expect(card.tags.data?.[0]?.name).toBe("Topic Alpha");
    expect(card.demographics).toBeUndefined();
    const targets = fake.calls.filter((call) => call.tool === "qloo_recommend").map((call) => call.args);
    expect(targets).toEqual(
      TASTE_DOMAINS.map((domain) => ({
        target_type: domain,
        signals: [SHOW],
        limit: 8,
        explain: false,
      })),
    );
  });

  it("includes demographics only when Qloo returns rows", async () => {
    const qloo = new QlooGateway(
      new FakeQloo({
        audienceDemographics: [
          {
            status: "ok",
            summary: "Synthetic demographics",
            results: [
              { name: "25 to 29", query: { affinity: 0.4 } },
              { name: "political preference", affinity: 0.2 },
            ],
            result_count: 2,
          },
        ],
      }),
      { budget: new BudgetCounter(25, 40), trace: new MemoryTraceSink(), cache },
    );
    const card = await showProfile({ id: SHOW, name: "Show North" }, qloo);
    expect(card.demographics?.status).toBe("ok");
    expect(card.demographics?.data).toEqual([{ label: "25 to 29", value: 0.4 }]);
  });
});
