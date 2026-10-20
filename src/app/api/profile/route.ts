import { ZodError } from "zod";
import { showProfile } from "@/features/show/application/show-profile";
import { profileRequestSchema } from "@/features/show/domain/contracts";
import { createRequestQloo } from "@/shared/runtime/request-services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_JSON", "Request body must be JSON", 400);
  }
  const parsed = profileRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError("INVALID_INPUT", "entityId and name are required", 400);
  try {
    const qloo = createRequestQloo();
    const card = await showProfile({ id: parsed.data.entityId, name: parsed.data.name }, qloo);
    return Response.json(card);
  } catch (error) {
    if (error instanceof ZodError) return jsonError("INVALID_INPUT", "entityId and name are required", 400);
    return jsonError("PROFILE_FAILED", "Show profile failed", 500);
  }
}

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}
