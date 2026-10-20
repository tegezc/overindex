import { LlmGateway } from "../src/shared/llm/application/llm-gateway";
import { LlmError } from "../src/shared/llm/application/llm-error";
import { llmBaselineSchema } from "../src/shared/llm/domain/schemas";
import { createOpenAiLlm } from "../src/shared/llm/infrastructure/openai-llm";

const MODEL = "gpt-6.1-sol";
const REASONING_EFFORT = "medium";

async function main(): Promise<number> {
  const showName = process.argv[2];
  const showDescription = process.argv[3];
  if (!showName?.trim() || showDescription === undefined || !showDescription.trim()) {
    process.stderr.write('usage: npm run llm:baseline -- "<show>" "<description>"\n');
    return 2;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    process.stderr.write(
      "OPENAI_API_KEY is not set in this process. Set it yourself in the local environment, then re-run npm run llm:baseline. This script does not read key files and does not print the key.\n",
    );
    return 2;
  }

  const gateway = new LlmGateway(
    createOpenAiLlm({ apiKey, model: MODEL, reasoningEffort: REASONING_EFFORT }),
    { log: () => {} },
  );
  try {
    const result = llmBaselineSchema.parse(await gateway.llmBaseline({ showName, showDescription }));
    process.stderr.write(`model:${MODEL}\nreasoning:${REASONING_EFFORT}\ncount:${result.brands.length}\n`);
    process.stdout.write(`${JSON.stringify(result.brands)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof LlmError ? error.code : "LLM_UPSTREAM";
    const message = error instanceof LlmError ? error.message : "OpenAI request failed";
    process.stderr.write(`llm:baseline failed ${code}: ${message}\n`);
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    process.stderr.write("llm:baseline failed LLM_UPSTREAM: OpenAI request failed\n");
    process.exitCode = 1;
  });
