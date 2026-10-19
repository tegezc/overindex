import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { QlooCache } from "@/shared/qloo/application/qloo-cache";

export const QLOO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const storedSchema = z.object({
  storedAt: z.string(),
  payload: z.unknown(),
});

/**
 * Filesystem cache at `CACHE_DIR/qloo/<sha256>.json`.
 * The directory must stay outside the repo or git-ignored.
 */
export class FileQlooCache implements QlooCache {
  private readonly dir: string;

  constructor(
    cacheDir: string,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = QLOO_CACHE_TTL_MS,
  ) {
    this.dir = path.join(cacheDir, "qloo");
  }

  async get(key: string): Promise<unknown> {
    const file = this.filePath(key);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      return undefined;
    }
    const parsed = storedSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      await rm(file, { force: true });
      return undefined;
    }
    const storedAt = Date.parse(parsed.data.storedAt);
    if (!Number.isFinite(storedAt) || this.now().getTime() - storedAt > this.ttlMs) {
      await rm(file, { force: true });
      return undefined;
    }
    return parsed.data.payload;
  }

  async set(key: string, value: unknown): Promise<void> {
    const file = this.filePath(key);
    await mkdir(this.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const body = JSON.stringify({ storedAt: this.now().toISOString(), payload: value });
    await writeFile(tmp, body, "utf8");
    await rename(tmp, file);
  }

  private filePath(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("invalid cache key");
    return path.join(this.dir, `${key}.json`);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
