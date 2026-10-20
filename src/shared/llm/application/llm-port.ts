import type { z } from "zod";

export const LLM_TASKS = ["parse_request", "disambiguate_show", "llm_baseline"] as const;

export type LlmTask = (typeof LLM_TASKS)[number];

export type LlmRequest<T> = {
  task: LlmTask;
  prompt: string;
  schemaName: string;
  schema: z.ZodType<T>;
};

/** Structured completion. Implementations validate `schema` before returning. */
export interface LlmPort {
  complete<T>(request: LlmRequest<T>): Promise<T>;
}
