import { BrandLookupError, openBrand } from "@/features/pitch/application/open-brand";
import { getReportBoard } from "@/features/report/application/execute-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; brandId: string }> }) {
  const { id, brandId } = await context.params;
  const run = getReportBoard().get(id);
  if (!run) return jsonError("NOT_FOUND", "No report with that id is on this server.", 404);
  try {
    const drawer = await openBrand(run, brandId);
    return Response.json(drawer);
  } catch (error) {
    return brandError(error);
  }
}

function brandError(error: unknown) {
  if (error instanceof BrandLookupError) {
    if (error.code === "NOT_READY") return jsonError("BRAND_NOT_READY", "The shortlist is not ready.", 409);
    if (error.code === "NOT_ON_REPORT") return jsonError("BRAND_NOT_FOUND", "That brand is not on this report.", 404);
    return jsonError("BRAND_UNAVAILABLE", "This report cannot load brand evidence on this server.", 500);
  }
  return jsonError("BRAND_FAILED", "Brand evidence could not be loaded.", 500);
}

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}
