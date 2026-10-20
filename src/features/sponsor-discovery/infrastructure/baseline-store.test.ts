import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCORING_VERSION } from "@/shared/config/scoring";
import { FileBaselineStore, MemoryBaselineStore } from "./baseline-store";

describe("baseline affinity store", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("remembers an affinity in memory", async () => {
    const store = new MemoryBaselineStore();
    expect(await store.get("brand-1")).toBeUndefined();
    await store.set("brand-1", 0.42);
    expect(await store.get("brand-1")).toBe(0.42);
  });

  it("writes only the affinity number under the cache directory", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "overindex-baseline-"));
    const store = new FileBaselineStore(dir);
    await store.set("AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1", 0.61);
    expect(await store.get("AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1")).toBe(0.61);
    const file = path.join(dir, "baseline-affinity", SCORING_VERSION, "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ affinity: 0.61 });
  });
});
