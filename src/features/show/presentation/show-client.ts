import type { z } from "zod";

const pending = new Map<string, Promise<unknown>>();

/** Dedupes the same key so a remounted confirm screen does not send a second call. */
export function postJson<T>(key: string, url: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const request = readJson(url, body, schema).catch((error: unknown) => {
    pending.delete(key);
    throw error;
  });
  pending.set(key, request);
  return request;
}

async function readJson<T>(url: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!response.ok || !parsed.success) throw new Error("request failed");
  return parsed.data;
}
