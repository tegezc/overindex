import { z } from "zod";
import { envelopeStatusSchema, type EnvelopeStatus } from "@/shared/qloo/domain/envelope";
import { provenanceSchema, type Provenance } from "@/shared/qloo/domain/provenance";
import { asRecord, readNumber, readString } from "./records";

export const TASTE_DOMAINS = ["artist", "tv_show", "movie", "book"] as const;

export type TasteDomain = (typeof TASTE_DOMAINS)[number];

export const tasteEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export type TasteEntity = z.infer<typeof tasteEntitySchema>;

export const tasteTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export type TasteTag = z.infer<typeof tasteTagSchema>;

export const demographicRowSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.number().finite().optional(),
});

export type DemographicRow = z.infer<typeof demographicRowSchema>;

export function tasteSectionSchema<T extends z.ZodType>(data: T) {
  return z.object({
    status: envelopeStatusSchema,
    data: data.optional(),
    note: z.string().min(1).optional(),
    provenance: provenanceSchema,
  });
}

export const tasteCardSchema = z.object({
  show: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("podcast"),
  }),
  tags: tasteSectionSchema(z.array(tasteTagSchema)),
  domains: z.object({
    artist: tasteSectionSchema(z.array(tasteEntitySchema)),
    tv_show: tasteSectionSchema(z.array(tasteEntitySchema)),
    movie: tasteSectionSchema(z.array(tasteEntitySchema)),
    book: tasteSectionSchema(z.array(tasteEntitySchema)),
  }),
  demographics: tasteSectionSchema(z.array(demographicRowSchema)).optional(),
});

export type TasteCard = z.infer<typeof tasteCardSchema>;
export type TasteSection<T> = {
  status: EnvelopeStatus;
  data?: T;
  note?: string;
  provenance: Provenance;
};

const SENSITIVE = /politic|religio|health|medic|ethnic|ethnicit|\brace\b|income|financ|sexual/i;
const LABEL_KEYS = ["name", "label", "bucket"];
const VALUE_KEYS = ["affinity", "value", "percent", "percentage", "weight"];
const SKIP_BUCKETS = new Set([
  "entity_id",
  "id",
  "type",
  "subtype",
  "status",
  "popularity",
  "affinity",
  "value",
  "percent",
  "percentage",
  "weight",
  "score",
  "name",
  "label",
  "query",
  "properties",
  "explainability",
  "tags",
  "disambiguation",
  "external",
]);

export function readTasteEntities(results: unknown[], limit = 8): TasteEntity[] {
  const found: TasteEntity[] = [];
  for (const item of results) {
    const record = asRecord(item);
    if (!record) continue;
    const source = asRecord(record.entity) ?? record;
    const id = readString(source, ["entity_id", "id"]);
    const name = readString(source, ["name", "title"]);
    if (!id || !name) continue;
    found.push({ id, name });
  }
  return dedupe(found).slice(0, limit);
}

export function readTasteTags(results: unknown[], limit = 12): TasteTag[] {
  const tags: TasteTag[] = [];
  for (const item of results) collectTags(item, tags);
  return dedupe(tags).slice(0, limit);
}

export function readDemographicRows(results: unknown[], limit = 12): DemographicRow[] {
  const rows: DemographicRow[] = [];
  for (const item of results) collectDemographic(item, rows);
  return rows.slice(0, limit);
}

export function toTasteSection<T>(input: {
  status: EnvelopeStatus;
  items: T[];
  errorCode?: string;
  provenance: Provenance;
  emptyNote: string;
}): TasteSection<T[]> {
  const visible = input.status === "error" ? [] : input.items;
  const status = input.status === "ok" && visible.length === 0 ? "empty" : input.status;
  return {
    status,
    ...(visible.length > 0 ? { data: visible } : { note: input.status === "error" ? input.errorCode ?? "error" : input.emptyNote }),
    provenance: input.provenance,
  };
}

/**
 * Demographics are omitted when Qloo returns nothing.
 * A non-empty payload that this screen cannot list still keeps a status, without invented rows.
 */
export function toDemographicsSection(input: {
  status: EnvelopeStatus;
  results: unknown[];
  errorCode?: string;
  provenance: Provenance;
}): TasteSection<DemographicRow[]> | undefined {
  if (input.status === "error" || input.status === "empty" || input.status === "needs_input") return undefined;
  const rows = input.status === "degraded" || input.status === "partial" || input.status === "ok" ? readDemographicRows(input.results) : [];
  if (rows.length > 0) {
    return { status: input.status, data: rows, provenance: input.provenance };
  }
  if (input.results.length === 0) return undefined;
  return {
    status: input.status,
    note: "Qloo returned aggregate demographics in a shape this screen does not list.",
    provenance: input.provenance,
  };
}

function collectTags(value: unknown, tags: TasteTag[]): void {
  const record = asRecord(value);
  if (!record) return;
  if (Array.isArray(record.tags)) {
    for (const nested of record.tags) collectTags(nested, tags);
    return;
  }
  const name = readString(record, ["name", "label"]);
  if (!name) return;
  const id = readString(record, ["id", "tag_id"]) ?? name;
  tags.push({ id, name });
}

function collectDemographic(value: unknown, rows: DemographicRow[]): void {
  const record = asRecord(value);
  if (!record) return;
  const type = [readString(record, ["type"]), readString(record, ["subtype"])].filter(Boolean).join(" ");
  if (type && SENSITIVE.test(type)) return;
  const grouped = readDemographicGroups(asRecord(record.query));
  if (grouped.length > 0) {
    rows.push(...grouped);
    return;
  }
  const label = readString(record, LABEL_KEYS);
  const query = asRecord(record.query);
  const valueNumber = readNumber(record, VALUE_KEYS) ?? (query ? readNumber(query, VALUE_KEYS) : undefined);
  if (label && !SENSITIVE.test(label) && label.length <= 80) {
    rows.push(valueNumber === undefined ? { label } : { label, value: valueNumber });
    return;
  }
  const buckets = numericBuckets(record);
  if (buckets.length > 0) {
    rows.push(...buckets);
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "query" || key === "properties" || key === "explainability") continue;
    if (asRecord(child) || Array.isArray(child)) collectDemographic(child, rows);
  }
}

function readDemographicGroups(query: Record<string, unknown> | undefined): DemographicRow[] {
  if (!query) return [];
  const rows: DemographicRow[] = [];
  for (const group of ["age", "gender"]) {
    const buckets = asRecord(query[group]);
    if (!buckets) continue;
    for (const row of numericBuckets(buckets)) {
      if (row.value === undefined) continue;
      rows.push({ label: `${group} ${row.label}`, value: row.value });
    }
  }
  return rows;
}

function numericBuckets(record: Record<string, unknown>): DemographicRow[] {
  const buckets = Object.entries(record).filter(
    ([key, value]) => !SKIP_BUCKETS.has(key) && typeof value === "number" && Number.isFinite(value),
  );
  return buckets.flatMap(([key, value]) => {
    const label = key.replace(/_/g, " ");
    if (SENSITIVE.test(label) || label.length > 80 || typeof value !== "number") return [];
    return [{ label, value }];
  });
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
