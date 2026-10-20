import { ZodError } from "zod";
import { clientAddress } from "@/features/report/application/client-address";
import { createReportServices, startReport } from "@/features/report/application/execute-report";
import { takeLiveSlot } from "@/features/report/application/live-quota-store";
import { reportRequestSchema } from "@/features/report/domain/report";
import { EnvError, getEnv } from "@/shared/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_JSON", "Request body must be JSON", 400);
  }
  const parsed = reportRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", "input.showQuery is required", 400);
  try {
    const env = getEnv();
    const decision = takeLiveSlot(clientAddress(request), {
      perIp: env.LIVE_REPORTS_PER_IP_PER_DAY,
      global: env.LIVE_REPORTS_GLOBAL_PER_DAY,
    });
    if (!decision.allowed) return jsonError("RATE_LIMIT", decision.message ?? "Open a featured report instead.", 429);
    const run = startReport(parsed.data, createReportServices(env));
    return Response.json({ reportId: run.report.id }, { status: 202 });
  } catch (error) {
    if (error instanceof ZodError) return jsonError("INVALID_INPUT", "input.showQuery is required", 400);
    if (error instanceof EnvError) return jsonError("INVALID_ENV", "The server environment is incomplete.", 500);
    return jsonError("REPORT_FAILED", "The report could not be started.", 500);
  }
}

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}
