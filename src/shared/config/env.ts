import { z } from "zod";

const optionalString = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().min(1).optional(),
);

const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const nonNegativeInt = (fallback: number) => z.coerce.number().int().nonnegative().default(fallback);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    QLOO_API_KEY: optionalString,
    QLOO_HOME: optionalString,
    OPENAI_API_KEY: optionalString,
    OPENAI_MODEL: z.string().min(1).default("gpt-6.1-sol"),
    OPENAI_REASONING_EFFORT: z.string().min(1).default("medium"),
    CACHE_DIR: optionalString,
    QLOO_BUDGET_TARGET: positiveInt(25),
    QLOO_BUDGET_CAP: positiveInt(40),
    QLOO_CONCURRENCY: positiveInt(2),
    LIVE_REPORTS_PER_IP_PER_DAY: nonNegativeInt(3),
    LIVE_REPORTS_GLOBAL_PER_DAY: nonNegativeInt(50),
    USE_FAKE_QLOO: flag,
  })
  .superRefine((env, ctx) => {
    if (env.QLOO_BUDGET_TARGET > env.QLOO_BUDGET_CAP) {
      ctx.addIssue({
        code: "custom",
        path: ["QLOO_BUDGET_TARGET"],
        message: "must be <= QLOO_BUDGET_CAP",
      });
    }
    if (env.USE_FAKE_QLOO) return;
    if (!env.OPENAI_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "is required unless USE_FAKE_QLOO=true" });
    }
    if (env.NODE_ENV === "production" && !env.QLOO_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["QLOO_API_KEY"], message: "is required in production unless USE_FAKE_QLOO=true" });
    }
  })
  .transform((env) => ({
    ...env,
    CACHE_DIR: env.CACHE_DIR ?? (env.NODE_ENV === "production" ? "/data" : "./.cache"),
  }));

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment: ${problems.join("; ")}`);
    this.name = "EnvError";
  }
}

// Error messages carry variable names only, never values.
export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`));
  }
  return parsed.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= loadEnv(process.env);
  return cached;
}
