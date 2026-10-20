import { asRecord, readString } from "./records";
import { selectNamed } from "./names";

const NOT_BRAND = new Set([
  "podcast",
  "artist",
  "movie",
  "tv_show",
  "book",
  "person",
  "place",
  "destination",
  "videogame",
  "video_game",
  "locality",
]);

export type BrandHit = { id: string; name: string };

/**
 * Picks a brand only when its name matches the query.
 * An `ok` result whose name does not match is not accepted: the spike resolved some short names onto the wrong entity.
 */
export function selectBrand(envelope: unknown, query: string): BrandHit | undefined {
  return selectNamed(query, collectBrands(envelope));
}

function collectBrands(envelope: unknown): BrandHit[] {
  const root = asRecord(envelope);
  if (!root) return [];
  const found: BrandHit[] = [];
  pushList(found, root.results);
  const resolution = asRecord(root.resolution);
  if (!resolution) return dedupe(found);
  if (Array.isArray(resolution.issues)) {
    for (const issue of resolution.issues) {
      const record = asRecord(issue);
      if (record) pushList(found, record.candidates);
    }
  }
  if (Array.isArray(resolution.outcomes)) {
    for (const outcome of resolution.outcomes) {
      const record = asRecord(outcome);
      if (!record) continue;
      pushOne(found, record.selected);
      pushList(found, record.alternatives);
      pushList(found, record.candidates);
    }
  }
  return dedupe(found);
}

function pushList(found: BrandHit[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) pushOne(found, item);
}

function pushOne(found: BrandHit[], value: unknown): void {
  const record = asRecord(value);
  if (!record) return;
  const id = readString(record, ["entity_id", "id"]);
  const name = readString(record, ["name"]);
  if (!id || !name || !isBrand(readString(record, ["type", "subtype"]))) return;
  found.push({ id, name });
}

function isBrand(type: string | undefined): boolean {
  if (!type) return true;
  const value = type.toLowerCase();
  if (value.includes("brand")) return true;
  if (value.startsWith("urn:")) return false;
  return !NOT_BRAND.has(value);
}

function dedupe(found: BrandHit[]): BrandHit[] {
  const seen = new Set<string>();
  const out: BrandHit[] = [];
  for (const hit of found) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push(hit);
  }
  return out;
}
