export type LlmErrorCode = "LLM_NOT_CONFIGURED" | "LLM_EMPTY" | "LLM_INVALID" | "LLM_UPSTREAM";

/** Messages name the failure. They never include secrets or model output. */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
