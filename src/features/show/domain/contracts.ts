import { z } from "zod";
import { envelopeStatusSchema } from "@/shared/qloo/domain/envelope";
import { tasteCardSchema } from "./taste-card";

export const podcastCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal("podcast"),
  description: z.string().min(1).optional(),
});

export const resolveModeSchema = z.enum(["direct", "proxy_suggestions", "tags_only"]);

export const resolveRequestSchema = z.object({
  query: z.string().trim().min(1).max(200),
});

export const resolveResponseSchema = z.object({
  status: envelopeStatusSchema,
  candidates: z.array(podcastCandidateSchema),
  mode: resolveModeSchema,
  errorCode: z.string().min(1).optional(),
});

export const profileRequestSchema = z.object({
  entityId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
});

export type ResolveResponse = z.infer<typeof resolveResponseSchema>;
export type ProfileRequest = z.infer<typeof profileRequestSchema>;

export { tasteCardSchema };
