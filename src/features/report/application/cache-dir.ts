/** Same default as env validation, without requiring secrets. */
export function resolveCacheDir(source: { CACHE_DIR?: string; NODE_ENV?: string }): string {
  const set = source.CACHE_DIR?.trim();
  if (set) return set;
  return source.NODE_ENV === "production" ? "/data" : "./.cache";
}

export function featuredCacheDir(): string {
  return resolveCacheDir({
    CACHE_DIR: process.env.CACHE_DIR,
    NODE_ENV: process.env.NODE_ENV,
  });
}
