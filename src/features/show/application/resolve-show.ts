import type { DisambiguateResult } from "@/shared/llm/domain/schemas";
import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { DescribeEnvelope } from "@/shared/qloo/domain/envelope";
import { extractShowCandidates, type PodcastCandidate } from "../domain/candidates";
import { resolveResponseSchema, type ResolveResponse } from "../domain/contracts";

export type ResolveShowDeps = {
  describe(input: { entity: string; type: "podcast" }): Promise<QlooCall<DescribeEnvelope>>;
  disambiguate(input: { query: string; candidates: { id: string; name: string; description: string }[] }): Promise<DisambiguateResult>;
};

/**
 * Confirm stays in charge when Qloo already asked for a choice (`needs_input`).
 * `disambiguate_show` may narrow a semantic match. It does not hide Qloo's candidates.
 * A describe `not_found` issue has no candidates and is returned as `empty`.
 */
export async function resolveShow(query: string, deps: ResolveShowDeps): Promise<ResolveResponse> {
  const described = await deps.describe({ entity: query.trim(), type: "podcast" });
  if (described.data.status === "error") {
    const errorCode = described.data.error?.code;
    return resolveResponseSchema.parse({
      status: "error",
      candidates: [],
      mode: "direct",
      ...(errorCode ? { errorCode } : {}),
    });
  }

  const extracted = extractShowCandidates(described.data);
  if (extracted.candidates.length === 0) {
    return resolveResponseSchema.parse({ status: "empty", candidates: [], mode: "proxy_suggestions" });
  }
  if (extracted.confident) {
    return resolveResponseSchema.parse({ status: "ok", candidates: extracted.candidates, mode: "direct" });
  }

  const decision = await disambiguateOrAsk(query, extracted.candidates, deps);
  if (described.data.status !== "needs_input" && decision && !decision.ask && decision.choice) {
    const chosen = extracted.candidates.find((candidate) => candidate.id === decision.choice);
    if (chosen) return resolveResponseSchema.parse({ status: "ok", candidates: [chosen], mode: "direct" });
  }
  return resolveResponseSchema.parse({
    status: "needs_input",
    candidates: extracted.candidates,
    mode: "direct",
  });
}

async function disambiguateOrAsk(
  query: string,
  candidates: PodcastCandidate[],
  deps: ResolveShowDeps,
): Promise<DisambiguateResult | undefined> {
  try {
    return await deps.disambiguate({
      query,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        description: candidate.description ?? "",
      })),
    });
  } catch {
    return undefined;
  }
}
