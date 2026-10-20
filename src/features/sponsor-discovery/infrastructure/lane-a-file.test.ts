import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLaneACatalog, parseCsv } from "./lane-a-file";

describe("loadLaneACatalog", () => {
  it("reads the frozen Lane A file as 176 normalized names", () => {
    const catalog = loadLaneACatalog(path.join(process.cwd(), "eval/dataset/lane_a_buyers.csv"));
    expect(catalog.names).toHaveLength(176);
    expect(catalog.normalized.size).toBe(176);
    expect(catalog.normalized.has("ag1")).toBe(true);
  });
});

describe("parseCsv", () => {
  it("keeps a comma that sits inside quotes", () => {
    expect(parseCsv('brand_norm,note\n"Alpha, Inc.","hello, there"\n')).toEqual([
      ["brand_norm", "note"],
      ["Alpha, Inc.", "hello, there"],
    ]);
  });
});
