import { z } from "zod";
import { provenanceSchema, type Provenance } from "@/shared/qloo/domain/provenance";

export const evidenceKindSchema = z.enum(["score", "lift", "bridge", "trend", "tag", "user_input"]);

export const evidenceSchema = z.object({
  id: z.string().min(1),
  kind: evidenceKindSchema,
  label: z.string().min(1),
  value: z.union([z.number(), z.string()]).optional(),
  provenance: provenanceSchema.optional(),
});

export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;

export const claimSourceSchema = z.enum(["qloo", "user_input"]);

export const pitchClaimSchema = z.object({
  text: z.string().min(1),
  source: claimSourceSchema,
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export type PitchClaim = z.infer<typeof pitchClaimSchema>;

export const pitchDraftSchema = z.object({
  brandId: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  talkingPoints: z.array(z.string().min(1)),
  claims: z.array(pitchClaimSchema),
  check: z.object({
    passed: z.boolean(),
    rejected: z.array(
      z.object({
        text: z.string().min(1),
        reason: z.string().min(1),
      }),
    ),
  }),
});

export type PitchDraft = z.infer<typeof pitchDraftSchema>;

export type UncheckedPitch = Omit<PitchDraft, "check">;

/** Visible pitch label. Qloo for taste-graph evidence, input Anda for what the user typed. */
export function claimSourceLabel(source: PitchClaim["source"]): "Qloo" | "input Anda" {
  return source === "user_input" ? "input Anda" : "Qloo";
}

export function formatEvidenceNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  const digits = Math.abs(value) !== 0 && Math.abs(value) < 0.0001 ? 6 : 4;
  const text = value.toFixed(digits).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

export function derivedProvenance(input: {
  reportId: string;
  brandId: string;
  field: string;
  at: string;
  note: string;
  tool?: string;
}): Provenance {
  return provenanceSchema.parse({
    callId: `derived:${input.reportId}:${input.brandId}:${input.field}`,
    tool: input.tool ?? "derived:scoring",
    params: { field: input.field, note: input.note },
    at: input.at,
    status: "ok",
    cached: true,
  });
}
