import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError, type ZodType } from "zod";
import type { Env } from "@/shared/config/env";
import { LlmError } from "../application/llm-error";
import type { LlmPort, LlmRequest } from "../application/llm-port";

/** Efforts `gpt-6.1-sol` accepts. `none` and `minimal` are rejected by that model. */
export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type OpenAiLlmConfig = {
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
};

export type StructuredResponseClient = {
  parse: (body: {
    model: string;
    reasoning: { effort: ReasoningEffort };
    input: string;
    text: { format: ReturnType<typeof zodTextFormat> };
  }) => Promise<{ output_parsed?: unknown }>;
};

/**
 * Responses API client. Returns only the zod-parsed object.
 * The raw response is not logged or returned.
 */
export class OpenAiLlm implements LlmPort {
  constructor(
    private readonly responses: StructuredResponseClient,
    private readonly options: { model: string; reasoningEffort: ReasoningEffort },
  ) {}

  async complete<T>(request: LlmRequest<T>): Promise<T> {
    let parsed: unknown;
    try {
      const response = await this.responses.parse({
        model: this.options.model,
        reasoning: { effort: this.options.reasoningEffort },
        input: request.prompt,
        text: { format: zodTextFormat(request.schema as ZodType, request.schemaName) },
      });
      parsed = response.output_parsed;
    } catch (error) {
      throw asLlmError(error);
    }
    if (parsed == null) throw new LlmError("LLM_EMPTY", "model returned no parsed output");
    try {
      return request.schema.parse(parsed);
    } catch (error) {
      if (error instanceof ZodError) throw new LlmError("LLM_INVALID", "model output failed schema validation");
      throw error;
    }
  }
}

export function parseReasoningEffort(value: string): ReasoningEffort {
  if ((REASONING_EFFORTS as readonly string[]).includes(value)) return value as ReasoningEffort;
  throw new LlmError("LLM_NOT_CONFIGURED", "OPENAI_REASONING_EFFORT is not supported");
}

export function createOpenAiLlm(config: OpenAiLlmConfig): OpenAiLlm {
  if (!config.apiKey.trim()) throw new LlmError("LLM_NOT_CONFIGURED", "OPENAI_API_KEY is required");
  if (!config.model.trim()) throw new LlmError("LLM_NOT_CONFIGURED", "OPENAI_MODEL is required");
  const client = new OpenAI({ apiKey: config.apiKey });
  return new OpenAiLlm(
    {
      parse: async (body) => {
        const response = await client.responses.parse(body);
        return { output_parsed: response.output_parsed };
      },
    },
    { model: config.model, reasoningEffort: config.reasoningEffort },
  );
}

export function createOpenAiLlmFromEnv(env: Env): OpenAiLlm {
  if (!env.OPENAI_API_KEY) throw new LlmError("LLM_NOT_CONFIGURED", "OPENAI_API_KEY is required");
  return createOpenAiLlm({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    reasoningEffort: parseReasoningEffort(env.OPENAI_REASONING_EFFORT),
  });
}

function asLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof ZodError) return new LlmError("LLM_INVALID", "model output failed schema validation");
  const status = readStatus(error);
  return new LlmError("LLM_UPSTREAM", status ? `OpenAI request failed (${status})` : "OpenAI request failed");
}

function readStatus(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? String(status) : undefined;
}
