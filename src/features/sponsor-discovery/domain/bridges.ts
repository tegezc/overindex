import { asRecord, readString } from "./records";

export const BRIDGE_COUNT_LABEL = "Shared TV show count";
export const BRIDGE_TITLES_LABEL = "Shared TV show titles";
export const BRIDGE_SHOW_CALL_LABEL = "TV recommendations for the show";
export const BRIDGE_BRAND_CALL_LABEL = "TV recommendations for the brand";

export type BridgeTitle = {
  id: string;
  name: string;
};

/** Ids that appear in both TV recommendation lists. Order follows the show list. */
export function intersectBridgeTitles(
  showTitles: readonly BridgeTitle[],
  brandTitles: readonly BridgeTitle[],
): BridgeTitle[] {
  const brandIds = new Set(brandTitles.map((title) => title.id));
  const seen = new Set<string>();
  const shared: BridgeTitle[] = [];
  for (const title of showTitles) {
    if (!brandIds.has(title.id) || seen.has(title.id)) continue;
    seen.add(title.id);
    shared.push(title);
  }
  return shared;
}

export function readBridgeTitles(results: readonly unknown[], limit = 20): BridgeTitle[] {
  const found: BridgeTitle[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    const record = asRecord(item);
    if (!record) continue;
    const source = asRecord(record.entity) ?? record;
    const id = readString(source, ["entity_id", "id"]);
    const name = readString(source, ["name", "title"]);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    found.push({ id, name });
    if (found.length >= limit) break;
  }
  return found;
}
