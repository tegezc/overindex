import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SCORING_VERSION } from "@/shared/config/scoring";
import type { BaselineAffinityStore } from "../domain/baseline-store";

const rowSchema = z.object({ affinity: z.number() });

/** Per-brand baseline affinity under CACHE_DIR. This is not a raw Qloo response. */
export class FileBaselineStore implements BaselineAffinityStore {
  private readonly dir: string;

  constructor(cacheDir: string) {
    this.dir = path.join(cacheDir, "baseline-affinity", SCORING_VERSION);
  }

  async get(entityId: string): Promise<number | undefined> {
    try {
      const parsed = rowSchema.safeParse(JSON.parse(await readFile(this.file(entityId), "utf8")));
      return parsed.success ? parsed.data.affinity : undefined;
    } catch {
      return undefined;
    }
  }

  async set(entityId: string, affinity: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(entityId), JSON.stringify({ affinity }), "utf8");
  }

  private file(entityId: string): string {
    const safe = entityId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }
}

export class MemoryBaselineStore implements BaselineAffinityStore {
  private readonly rows = new Map<string, number>();

  async get(entityId: string): Promise<number | undefined> {
    return this.rows.get(entityId);
  }

  async set(entityId: string, affinity: number): Promise<void> {
    this.rows.set(entityId, affinity);
  }
}
