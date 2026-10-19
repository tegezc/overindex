import { getEnv } from "@/shared/config/env";
import { buildHealth } from "@/shared/health/health";
import { probeQloo } from "@/shared/health/probe-qloo";
import { assertHackathonBaseUrl } from "@/shared/qloo/infrastructure/base-url";
import { getSharedMcpClient } from "@/shared/qloo/infrastructure/mcp-qloo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  const qloo = await probeQloo({
    assertBaseUrl: assertHackathonBaseUrl,
    capabilities: () => getSharedMcpClient().capabilities(),
  });
  return Response.json(buildHealth(env, qloo));
}
