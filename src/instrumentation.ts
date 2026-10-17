import { PHASE_PRODUCTION_BUILD } from "next/constants";

// Fail fast at server start when required env is missing (tech-spec §10).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  const { getEnv } = await import("@/shared/config/env");
  getEnv();
}
