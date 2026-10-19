import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const inner = (value as Record<string, unknown>)[key];
    if (inner === undefined) continue;
    out[key] = sortValue(inner);
  }
  return out;
}

export function cacheKey(tool: string, args: unknown): string {
  return createHash("sha256").update(tool).update("\0").update(canonicalJson(args)).digest("hex");
}
