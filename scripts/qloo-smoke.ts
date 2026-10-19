import { BudgetCounter } from "../src/shared/qloo/application/budget";
import { QlooGateway } from "../src/shared/qloo/application/qloo-gateway";
import type { QlooCache } from "../src/shared/qloo/application/qloo-cache";
import { MemoryTraceSink } from "../src/shared/trace/trace";
import { assertHackathonBaseUrl } from "../src/shared/qloo/infrastructure/base-url";
import { HarnessQloo } from "../src/shared/qloo/infrastructure/harness-qloo";
import { McpQlooClient } from "../src/shared/qloo/infrastructure/mcp-qloo-client";
import { QlooApiRunner } from "../src/shared/qloo/infrastructure/qloo-api-runner";

const noopCache: QlooCache = {
  async get() {
    return undefined;
  },
  async set() {},
};

async function main(): Promise<number> {
  const mcp = new McpQlooClient();
  const gateway = new QlooGateway(new HarnessQloo(mcp, new QlooApiRunner()), {
    budget: new BudgetCounter(25, 40),
    trace: new MemoryTraceSink(),
    cache: noopCache,
    log: () => {},
  });
  try {
    try {
      await assertHackathonBaseUrl();
    } catch {
      process.stderr.write("qloo base URL is not the hackathon host\n");
      return 1;
    }
    const capabilities = await mcp.capabilities();
    process.stdout.write(`capabilities:${capabilities}\n`);
    if (capabilities !== "ready") return 1;
    const described = await gateway.describe({ entity: "Crime Junkie", type: "podcast" });
    process.stdout.write(`describe:${described.data.status}\n`);
    return described.data.status === "error" ? 1 : 0;
  } catch {
    process.stderr.write("qloo:smoke failed\n");
    return 1;
  } finally {
    await mcp.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    process.stderr.write("qloo:smoke failed\n");
    process.exitCode = 1;
  });
