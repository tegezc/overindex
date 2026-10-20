import { z } from "zod";
import { brandCandidateSchema, type BrandCandidate } from "@/features/sponsor-discovery/domain/types";
import { tasteCardSchema, type TasteCard } from "@/features/show/domain/taste-card";
import { envelopeStatusSchema } from "@/shared/qloo/domain/envelope";
import { traceEventSchema, type TraceEvent } from "@/shared/trace/trace";

export const sectionStatusSchema = z.union([envelopeStatusSchema, z.enum(["pending", "skipped"])]);

export type SectionStatus = z.infer<typeof sectionStatusSchema>;

export function sectionSchema<T extends z.ZodType>(data: T) {
  return z.object({
    status: sectionStatusSchema,
    data: data.optional(),
    note: z.string().min(1).optional(),
  });
}

export type Section<T> = {
  status: SectionStatus;
  data?: T;
  note?: string;
};

const namedBrandSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
});

export type NamedBrand = z.infer<typeof namedBrandSchema>;

export const reportSectionNameSchema = z.enum(["tasteCard", "candidates", "withoutQloo"]);

export type ReportSectionName = z.infer<typeof reportSectionNameSchema>;

export const showModeSchema = z.enum(["direct", "proxy", "tags_only"]);

export type ShowMode = z.infer<typeof showModeSchema>;

export const reportInputSchema = z.object({
  showQuery: z.string().trim().min(1).max(200),
  currentSponsors: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  excludedCategories: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  sizePreference: z.array(z.enum(["challenger", "established", "household"])).max(3).optional(),
  demographics: z
    .object({
      ageBands: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
      gender: z.string().trim().min(1).max(40).optional(),
    })
    .optional(),
  business: z
    .object({
      downloadsPerEpisode: z.number().nonnegative().optional(),
      cpm: z.number().nonnegative().optional(),
    })
    .optional(),
});

export type ReportInput = z.infer<typeof reportInputSchema>;

export const reportRequestSchema = z.object({
  input: reportInputSchema,
  showId: z.string().trim().min(1).max(80).optional(),
  proxyIds: z.array(z.string().trim().min(1).max(80)).max(5).optional(),
});

export type ReportRequest = z.infer<typeof reportRequestSchema>;

export const reportAcceptedSchema = z.object({
  reportId: z.uuid(),
});

const entityRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal("podcast"),
});

export const showContextSchema = z.object({
  mode: showModeSchema,
  show: entityRefSchema.optional(),
  proxies: z.array(entityRefSchema).optional(),
  tags: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  description: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]),
});

export type ShowContext = z.infer<typeof showContextSchema>;

export const reportSchema = z.object({
  id: z.uuid(),
  createdAt: z.string().min(1),
  input: reportInputSchema,
  context: showContextSchema,
  sections: z.object({
    tasteCard: sectionSchema(tasteCardSchema),
    candidates: sectionSchema(z.array(brandCandidateSchema)),
    withoutQloo: sectionSchema(z.array(namedBrandSchema)),
  }),
  evidence: z.record(z.string(), z.unknown()),
  budget: z.object({
    used: z.number().int().nonnegative(),
    target: z.number().int().positive(),
    cap: z.number().int().positive(),
  }),
  trace: z.array(traceEventSchema),
});

export type Report = z.infer<typeof reportSchema>;

export const sectionEventSchema = z.object({
  name: reportSectionNameSchema,
  section: sectionSchema(z.unknown()),
});

export type SectionEvent = {
  name: ReportSectionName;
  section: Section<unknown>;
};

export type ReportStreamEvent =
  | { event: "trace"; data: TraceEvent }
  | { event: "section"; data: SectionEvent }
  | { event: "budget"; data: Report["budget"] }
  | { event: "done"; data: { reportId: string } }
  | { event: "error"; data: { code: string; message: string } };

export function pendingSection(): Section<never> {
  return { status: "pending" };
}

export function notedSection(status: SectionStatus, note: string): Section<never> {
  return { status, note };
}

/** Lane B is hidden only in tags-only mode. Other modes follow the shortlist status. */
export function laneBStatus(mode: ShowMode, candidates: SectionStatus): SectionStatus {
  if (mode === "tags_only") return "skipped";
  return candidates;
}

export function confidenceFor(sections: Report["sections"]): ShowContext["confidence"] {
  const statuses = [sections.tasteCard.status, sections.candidates.status, sections.withoutQloo.status];
  if (statuses.some((status) => status === "error" || status === "pending")) return "low";
  if (statuses.some((status) => status === "partial" || status === "degraded" || status === "empty" || status === "needs_input")) {
    return "medium";
  }
  return "high";
}

export function tasteCardSection(card: TasteCard): Section<TasteCard> {
  const parts = [card.tags, card.domains.artist, card.domains.tv_show, card.domains.movie, card.domains.book];
  if (parts.every((part) => part.status === "error")) {
    const code = parts.map((part) => part.note).find((note) => note && note !== "error");
    const detail = code ? ` (${code})` : "";
    return {
      status: "error",
      data: card,
      note: `Qloo returned an error for the taste card${detail}.`,
    };
  }
  if (parts.some((part) => part.status === "error" || part.status === "partial" || part.status === "degraded")) {
    return { status: "partial", data: card, note: "At least one taste-card section is incomplete." };
  }
  if (parts.every((part) => part.status === "empty")) {
    return { status: "empty", data: card, note: "Qloo returned no taste-card entities." };
  }
  return { status: "ok", data: card };
}

export function splitLanes(candidates: readonly BrandCandidate[]): { laneA: BrandCandidate[]; laneB: BrandCandidate[] } {
  return {
    laneA: candidates.filter((candidate) => candidate.lane === "A"),
    laneB: candidates.filter((candidate) => candidate.lane === "B"),
  };
}
