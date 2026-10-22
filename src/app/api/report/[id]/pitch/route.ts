import { z } from "zod";
import { BrandLookupError, pitchForRequest } from "@/features/pitch/application/open-brand";
import { loadReport } from "@/features/report/application/load-report";

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
  const located = await loadReport(id);
  if (!located) return jsonError("NOT_FOUND", "No report with that id is on this server.", 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_JSON", "Request body must be JSON", 400);
  }
  const parsed = pitchRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", "brandId is required", 400);
  try {
    const pitch = await pitchForRequest(id, parsed.data.brandId, parsed.data.userInputs);
    return Response.json(pitch);
  } catch (error) {
    if (error instanceof BrandLookupError) {
      if (error.code === "NOT_FOUND") return jsonError("NOT_FOUND", "No report with that id is on this server.", 404);
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
