import { z } from "zod";
import { evidenceSchema } from "./evidence";

export const scoreRowSchema = z.object({
  evidenceId: z.string().min(1),
  label: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  source: z.enum(["qloo", "computed"]),
});

export type ScoreRow = z.infer<typeof scoreRowSchema>;

const bridgeTitleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const sectionStatusSchema = z.enum([
  "ok",
  "empty",
  "needs_input",
  "partial",
  "degraded",
  "error",
  "pending",
  "skipped",
]);

export const brandDrawerSchema = z.object({
  brandId: z.string().min(1),
  scores: z.array(scoreRowSchema),
  bridges: z.object({
    status: sectionStatusSchema,
    data: z.array(bridgeTitleSchema).optional(),
    note: z.string().min(1).optional(),
  }),
  momentum: z.object({
    status: z.literal("skipped"),
    note: z.string().min(1),
  }),
  evidence: z.array(evidenceSchema),
  budget: z.object({
    used: z.number().int().nonnegative(),
    target: z.number().int().positive(),
    cap: z.number().int().positive(),
  }),
  categoryNote: z.string().min(1).optional(),
});

export type BrandDrawer = z.infer<typeof brandDrawerSchema>;

export const MOMENTUM_SKIPPED = {
  status: "skipped" as const,
  note: "Trend badge is skipped.",
};
