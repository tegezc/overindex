import { getReportBoard } from "@/features/report/application/execute-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = getReportBoard().get(id);
  if (!run) return jsonError("NOT_FOUND", "No report with that id is on this server.", 404);
  return Response.json(run.report);
}

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}
