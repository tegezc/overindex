import { ZodError, type z } from "zod";
import { toDisambiguateResult, toPartialReportInput } from "../domain/map-output";
import {
  disambiguateInputSchema,
  disambiguateModelSchema,
  llmBaselineInputSchema,
  llmBaselineSchema,
  parseRequestInputSchema,
  parseRequestModelSchema,
  type DisambiguateResult,
  type LlmBaseline,
  type PartialReportInput,
} from "../domain/schemas";
import { renderDisambiguateShowPrompt } from "../prompts/v1/disambiguate-show";
import { renderLlmBaselinePrompt } from "../prompts/v1/llm-baseline";
import { renderParseRequestPrompt } from "../prompts/v1/parse-request";
import { LlmError } from "./llm-error";
import type { LlmPort } from "./llm-port";

export type LlmLog = {
  task: "parse_request" | "disambiguate_show" | "llm_baseline";
  status: "ok" | "error";
  durationMs: number;
  resultCount?: number;
};

export type LlmGatewayOptions = {
  now?: () => Date;
  log?: (entry: LlmLog) => void;
};

export class LlmGateway {
  private readonly now: () => Date;

  constructor(
    private readonly inner: LlmPort,
    private readonly options: LlmGatewayOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async parseRequest(text: string): Promise<PartialReportInput> {
    const input = parseInput(parseRequestInputSchema, { text }, "request text is required");
    const model = await this.run("parse_request", "parse_request", renderParseRequestPrompt(input.text), parseRequestModelSchema, () => 1);
    return toPartialReportInput(model);
  }

  async disambiguateShow(input: { query: string; candidates: { id: string; name: string; description: string }[] }): Promise<DisambiguateResult> {
    const parsed = parseInput(disambiguateInputSchema, input, "query and at least one candidate are required");
    const ids = parsed.candidates.map((candidate) => candidate.id);
    if (new Set(ids).size !== ids.length) {
      throw new LlmError("LLM_INVALID", "candidate ids must be unique");
    }
    const model = await this.run(
      "disambiguate_show",
      "disambiguate_show",
      renderDisambiguateShowPrompt(parsed),
      disambiguateModelSchema,
      () => 1,
    );
    return toDisambiguateResult(model, parsed.candidates);
  }

  async llmBaseline(input: { showName: string; showDescription: string }): Promise<LlmBaseline> {
    const parsed = parseInput(llmBaselineInputSchema, input, "show name and description are required");
    return this.run(
      "llm_baseline",
      "llm_baseline",
      renderLlmBaselinePrompt({ showName: parsed.showName, showDescription: parsed.showDescription }),
      llmBaselineSchema,
      (value) => value.brands.length,
    );
  }

  private async run<T>(
    task: LlmLog["task"],
    schemaName: string,
    prompt: string,
    schema: z.ZodType<T>,
    resultCount: (value: T) => number,
  ): Promise<T> {
    const started = this.now().getTime();
    try {
      const value = await this.inner.complete({ task, prompt, schemaName, schema });
      this.options.log?.({
        task,
        status: "ok",
        durationMs: this.now().getTime() - started,
        resultCount: resultCount(value),
      });
      return value;
    } catch (error) {
      this.options.log?.({ task, status: "error", durationMs: this.now().getTime() - started });
      if (error instanceof LlmError) throw error;
      if (error instanceof ZodError) throw new LlmError("LLM_INVALID", "model output failed schema validation");
      throw new LlmError("LLM_UPSTREAM", "OpenAI request failed");
    }
  }
}

function parseInput<T>(schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false } }, data: unknown, message: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new LlmError("LLM_INVALID", message);
  return parsed.data;
}
