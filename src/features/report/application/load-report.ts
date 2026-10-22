import type { Report } from "../domain/report";
import { featuredCacheDir } from "./cache-dir";
import { getReportBoard, type ReportRun } from "./execute-report";
import { readFeaturedReport } from "../infrastructure/featured-store";

export type LoadedReport =
  | { kind: "memory"; run: ReportRun }
  | { kind: "stored"; report: Report };

/**
 * Memory first. A featured file is the fallback when this process never ran that report.
 * Reading the file does not call Qloo.
 */
export async function loadReport(
  id: string,
  readStored: (id: string) => Promise<Report | undefined> = (reportId) => readFeaturedReport(featuredCacheDir(), reportId),
): Promise<LoadedReport | undefined> {
  const run = getReportBoard().get(id);
  if (run) return { kind: "memory", run };
  const report = await readStored(id);
  if (!report) return undefined;
  return { kind: "stored", report };
}
