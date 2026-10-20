import { readFileSync } from "node:fs";
import { parseCsv } from "@/shared/csv/parse-csv";
import type { Split, Tier } from "./protocol";

export type ShowRecord = {
  showId: string;
  name: string;
  tier: Tier;
  genre: string;
  appleUrl: string;
  rssUrl: string;
  description: string;
  descriptionUrl: string;
  appleRatings: number;
  curatedOn: string;
  split: Split;
};

export type GroundTruthRecord = {
  showId: string;
  brandRaw: string;
  brandNorm: string;
  episodeUrl: string;
  episodeDate: string;
  adType: "host_read" | "unclear";
  seenBeforeCutoff: "yes" | "no" | "unknown";
};

export type BrandNormalizationRecord = {
  brandRaw: string;
  brandNorm: string;
  note: string;
};

export type SponsorMention = {
  showId: string;
  brandNorm: string;
};

const SHOW_COLUMNS = [
  "show_id",
  "name",
  "tier",
  "genre",
  "apple_url",
  "rss_url",
  "description",
  "description_url",
  "apple_ratings",
  "curated_on",
  "split",
] as const;

const GROUND_TRUTH_COLUMNS = [
  "show_id",
  "brand_raw",
  "brand_norm",
  "episode_url",
  "episode_date",
  "ad_type",
  "seen_before_cutoff",
] as const;

const BRAND_NORM_COLUMNS = ["brand_raw", "brand_norm", "note"] as const;

export function parseShowsCsv(text: string): ShowRecord[] {
  return table(text, SHOW_COLUMNS).map(({ line, cells }) => ({
    showId: required(cells, "show_id", line),
    name: required(cells, "name", line),
    tier: oneOf(cells, "tier", line, ["besar", "mid"] as const),
    genre: required(cells, "genre", line),
    appleUrl: required(cells, "apple_url", line),
    rssUrl: required(cells, "rss_url", line),
    description: required(cells, "description", line),
    descriptionUrl: required(cells, "description_url", line),
    appleRatings: integerCell(cells, "apple_ratings", line),
    curatedOn: dateCell(cells, "curated_on", line),
    split: oneOf(cells, "split", line, ["dev", "test"] as const),
  }));
}

export function parseGroundTruthCsv(text: string): GroundTruthRecord[] {
  return table(text, GROUND_TRUTH_COLUMNS).map(({ line, cells }) => ({
    showId: required(cells, "show_id", line),
    brandRaw: required(cells, "brand_raw", line),
    brandNorm: required(cells, "brand_norm", line),
    episodeUrl: required(cells, "episode_url", line),
    episodeDate: dateCell(cells, "episode_date", line),
    adType: oneOf(cells, "ad_type", line, ["host_read", "unclear"] as const),
    seenBeforeCutoff: oneOf(cells, "seen_before_cutoff", line, ["yes", "no", "unknown"] as const),
  }));
}

export function parseBrandNormalizationCsv(text: string): BrandNormalizationRecord[] {
  return table(text, BRAND_NORM_COLUMNS).map(({ line, cells }) => ({
    brandRaw: required(cells, "brand_raw", line),
    brandNorm: required(cells, "brand_norm", line),
    note: cells.note ?? "",
  }));
}

export function loadShowsCsv(filePath: string): ShowRecord[] {
  return parseShowsCsv(stripBom(readFileSync(filePath, "utf8")));
}

/** Reads the frozen CSV. Loading it does not score a show. */
export function loadGroundTruthCsv(filePath: string): GroundTruthRecord[] {
  return parseGroundTruthCsv(stripBom(readFileSync(filePath, "utf8")));
}

export function mentionsFromGroundTruth(rows: readonly GroundTruthRecord[]): SponsorMention[] {
  return rows.map((row) => ({ showId: row.showId, brandNorm: row.brandNorm }));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function table<const Columns extends readonly string[]>(
  text: string,
  columns: Columns,
): { line: number; cells: Record<Columns[number], string> }[] {
  const parsed = parseCsv(stripBom(text));
  const header = parsed[0];
  if (!header || header.length !== columns.length || columns.some((name, index) => header[index]?.trim() !== name)) {
    throw new Error(`expected columns ${columns.join(",")}`);
  }
  return parsed.slice(1).map((row, index) => {
    const line = index + 2;
    if (row.length !== columns.length) throw new Error(`row ${line} has ${row.length} columns`);
    const cells = {} as Record<Columns[number], string>;
    columns.forEach((name, cellIndex) => {
      cells[name as Columns[number]] = (row[cellIndex] ?? "").trim();
    });
    return { line, cells };
  });
}

function required(cells: Record<string, string>, name: string, line: number): string {
  const value = cells[name]?.trim() ?? "";
  if (!value) throw new Error(`row ${line} is missing ${name}`);
  return value;
}

function oneOf<T extends string>(cells: Record<string, string>, name: string, line: number, allowed: readonly T[]): T {
  const value = required(cells, name, line);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`row ${line} has ${name} ${value}`);
  }
  return value as T;
}

function integerCell(cells: Record<string, string>, name: string, line: number): number {
  const value = required(cells, name, line);
  if (!/^\d+$/.test(value)) throw new Error(`row ${line} has a non-integer ${name}`);
  return Number.parseInt(value, 10);
}

function dateCell(cells: Record<string, string>, name: string, line: number): string {
  const value = required(cells, name, line);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`row ${line} has ${name} ${value}`);
  return value;
}
