import { getEnv } from "@/shared/config/env";
import { FileQlooCache } from "@/shared/cache/file-cache";
import { LlmGateway } from "@/shared/llm/application/llm-gateway";
import { FakeLlm } from "@/shared/llm/infrastructure/fake-llm";
import { createOpenAiLlm, parseReasoningEffort } from "@/shared/llm/infrastructure/openai-llm";
import { BudgetCounter } from "@/shared/qloo/application/budget";
import { QlooGateway } from "@/shared/qloo/application/qloo-gateway";
import { FakeQloo } from "@/shared/qloo/infrastructure/fake-qloo";
import { HarnessQloo } from "@/shared/qloo/infrastructure/harness-qloo";
import { getSharedMcpClient } from "@/shared/qloo/infrastructure/mcp-qloo-client";
import { QlooApiRunner } from "@/shared/qloo/infrastructure/qloo-api-runner";
import { MemoryTraceSink } from "@/shared/trace/trace";

/** One budget per request. The MCP child and the file cache are shared. */
export function createRequestQloo(): QlooGateway {
  const env = getEnv();
  const inner = env.USE_FAKE_QLOO ? new FakeQloo() : new HarnessQloo(getSharedMcpClient(), new QlooApiRunner());
  return new QlooGateway(inner, {
    budget: new BudgetCounter(env.QLOO_BUDGET_TARGET, env.QLOO_BUDGET_CAP),
    trace: new MemoryTraceSink(),
    cache: new FileQlooCache(env.CACHE_DIR),
  });
}

export function createRequestLlm(): LlmGateway {
  const env = getEnv();
  if (env.USE_FAKE_QLOO) return new LlmGateway(new FakeLlm());
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  return new LlmGateway(
    createOpenAiLlm({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      reasoningEffort: parseReasoningEffort(env.OPENAI_REASONING_EFFORT),
    }),
  );
}
