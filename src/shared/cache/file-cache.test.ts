import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cacheKey } from "./cache-key";
import { FileQlooCache, QLOO_CACHE_TTL_MS } from "./file-cache";

describe("qloo filesystem cache", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("uses a canonical key so object key order does not matter", () => {
    expect(cacheKey("qloo_describe", { b: 1, a: { d: 2, c: 3 } })).toBe(
      cacheKey("qloo_describe", { a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(cacheKey("qloo_describe", { entity: "Show North" })).not.toBe(
      cacheKey("qloo_recommend", { entity: "Show North" }),
    );
    expect(cacheKey("qloo_describe", { entity: "Show North" })).toMatch(/^[a-f0-9]{64}$/);
  });

  it("expires entries after 7 days and rejects unsafe keys", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "overindex-cache-"));
    const key = cacheKey("qloo_describe", { entity: "Show North" });
    let now = new Date("2026-10-01T00:00:00.000Z");
    const cache = new FileQlooCache(dir, () => now);
    await cache.set(key, { status: "ok", summary: "Synthetic describe result" });
    now = new Date(now.getTime() + QLOO_CACHE_TTL_MS);
    expect(await cache.get(key)).toMatchObject({ summary: "Synthetic describe result" });
    now = new Date(now.getTime() + 1);
    expect(await cache.get(key)).toBeUndefined();
    await expect(cache.get("../secret")).rejects.toThrow(/invalid cache key/);
  });
});
