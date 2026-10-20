import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { topBrands } from "../domain/featured";
import { reportSchema, type Report } from "../domain/report";
import { listFeatured, readFeaturedReport, writeFeatured } from "./featured-store";

const NORTH = "11111111-1111-4111-8111-111111111111";
const RIDGE = "22222222-2222-4222-8222-222222222222";

describe("featured store", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("writes a report with a data date and lists it without the body", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "overindex-featured-"));
    const summary = await writeFeatured(dir, fixture(NORTH, "Show North", "direct"), "2026-10-17");
    expect(summary).toEqual({ id: NORTH, title: "Show North", dataDate: "2026-10-17", mode: "direct" });
    await writeFeatured(dir, fixture(RIDGE, "Show Ridge", "proxy"), "2026-10-18");
    expect(await listFeatured(dir)).toEqual([
      { id: RIDGE, title: "Show Ridge", dataDate: "2026-10-18", mode: "proxy" },
      { id: NORTH, title: "Show North", dataDate: "2026-10-17", mode: "direct" },
    ]);
    const stored = await readFeaturedReport(dir, NORTH);
    expect(stored?.context.show?.name).toBe("Show North");
    expect(stored?.evidence).toEqual({});
  });

  it("skips a file whose id does not match and a file that is not a report", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "overindex-featured-"));
    await writeFeatured(dir, fixture(NORTH, "Show North", "direct"), "2026-10-17");
    writeFileSync(path.join(dir, "featured", "not-a-uuid.json"), "{}", "utf8");
    writeFileSync(path.join(dir, "featured", `${RIDGE}.json`), JSON.stringify({ dataDate: "2026-10-18", report: { id: NORTH } }), "utf8");
    expect(await listFeatured(dir)).toEqual([{ id: NORTH, title: "Show North", dataDate: "2026-10-17", mode: "direct" }]);
    expect(await readFeaturedReport(dir, "../secret")).toBeUndefined();
    expect(await listFeatured(path.join(dir, "missing"))).toEqual([]);
  });

  it("ranks the media-kit brands by fit", () => {
    const ranked = topBrands(
      [
        { fit: 0.2, brand: { name: "Brand Beta" } },
        { brand: { name: "Brand Gamma" } },
        { fit: 0.9, brand: { name: "Brand Alpha" } },
        { fit: 0.9, brand: { name: "Brand Delta" } },
      ],
      3,
    );
    expect(ranked.map((item) => item.brand.name)).toEqual(["Brand Alpha", "Brand Delta", "Brand Beta"]);
  });
});

function fixture(id: string, name: string, mode: "direct" | "proxy"): Report {
  return reportSchema.parse({
    id,
    createdAt: "2026-10-17T03:00:00.000Z",
    input: { showQuery: name },
    context: {
      mode,
      show: { id: `show-${name}`, name, type: "podcast" },
      tags: [],
      confidence: "low",
    },
    sections: {
      tasteCard: { status: "ok" },
      candidates: { status: "ok", data: [] },
      withoutQloo: { status: "ok", data: [] },
    },
    evidence: {},
    budget: { used: 0, target: 25, cap: 40 },
    trace: [],
  });
}
