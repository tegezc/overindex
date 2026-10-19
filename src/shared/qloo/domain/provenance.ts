import { z } from "zod";
import { envelopeStatusSchema } from "./envelope";

export const provenanceSchema = z.object({
  callId: z.string().min(1),
  tool: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  at: z.string().min(1),
  status: envelopeStatusSchema,
  cached: z.boolean(),
});

export type Provenance = z.infer<typeof provenanceSchema>;

export type QlooCall<T> = {
  data: T;
  provenance: Provenance;
};

const SECRET_KEY = /api[_-]?key|authorization|secret|token|password|credential/i;

export function redactParams(value: unknown): Record<string, unknown> {
  const redacted = redactValue(value);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return { value: redacted };
  return redacted as Record<string, unknown>;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (inner === undefined) continue;
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : redactValue(inner);
  }
  return out;
}
