/** One initial attempt plus two retries. Delays apply before retry 1 and 2. */
export const MAX_RETRIES = 2;
export const MAX_ATTEMPTS = MAX_RETRIES + 1;

export const RETRY_BACKOFF_MS = [1_000, 3_000] as const;

/** Longer than the standard backoff. Quota numbers are still unknown (STATUS U8). */
export const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000] as const;

export const RATE_LIMIT_CODE = "QLOO_RATE_LIMIT";

export function backoffMs(errorCode: string | undefined, retryIndex: number): number {
  const table = errorCode === RATE_LIMIT_CODE ? RATE_LIMIT_BACKOFF_MS : RETRY_BACKOFF_MS;
  return table[Math.min(retryIndex, table.length - 1)] ?? RETRY_BACKOFF_MS[0];
}
