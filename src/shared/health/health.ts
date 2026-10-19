import type { Env } from "@/shared/config/env";

export type Health = {
  ok: true;
  qloo: "ready" | "missing" | "unchecked";
  llm: "configured" | "missing";
};

/** `qloo` stays `unchecked` unless the route has already probed `qloo_capabilities`. */
export function buildHealth(env: Env, qloo: Health["qloo"] = "unchecked"): Health {
  return {
    ok: true,
    qloo,
    llm: env.OPENAI_API_KEY ? "configured" : "missing",
  };
}
