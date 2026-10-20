import { z } from "zod";
import { showModeSchema, type Report } from "./report";

export const featuredDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const featuredSummarySchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  dataDate: featuredDateSchema,
  mode: showModeSchema,
});

export type FeaturedSummary = z.infer<typeof featuredSummarySchema>;

export function featuredSummary(report: Report, dataDate: string): FeaturedSummary {
  return featuredSummarySchema.parse({
    id: report.id,
    title: report.context.show?.name ?? report.input.showQuery,
    dataDate,
    mode: report.context.mode,
  });
}

/** Highest fit first. Missing fit sorts last. Names break ties. */
export function topBrands<T extends { fit?: number; brand: { name: string } }>(candidates: readonly T[], limit = 5): T[] {
  return [...candidates]
    .sort((a, b) => (b.fit ?? Number.NEGATIVE_INFINITY) - (a.fit ?? Number.NEGATIVE_INFINITY) || a.brand.name.localeCompare(b.brand.name))
    .slice(0, limit);
}
