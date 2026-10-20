import { readFileSync } from "node:fs";
import { normalizeBrandName } from "../domain/names";

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

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quoted) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}
