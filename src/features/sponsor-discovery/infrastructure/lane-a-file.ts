import { readFileSync } from "node:fs";
import { parseCsv } from "@/shared/csv/parse-csv";
import { normalizeBrandName } from "../domain/names";

export { parseCsv };

export type LaneACatalog = {
  names: string[];
  normalized: Set<string>;
};

export function loadLaneACatalog(csvPath: string): LaneACatalog {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const header = rows[0]?.[0]?.trim();
  if (header !== "brand_norm") throw new Error("lane A file is missing the brand_norm column");
  const names: string[] = [];
  const normalized = new Set<string>();
  for (const row of rows.slice(1)) {
    const name = row[0]?.trim();
    const key = name ? normalizeBrandName(name) : "";
    if (!name || !key || normalized.has(key)) continue;
    names.push(name);
    normalized.add(key);
  }
  return { names, normalized };
}
