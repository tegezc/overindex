import type { InsightEntity } from "@/shared/qloo/domain/envelope";
import { asRecord, readString } from "./records";
import type { CategoryLabel } from "./types";

export type InsightBrand = {
  id: string;
  name: string;
  popularity?: number;
  affinity?: number;
  categories: CategoryLabel[];
};

export function readInsightBrands(entities: readonly InsightEntity[]): InsightBrand[] {
  const out: InsightBrand[] = [];
  for (const entity of entities) {
    const id = entity.entity_id?.trim();
    const name = entity.name?.trim();
    if (!id || !name) continue;
    const popularity = typeof entity.popularity === "number" && Number.isFinite(entity.popularity) ? entity.popularity : undefined;
    const affinity =
      typeof entity.query?.affinity === "number" && Number.isFinite(entity.query.affinity) ? entity.query.affinity : undefined;
    out.push({
      id,
      name,
      ...(popularity !== undefined ? { popularity } : {}),
      ...(affinity !== undefined ? { affinity } : {}),
      categories: readTagLabels(entity.tags).map((label) => ({ label, source: "qloo_tags" as const })),
    });
  }
  return out;
}

export function readTagLabels(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const labels: string[] = [];
  for (const tag of tags) {
    if (typeof tag === "string" && tag.trim()) {
      labels.push(tag.trim());
      continue;
    }
    const record = asRecord(tag);
    if (!record) continue;
    const label = readString(record, ["name", "label", "title"]);
    if (label) labels.push(label);
  }
  return labels;
}
