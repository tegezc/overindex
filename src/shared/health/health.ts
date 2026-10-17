import type { Env } from "@/shared/config/env";

// `qloo: "unchecked"` until the QlooGateway (S2) can run `qloo_capabilities`.
export type Health = {
  ok: true;
  qloo: "ready" | "missing" | "unchecked";
  llm: "configured" | "missing";
};

export function buildHealth(env: Env): Health {
  return {
    ok: true,
    qloo: "unchecked",
    llm: env.OPENAI_API_KEY ? "configured" : "missing",
  };
}
