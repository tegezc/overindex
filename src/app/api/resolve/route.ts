import { ZodError } from "zod";
import { resolveShow } from "@/features/show/application/resolve-show";
import { resolveRequestSchema } from "@/features/show/domain/contracts";
import { createRequestLlm, createRequestQloo } from "@/shared/runtime/request-services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_JSON", "Request body must be JSON", 400);
  }
  const parsed = resolveRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", "query is required", 400);
  try {
    const qloo = createRequestQloo();
    const llm = createRequestLlm();
    const result = await resolveShow(parsed.data.query, {
      describe: (input) => qloo.describe(input),
      disambiguate: (input) => llm.disambiguateShow(input),
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof ZodError) return jsonError("INVALID_INPUT", "query is required", 400);
    return jsonError("RESOLVE_FAILED", "Show resolve failed", 500);
  }
}

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}
