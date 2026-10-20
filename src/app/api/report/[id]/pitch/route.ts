import { z } from "zod";
import { BrandLookupError, openBrand, pitchBrand } from "@/features/pitch/application/open-brand";
import { getReportBoard } from "@/features/report/application/execute-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pitchRequestSchema = z.object({
  brandId: z.string().trim().min(1).max(80),
  userInputs: z
    .object({
      downloadsPerEpisode: z.number().nonnegative().optional(),
      cpm: z.number().nonnegative().optional(),
    })
    .optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = getReportBoard().get(id);
  if (!run) return jsonError("NOT_FOUND", "No report with that id is on this server.", 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_JSON", "Request body must be JSON", 400);
  }
  const parsed = pitchRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", "brandId is required", 400);
  try {
    const drawer = await openBrand(run, parsed.data.brandId);
    const candidate = run.report.sections.candidates.data?.find((item) => item.brand.id === parsed.data.brandId);
    if (!candidate) return jsonError("BRAND_NOT_FOUND", "That brand is not on this report.", 404);
    const pitch = pitchBrand({
      reportId: run.report.id,
      brandId: parsed.data.brandId,
      brandName: candidate.brand.name,
      evidence: drawer.evidence,
      business: parsed.data.userInputs ?? run.report.input.business,
    });
    return Response.json(pitch);
  } catch (error) {
    if (error instanceof BrandLookupError) {
      if (error.code === "NOT_READY") return jsonError("BRAND_NOT_READY", "The shortlist is not ready.", 409);
      if (error.code === "NOT_ON_REPORT") return jsonError("BRAND_NOT_FOUND", "That brand is not on this report.", 404);
      return jsonError("BRAND_UNAVAILABLE", "This report cannot load brand evidence on this server.", 500);
    }
    return jsonError("PITCH_FAILED", "The pitch could not be drafted.", 500);
  }
}

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}
