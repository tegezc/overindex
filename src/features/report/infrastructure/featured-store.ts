import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { featuredDateSchema, featuredSummary, type FeaturedSummary } from "../domain/featured";
import { reportSchema, type Report } from "../domain/report";

const storedSchema = z.object({
  dataDate: featuredDateSchema,
  report: reportSchema,
});

/**
 * Featured reports live at `CACHE_DIR/featured/<id>.json`.
 * The file is the product report plus a calendar dataDate. It is not a raw Qloo body.
 * The directory stays outside the repo or git-ignored.
 */
export async function writeFeatured(cacheDir: string, report: Report, dataDate: string): Promise<FeaturedSummary> {
  const summary = featuredSummary(report, dataDate);
  const dir = path.join(cacheDir, "featured");
  await mkdir(dir, { recursive: true });
  const file = filePath(dir, summary.id);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ dataDate: summary.dataDate, report }), "utf8");
  await rename(tmp, file);
  return summary;
}

export async function listFeatured(cacheDir: string): Promise<FeaturedSummary[]> {
  const dir = path.join(cacheDir, "featured");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const items: FeaturedSummary[] = [];
  for (const name of names) {
    const stored = await readStored(dir, name);
    if (stored) items.push(stored.summary);
  }
  items.sort((a, b) => b.dataDate.localeCompare(a.dataDate) || a.title.localeCompare(b.title));
  return items;
}

export async function readFeaturedReport(cacheDir: string, id: string): Promise<Report | undefined> {
  if (!z.uuid().safeParse(id).success) return undefined;
  const stored = await readStored(path.join(cacheDir, "featured"), `${id}.json`);
  return stored?.report;
}

async function readStored(dir: string, name: string): Promise<{ summary: FeaturedSummary; report: Report } | undefined> {
  if (!name.endsWith(".json")) return undefined;
  const id = name.slice(0, -".json".length);
  if (!z.uuid().safeParse(id).success) return undefined;
  let text: string;
  try {
    text = await readFile(filePath(dir, id), "utf8");
  } catch {
    return undefined;
  }
  const parsed = storedSchema.safeParse(safeJson(text));
  if (!parsed.success || parsed.data.report.id !== id) return undefined;
  return { summary: featuredSummary(parsed.data.report, parsed.data.dataDate), report: parsed.data.report };
}

function filePath(dir: string, id: string): string {
  if (!z.uuid().safeParse(id).success) throw new Error("invalid featured id");
  return path.join(dir, `${id}.json`);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
