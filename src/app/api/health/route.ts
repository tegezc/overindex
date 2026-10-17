import { getEnv } from "@/shared/config/env";
import { buildHealth } from "@/shared/health/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(buildHealth(getEnv()));
}
