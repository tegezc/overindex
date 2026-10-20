import { describe, expect, it } from "vitest";
import { renderDisambiguateShowPrompt } from "../prompts/v1/disambiguate-show";
import { renderLlmBaselinePrompt } from "../prompts/v1/llm-baseline";
import { renderParseRequestPrompt } from "../prompts/v1/parse-request";
import { FakeLlm } from "../infrastructure/fake-llm";
import { LlmError } from "./llm-error";
import { LlmGateway, type LlmLog } from "./llm-gateway";

const NOW = new Date("2026-10-20T00:00:00.000Z");

function setup(scripts: ConstructorParameters<typeof FakeLlm>[0] = {}) {
  const fake = new FakeLlm(scripts);
  const logs: LlmLog[] = [];
  const gateway = new LlmGateway(fake, { now: () => NOW, log: (entry) => logs.push(entry) });
  return { fake, logs, gateway };
}

describe("LlmGateway", () => {
  it("sends the shared A.2 prompt through FakeLlm and returns 40 brands", async () => {
    const { fake, logs, gateway } = setup();
    const result = await gateway.llmBaseline({
      showName: " Show North ",
      showDescription: " Stories about wood. ",
    });
    expect(result.brands).toHaveLength(40);
    expect(result.brands[0]).toEqual({ name: "Brand Alpha 01", category: "Synthetic" });
    expect(fake.calls).toEqual([
      {
        task: "llm_baseline",
        schemaName: "llm_baseline",
        prompt: renderLlmBaselinePrompt({ showName: "Show North", showDescription: "Stories about wood." }),
      },
    ]);
    expect(logs).toEqual([{ task: "llm_baseline", status: "ok", durationMs: 0, resultCount: 40 }]);
    expect(JSON.stringify(logs)).not.toContain("Brand Alpha");
  });

  it("rejects a scripted baseline that fails the schema", async () => {
    const { gateway, logs } = setup({
      llm_baseline: [{ brands: [{ name: "Brand Alpha", category: "Synthetic" }] }],
    });
    await expect(gateway.llmBaseline({ showName: "Show North", showDescription: "Stories." })).rejects.toMatchObject({
      code: "LLM_INVALID",
    });
    expect(logs[0]?.status).toBe("error");
    expect(JSON.stringify(logs)).not.toContain("Brand Alpha");
  });

  it("maps a partial request and keeps business fields out of the log", async () => {
    const { fake, logs, gateway } = setup({
      parse_request: [
        {
          showQuery: " Show North ",
          currentSponsors: [" Brand Gamma ", ""],
          excludedCategories: null,
          sizePreference: ["challenger"],
          demographics: { ageBands: ["25-34"], gender: null },
          business: { downloadsPerEpisode: 1000, cpm: 77 },
        },
      ],
    });
    const text = "Find sponsors for Show North. CPM is 77 for Brand Gamma.";
    const parsed = await gateway.parseRequest(text);
    expect(parsed).toEqual({
      showQuery: "Show North",
      currentSponsors: ["Brand Gamma"],
      sizePreference: ["challenger"],
      demographics: { ageBands: ["25-34"] },
      business: { downloadsPerEpisode: 1000, cpm: 77 },
    });
    expect(fake.calls[0]?.prompt).toBe(renderParseRequestPrompt(text));
    expect(JSON.stringify(logs)).not.toContain("77");
    expect(JSON.stringify(logs)).not.toContain("Brand Gamma");
    expect(JSON.stringify(logs)).not.toContain("Show North");
  });

  it("asks when the model is unsure or returns an id that is not a candidate", async () => {
    const candidates = [
      { id: "show-north", name: "Show North", description: "Wood" },
      { id: "show-south", name: "Show South", description: "Water" },
    ];
    const unsure = setup({
      disambiguate_show: [{ choice: "show-north", ask: true, reason: "Two shows share the words." }],
    });
    await expect(unsure.gateway.disambiguateShow({ query: "North", candidates })).resolves.toEqual({
      ask: true,
      reason: "Two shows share the words.",
    });

    const invented = setup({
      disambiguate_show: [{ choice: "not-a-candidate", ask: false, reason: "Guessed." }],
    });
    await expect(invented.gateway.disambiguateShow({ query: "North", candidates })).resolves.toEqual({
      ask: true,
      reason: "Guessed.",
    });
    expect(invented.fake.calls[0]?.prompt).toBe(renderDisambiguateShowPrompt({ query: "North", candidates }));
  });

  it("keeps a confident choice that is one of the candidate ids", async () => {
    const { gateway } = setup({
      disambiguate_show: [{ choice: "show-north", ask: false, reason: "The name matches." }],
    });
    await expect(
      gateway.disambiguateShow({
        query: "Show North",
        candidates: [{ id: "show-north", name: "Show North", description: "Wood" }],
      }),
    ).resolves.toEqual({ choice: "show-north", ask: false, reason: "The name matches." });
  });

  it("does not call FakeLlm when the input is empty", async () => {
    const { fake, gateway } = setup();
    await expect(gateway.llmBaseline({ showName: " ", showDescription: "Stories." })).rejects.toBeInstanceOf(LlmError);
    await expect(gateway.parseRequest("  ")).rejects.toBeInstanceOf(LlmError);
    await expect(gateway.disambiguateShow({ query: "North", candidates: [] })).rejects.toBeInstanceOf(LlmError);
    expect(fake.calls).toHaveLength(0);
  });
});
