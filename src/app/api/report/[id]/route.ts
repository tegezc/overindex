import { featuredCacheDir } from "@/features/report/application/cache-dir";
import { getReportBoard } from "@/features/report/application/execute-report";
import { readFeaturedReport } from "@/features/report/infrastructure/featured-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = getReportBoard().get(id);
  if (run) return Response.json(run.report);
  const stored = await readFeaturedReport(featuredCacheDir(), id);
  if (!stored) return jsonError("NOT_FOUND", "No report with that id is on this server.", 404);
  return Response.json(stored);
}

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}
