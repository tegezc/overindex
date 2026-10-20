import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  parseCompare,
  parseDemographics,
  parseDescribe,
  parseEntityTags,
  parseFindTags,
  parseRecommend,
  parseTrends,
  workflowError,
  type CompareEnvelope,
  type DemographicsEnvelope,
  type DescribeEnvelope,
  type EntityTagsEnvelope,
  type FindTagsEnvelope,
  type RecommendEnvelope,
  type TrendsEnvelope,
} from "../domain/envelope";
import {
  compareInputSchema,
  demographicsInputSchema,
  describeInputSchema,
  entityTagsInputSchema,
  findTagsInputSchema,
  recommendInputSchema,
  trendsInputSchema,
  type CompareInput,
  type DemographicsInput,
  type DescribeInput,
  type EntityTagsInput,
  type FindTagsInput,
  type RecommendInput,
  type TrendsInput,
} from "../domain/inputs";
import { assertHackathonBaseUrl, BaseUrlError } from "./base-url";
import { qlooArgs, resolveQlooLaunch } from "./qloo-launch";
import { CallTimeoutError, withTimeout } from "./timeout";

type ToolResult = {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }
}

/**
 * Long-lived `qloo mcp` child. `qloo_capabilities` does not call Qloo.
 * Upstream tools refuse to run unless the harness base URL is the hackathon host.
 */
export class McpQlooClient {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;
  private readonly limit: Semaphore;
  private readonly timeoutMs: number;

  constructor(options: { concurrency?: number; timeoutMs?: number } = {}) {
    this.limit = new Semaphore(options.concurrency ?? 2);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async capabilities(): Promise<"ready" | "missing"> {
    try {
      const result = await this.callTool("qloo_capabilities", {}, false);
      return adapterReady(result) ? "ready" : "missing";
    } catch {
      return "missing";
    }
  }

  async describe(input: DescribeInput): Promise<DescribeEnvelope> {
    const args = describeInputSchema.parse(input);
    return this.workflow("qloo_describe", args, [], parseDescribe);
  }

  async findTags(input: FindTagsInput): Promise<FindTagsEnvelope> {
    const args = findTagsInputSchema.parse(input);
    return this.workflow("qloo_find_tags", args, [], parseFindTags);
  }

  async recommend(input: RecommendInput): Promise<RecommendEnvelope> {
    const args = recommendInputSchema.parse(input);
    return this.workflow("qloo_recommend", args, [], parseRecommend);
  }

  async compareAudiences(input: CompareInput): Promise<CompareEnvelope> {
    const args = compareInputSchema.parse(input);
    const empty = { tags: [], a: [], b: [], matchEntities: [] };
    return this.workflow("qloo_compare_audiences", args, empty, parseCompare);
  }

  async audienceDemographics(input: DemographicsInput): Promise<DemographicsEnvelope> {
    const args = demographicsInputSchema.parse(input);
    return this.workflow("qloo_audience_demographics", args, [], parseDemographics);
  }

  async entityTags(input: EntityTagsInput): Promise<EntityTagsEnvelope> {
    const args = entityTagsInputSchema.parse(input);
    return this.workflow("qloo_entity_tags", args, [], parseEntityTags);
  }

  async trends(input: TrendsInput): Promise<TrendsEnvelope> {
    const args = trendsInputSchema.parse(input);
    return this.workflow("qloo_trends", args, [], parseTrends);
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    if (!client) return;
    await withTimeout(client.close(), 5_000).catch(() => undefined);
  }

  private async workflow<T>(
    name: string,
    args: object,
    emptyResults: unknown,
    parse: (raw: unknown) => T,
  ): Promise<T> {
    try {
      await assertHackathonBaseUrl();
      const raw = await this.callTool(name, compact(args), true);
      return parse(raw);
    } catch (error) {
      const code = error instanceof BaseUrlError ? "BASE_URL" : error instanceof CallTimeoutError ? "TIMEOUT" : installCode(error);
      const retryable = error instanceof CallTimeoutError || code === "MCP_DISCONNECTED";
      return parse(workflowError(code, retryable, emptyResults));
    }
  }

  private async callTool(name: string, args: Record<string, unknown>, restart: boolean): Promise<unknown> {
    return this.limit.run(async () => {
      try {
        return await this.once(name, args);
      } catch (error) {
        if (!restart || error instanceof CallTimeoutError || !isDisconnect(error)) throw error;
        await this.reset();
        return await this.once(name, args);
      }
    });
  }

  private async once(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.ensure();
    const result = (await withTimeout(
      client.callTool({ name, arguments: args }),
      this.timeoutMs,
    )) as ToolResult;
    return readMcpPayload(result);
  }

  private async ensure(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    const launch = resolveQlooLaunch();
    const transport = new StdioClientTransport({
      command: launch.command,
      args: qlooArgs(launch, ["mcp"]),
      env: childEnv(),
      stderr: "ignore",
    });
    const client = new Client({ name: "overindex", version: "0.1.0" });
    try {
      await withTimeout(client.connect(transport), this.timeoutMs);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
    this.client = client;
    return client;
  }

  private async reset(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    if (client) await client.close().catch(() => undefined);
  }
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string" || key === "DEBUG" || key === "NODE_DEBUG") continue;
    env[key] = value;
  }
  return env;
}

function compact(args: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function readMcpPayload(result: ToolResult): unknown {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = result.content?.find((block) => block.type === "text")?.text;
  if (typeof text === "string" && text.trim()) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { error: { code: "MCP_BAD_PAYLOAD", retryable: false } };
    }
  }
  return { error: { code: result.isError ? "MCP_TOOL_ERROR" : "MCP_EMPTY", retryable: false } };
}

function adapterReady(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const adapter = (payload as { adapter?: { ready?: unknown } }).adapter;
  return !!adapter && typeof adapter === "object" && adapter.ready === true;
}

function installCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
    return "QLOO_NOT_INSTALLED";
  }
  if (error instanceof Error && error.message === "QLOO_NOT_INSTALLED") return "QLOO_NOT_INSTALLED";
  if (isDisconnect(error)) return "MCP_DISCONNECTED";
  return "QLOO_CALL_FAILED";
}

function isDisconnect(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === "EPIPE" || code === "ECONNRESET") return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /EPIPE|ECONNRESET|connection closed/i.test(message);
}

const sharedKey = Symbol.for("overindex.qloo.mcp");

type SharedSlot = { client?: McpQlooClient };

export function getSharedMcpClient(): McpQlooClient {
  const globals = globalThis as typeof globalThis & { [sharedKey]?: SharedSlot };
  globals[sharedKey] ??= {};
  globals[sharedKey].client ??= new McpQlooClient();
  return globals[sharedKey].client;
}

export async function closeSharedMcpClient(): Promise<void> {
  const globals = globalThis as typeof globalThis & { [sharedKey]?: SharedSlot };
  const client = globals[sharedKey]?.client;
  if (!client) return;
  globals[sharedKey]!.client = undefined;
  await client.close();
}
