import { ZodError } from "zod";
import { LlmError } from "../application/llm-error";
import type { LlmPort, LlmRequest, LlmTask } from "../application/llm-port";
import { BASELINE_BRAND_COUNT } from "../domain/schemas";

export type FakeLlmScripts = Partial<Record<LlmTask, unknown[]>>;

export type FakeLlmCall = {
  task: LlmTask;
  prompt: string;
  schemaName: string;
};

/**
 * Deterministic stand-in. Brand names are fictional ("Brand Alpha 01").
 * This does not call OpenAI and does not replay a model response.
 */
export class FakeLlm implements LlmPort {
  readonly calls: FakeLlmCall[] = [];
  private readonly queues: Map<string, unknown[]>;

  constructor(scripts: FakeLlmScripts = {}) {
    this.queues = new Map(Object.entries(scripts).map(([task, items]) => [task, [...items]]));
  }

  async complete<T>(request: LlmRequest<T>): Promise<T> {
    this.calls.push({ task: request.task, prompt: request.prompt, schemaName: request.schemaName });
    const queued = this.queues.get(request.task);
    const raw = queued && queued.length > 0 ? queued.shift() : synthetic(request.task);
    try {
      return request.schema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) throw new LlmError("LLM_INVALID", "model output failed schema validation");
      throw error;
    }
  }
}

function synthetic(task: LlmTask): unknown {
  if (task === "llm_baseline") {
    return {
      brands: Array.from({ length: BASELINE_BRAND_COUNT }, (_, index) => ({
        name: `Brand Alpha ${String(index + 1).padStart(2, "0")}`,
        category: "Synthetic",
      })),
    };
  }
  if (task === "parse_request") {
    return {
      showQuery: "Show North",
      currentSponsors: null,
      excludedCategories: null,
      sizePreference: null,
      demographics: null,
      business: null,
    };
  }
  return { choice: null, ask: true, reason: "Synthetic uncertainty" };
}
