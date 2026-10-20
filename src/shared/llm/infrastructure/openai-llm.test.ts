import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import { loadEnv } from "@/shared/config/env";
import { LlmError } from "../application/llm-error";
import type { LlmRequest } from "../application/llm-port";
import {
  BASELINE_BRAND_COUNT,
  disambiguateModelSchema,
  llmBaselineSchema,
  parseRequestModelSchema,
} from "../domain/schemas";
import {
  OpenAiLlm,
  createOpenAiLlm,
  createOpenAiLlmFromEnv,
  parseReasoningEffort,
  type StructuredResponseClient,
} from "./openai-llm";

const brands = {
  brands: Array.from({ length: BASELINE_BRAND_COUNT }, (_, index) => ({
    name: `Brand Alpha ${String(index + 1).padStart(2, "0")}`,
    category: "Synthetic",
  })),
};

const request: LlmRequest<typeof brands> = {
  task: "llm_baseline",
  prompt: "prompt-under-test",
  schemaName: "llm_baseline",
  schema: llmBaselineSchema,
};

describe("OpenAiLlm", () => {
  it("sends gpt-6.1-sol at medium effort and does not call a live client", async () => {
    const seen: unknown[] = [];
    const stub: StructuredResponseClient = {
      parse: async (body) => {
        seen.push(body);
        return { output_parsed: brands };
      },
    };
    const result = await new OpenAiLlm(stub, { model: "gpt-6.1-sol", reasoningEffort: "medium" }).complete(request);
    expect(result.brands).toHaveLength(40);
    expect(seen).toHaveLength(1);
    const body = seen[0] as {
      model: string;
      reasoning: { effort: string };
      input: string;
      text: { format: { type: string; name: string; strict: boolean } };
    };
    expect(body.model).toBe("gpt-6.1-sol");
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.input).toBe("prompt-under-test");
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.name).toBe("llm_baseline");
    expect(body.text.format.strict).toBe(true);
  });

  it("builds strict schemas for the three v1 tasks", () => {
    const baseline = zodTextFormat(llmBaselineSchema, "llm_baseline");
    const brandsSchema = baseline.schema as { properties?: { brands?: { minItems?: number; maxItems?: number } } };
    expect(baseline.strict).toBe(true);
    expect(brandsSchema.properties?.brands?.minItems).toBe(40);
    expect(brandsSchema.properties?.brands?.maxItems).toBe(40);
    expect(zodTextFormat(parseRequestModelSchema, "parse_request").name).toBe("parse_request");
    expect(zodTextFormat(disambiguateModelSchema, "disambiguate_show").strict).toBe(true);
  });

  it("returns an empty or invalid code without the upstream message", async () => {
    const empty: StructuredResponseClient = { parse: async () => ({ output_parsed: null }) };
    await expect(new OpenAiLlm(empty, { model: "gpt-6.1-sol", reasoningEffort: "medium" }).complete(request)).rejects.toMatchObject({
      code: "LLM_EMPTY",
    });

    const leaking: StructuredResponseClient = {
      parse: async () => {
        throw Object.assign(new Error("bad key sk-secret-value"), { status: 401 });
      },
    };
    try {
      await new OpenAiLlm(leaking, { model: "gpt-6.1-sol", reasoningEffort: "medium" }).complete(request);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect(String(error)).toContain("OpenAI request failed (401)");
      expect(String(error)).not.toContain("sk-secret-value");
    }
  });

  it("rejects a missing key and an unsupported reasoning effort", () => {
    expect(() => createOpenAiLlm({ apiKey: " ", model: "gpt-6.1-sol", reasoningEffort: "medium" })).toThrow(/OPENAI_API_KEY/);
    expect(() => createOpenAiLlmFromEnv(loadEnv({ USE_FAKE_QLOO: "true" }))).toThrow(/OPENAI_API_KEY/);
    expect(parseReasoningEffort("medium")).toBe("medium");
    expect(() => parseReasoningEffort("none")).toThrow(/OPENAI_REASONING_EFFORT/);
    try {
      parseReasoningEffort("sk-should-not-leak");
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("sk-should-not-leak");
    }
  });
});
