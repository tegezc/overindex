import { PLAN_SLACK_CALLS } from "@/shared/config/scoring";
import type { DisambiguateResult } from "@/shared/llm/domain/schemas";
import type { DescribeEnvelope, InsightsResult } from "@/shared/qloo/domain/envelope";
import type { InsightsRawInput, ScoreCandidatesInput } from "@/shared/qloo/domain/inputs";
import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { MemoryTraceSink } from "@/shared/trace/trace";
import { extractShowCandidates } from "@/features/show/domain/candidates";
import { resolveShow } from "@/features/show/application/resolve-show";
import { baselineAffinity } from "./baseline-affinity";
import { discoverBrands } from "./discover-brands";
import { resolveBrandName } from "./resolve-names";
import { scoreCandidateSet } from "./score-candidates";
import type { BaselineAffinityStore } from "../domain/baseline-store";
import { BASELINE_BASKET } from "../domain/basket";
import { withinPlan } from "../domain/budget-plan";
import type { InsightBrand } from "../domain/entities";
import { nameAccepts, normalizeBrandName, resolutionQueue, selectNamed, type ResolveKind } from "../domain/names";
import { buildShortlist } from "../domain/shortlist";
import type { BrandCandidate, CandidateOrigin, CategoryLabel, PoolItem } from "../domain/types";
import type { LaneACatalog } from "../infrastructure/lane-a-file";

export type SponsorDiscoveryInput = {
  showQuery: string;
  currentSponsors?: readonly string[];
  excludedCategories?: readonly string[];
  showDescription?: string;
  planSlack?: number;
  basketNames?: readonly string[];
};

export type DiscoveryCounts = {
  candidates: number;
  laneA: number;
  laneB: number;
  proven: number;
  hidden: number;
  categoryOnly: number;
  none: number;
  renewal: number;
  excluded: number;
  qlooCalls: number;
  discoverOverlap: number;
  laneAPending: number;
  basketSignals: number;
};

export type SponsorDiscoveryResult = {
  status: "ok" | "partial" | "empty" | "needs_input" | "error";
  showName?: string;
  showCandidates?: number;
  errorCode?: string;
  candidates: BrandCandidate[];
  counts: DiscoveryCounts;
};

export type SponsorDiscoveryDeps = {
  describe: (input: { entity: string; type: "podcast" | "brand" }) => Promise<QlooCall<DescribeEnvelope>>;
  insightsRaw: (input: InsightsRawInput) => Promise<QlooCall<InsightsResult>>;
  scoreCandidates: (input: ScoreCandidatesInput) => Promise<QlooCall<InsightsResult>>;
  llmBaseline: (input: { showName: string; showDescription: string }) => Promise<{ brands: { name: string; category: string }[] }>;
  disambiguate: (input: {
    query: string;
    candidates: { id: string; name: string; description: string }[];
  }) => Promise<DisambiguateResult>;
  trace: MemoryTraceSink;
  budget: { used: number; cap: number };
  laneA: LaneACatalog;
  baselineStore: BaselineAffinityStore;
  onBaseline?: (outcome: BaselineOutcome) => void;
};

export type BaselineOutcome =
  | { ok: true; brands: { name: string; category: string }[] }
  | { ok: false };

type Pool = {
  id: string;
  name: string;
  origins: CandidateOrigin[];
  popularity?: number;
  categories: CategoryLabel[];
  llmRank?: number;
  affinityShow?: number;
  affinityBase?: number;
};

/**
 * Sponsor discovery spine: popularity-band discovery, name resolution inside the
 * call budget, show scores, basket baseline, then lane and quadrant.
 * Candidate scores go through insights `filter.results.entities`, not `qloo_rank`.
 */
export async function runSponsorDiscovery(
  input: SponsorDiscoveryInput,
  deps: SponsorDiscoveryDeps,
): Promise<SponsorDiscoveryResult> {
  const slack = input.planSlack ?? PLAN_SLACK_CALLS;
  const basketNames = input.basketNames ?? BASELINE_BASKET;
  const sponsors = input.currentSponsors ?? [];
  const excluded = input.excludedCategories ?? [];
  const resolved = await resolveShow(input.showQuery, deps);
  deps.trace.emit({
    kind: "decision",
    status: resolved.status === "ok" ? "ok" : resolved.status,
    summary: `resolve show ${resolved.status} count ${resolved.candidates.length}`,
  });
  const show = resolved.candidates[0];
  if (resolved.status !== "ok" || resolved.candidates.length !== 1 || !show) {
    return finish(deps, {
      status: resolved.status === "ok" ? "needs_input" : showFailure(resolved.status),
      showCandidates: resolved.candidates.length,
      ...(resolved.status === "error" && resolved.errorCode ? { errorCode: resolved.errorCode } : {}),
      candidates: [],
      counts: emptyCounts(),
    });
  }

  const description = input.showDescription?.trim() || show.description?.trim() || `Podcast: ${show.name}`;
  const llmPromise = deps
    .llmBaseline({ showName: show.name, showDescription: description })
    .then(
      (value) => {
        notifyBaseline(deps, { ok: true, brands: value.brands });
        return value.brands;
      },
      () => {
        notifyBaseline(deps, { ok: false });
        return undefined;
      },
    );
  const discovered = await discoverBrands(show.id, deps.budget, deps.insightsRaw, slack);
  const llmBrands = await llmPromise;
  let partial = discovered.partial || llmBrands === undefined;
  deps.trace.emit({
    kind: "decision",
    summary: `discover brands ${discovered.brands.length} overlap ${discovered.overlap}`,
  });
  deps.trace.emit({
    kind: "decision",
    summary: llmBrands ? `llm baseline count ${llmBrands.length}` : "llm baseline failed",
  });

  const basketIds = await resolveBasket(show, input.showQuery, basketNames, discovered.brands.length, slack, deps);
  if (basketIds.length < basketNames.length) partial = true;
  deps.trace.emit({ kind: "decision", summary: `basket signals ${basketIds.length} of ${basketNames.length}` });

  const known = new Set(discovered.brands.map((brand) => normalizeBrandName(brand.name)));
  const queue = resolutionQueue({
    sponsors,
    llmNames: (llmBrands ?? []).map((brand) => brand.name),
    laneANames: deps.laneA.names,
    already: known,
  });
  const resolvedBrands: { id: string; name: string; kind: ResolveKind }[] = [];
  let attempted = 0;
  let stopped = false;
  for (const entry of queue) {
    if (!withinPlan(deps.budget.used, deps.budget.cap, 1, discovered.brands.length + resolvedBrands.length + 1, slack)) {
      stopped = true;
      partial = true;
      break;
    }
    attempted += 1;
    const hit = await resolveBrandName(entry.name, deps.describe);
    if (!hit) continue;
    if (discovered.brands.some((brand) => brand.id === hit.id) || resolvedBrands.some((brand) => brand.id === hit.id)) continue;
    resolvedBrands.push({ ...hit, kind: entry.kind });
  }
  deps.trace.emit({
    kind: "decision",
    summary: `name resolve attempted ${attempted} resolved ${resolvedBrands.length} stopped ${stopped ? 1 : 0}`,
  });

  const pool = new Map<string, Pool>();
  for (const brand of discovered.brands) addBrand(pool, brand.id, brand.name, "qloo_discovery", brand, llmBrands ?? []);
  for (const brand of resolvedBrands) addBrand(pool, brand.id, brand.name, brand.kind, undefined, llmBrands ?? []);
  for (const sponsor of sponsors) {
    const key = normalizeBrandName(sponsor);
    if (!key) continue;
    const attached = [...pool.values()].some((row) => nameAccepts(sponsor, row.name));
    if (attached) continue;
    addBrand(pool, `unresolved:${key.replace(/\s+/g, "-")}`, sponsor, "user_sponsor", undefined, llmBrands ?? []);
  }

  const scoreIds = [...pool.keys()].filter((id) => !id.startsWith("unresolved:"));
  const scored = await scoreCandidateSet(scoreIds, [show.id], deps.budget, deps.scoreCandidates);
  if (scored.partial) partial = true;
  for (const [id, brand] of scored.byId) applyScore(pool.get(id), brand);
  const baseline = await baselineAffinity(scoreIds, basketIds, deps.budget, deps.baselineStore, deps.scoreCandidates);
  if (baseline.partial) partial = true;
  for (const [id, affinity] of baseline.affinities) {
    const row = pool.get(id);
    if (row) row.affinityBase = affinity;
  }
  deps.trace.emit({
    kind: "decision",
    summary: `score batches ${scored.batches} baseline batches ${baseline.batches} baseline cached ${baseline.cached}`,
  });

  const renewalIds = new Set<string>();
  for (const row of pool.values()) {
    if (sponsors.some((sponsor) => nameAccepts(sponsor, row.name))) renewalIds.add(row.id);
  }
  const shortlist = buildShortlist({
    items: [...pool.values()].map(toPoolItem),
    laneA: deps.laneA.normalized,
    excludedCategories: excluded,
    renewalNames: new Set(sponsors.map((sponsor) => normalizeBrandName(sponsor)).filter(Boolean)),
    renewalIds,
  });
  const laneAPending = deps.laneA.names.filter(
    (name) => !shortlist.candidates.some((candidate) => nameAccepts(name, candidate.brand.name)),
  ).length;
  deps.trace.emit({
    kind: "decision",
    summary: `shortlist ${shortlist.candidates.length} excluded ${shortlist.excluded} lane A pending ${laneAPending}`,
  });
  const status = shortlist.candidates.length === 0 ? (partial ? "partial" : "empty") : partial ? "partial" : "ok";
  return finish(deps, {
    status,
    showName: show.name,
    candidates: shortlist.candidates,
    counts: {
      ...countCandidates(shortlist.candidates),
      excluded: shortlist.excluded,
      discoverOverlap: discovered.overlap,
      laneAPending,
      basketSignals: basketIds.length,
    },
  });
}

async function resolveBasket(
  show: { id: string; name: string },
  showQuery: string,
  basketNames: readonly string[],
  discoveredCount: number,
  slack: number,
  deps: SponsorDiscoveryDeps,
): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  const showKey = normalizeBrandName(show.name);
  const queryKey = normalizeBrandName(showQuery);
  for (const name of basketNames) {
    const key = normalizeBrandName(name);
    if (key && (key === showKey || key === queryKey)) {
      if (!seen.has(show.id)) {
        ids.push(show.id);
        seen.add(show.id);
      }
      continue;
    }
    if (!withinPlan(deps.budget.used, deps.budget.cap, 1, discoveredCount, slack)) break;
    const described = await deps.describe({ entity: name, type: "podcast" });
    if (described.data.status === "error") continue;
    const picked = selectNamedSafe(name, described.data);
    if (!picked || seen.has(picked.id)) continue;
    ids.push(picked.id);
    seen.add(picked.id);
  }
  return ids;
}

function selectNamedSafe(query: string, envelope: DescribeEnvelope): { id: string; name: string } | undefined {
  return selectNamed(query, extractShowCandidates(envelope).candidates);
}

function notifyBaseline(deps: SponsorDiscoveryDeps, outcome: BaselineOutcome): void {
  try {
    deps.onBaseline?.(outcome);
  } catch {
    // A listener must not stop scoring.
  }
}

function showFailure(status: string): SponsorDiscoveryResult["status"] {
  if (status === "empty" || status === "needs_input" || status === "error" || status === "partial") return status;
  return "error";
}

function addBrand(
  pool: Map<string, Pool>,
  id: string,
  name: string,
  origin: CandidateOrigin,
  discovered: InsightBrand | undefined,
  llmBrands: readonly { name: string; category: string }[],
): void {
  const row = pool.get(id) ?? { id, name, origins: [], categories: [] };
  row.name = row.name || name;
  pushOrigin(row, origin);
  if (discovered?.popularity !== undefined && row.popularity === undefined) row.popularity = discovered.popularity;
  for (const category of discovered?.categories ?? []) {
    if (!row.categories.some((item) => item.source === "qloo_tags" && item.label === category.label)) {
      row.categories.push(category);
    }
  }
  const llm = matchLlm(name, llmBrands);
  if (llm) {
    pushOrigin(row, "llm_baseline");
    row.llmRank = llm.rank;
    if (!row.categories.some((item) => item.source === "ai_classified")) {
      row.categories.push({ label: llm.category, source: "ai_classified" });
    }
  }
  pool.set(id, row);
}

function applyScore(row: Pool | undefined, brand: InsightBrand): void {
  if (!row) return;
  if (brand.affinity !== undefined) row.affinityShow = brand.affinity;
  if (brand.popularity !== undefined) row.popularity = brand.popularity;
  for (const category of brand.categories) {
    if (!row.categories.some((item) => item.label === category.label && item.source === "qloo_tags")) {
      row.categories.push(category);
    }
  }
}

function matchLlm(
  name: string,
  brands: readonly { name: string; category: string }[],
): { rank: number; category: string } | undefined {
  const key = normalizeBrandName(name);
  const exact = brands.findIndex((brand) => normalizeBrandName(brand.name) === key);
  if (exact >= 0) {
    const brand = brands[exact];
    return brand ? { rank: exact + 1, category: brand.category } : undefined;
  }
  const loose = brands.filter((brand) => nameAccepts(name, brand.name));
  if (loose.length !== 1) return undefined;
  const only = loose[0];
  if (!only) return undefined;
  return { rank: brands.indexOf(only) + 1, category: only.category };
}

function pushOrigin(row: Pool, origin: CandidateOrigin): void {
  if (!row.origins.includes(origin)) row.origins.push(origin);
}

function toPoolItem(row: Pool): PoolItem {
  return {
    id: row.id,
    name: row.name,
    origins: row.origins,
    categories: row.categories,
    ...(row.popularity !== undefined ? { popularity: row.popularity } : {}),
    ...(row.llmRank !== undefined ? { llmRank: row.llmRank } : {}),
    ...(row.affinityShow !== undefined ? { affinityShow: row.affinityShow } : {}),
    ...(row.affinityBase !== undefined ? { affinityBase: row.affinityBase } : {}),
  };
}

function countCandidates(candidates: readonly BrandCandidate[]): Omit<
  DiscoveryCounts,
  "excluded" | "qlooCalls" | "discoverOverlap" | "laneAPending" | "basketSignals"
> {
  return {
    candidates: candidates.length,
    laneA: candidates.filter((candidate) => candidate.lane === "A").length,
    laneB: candidates.filter((candidate) => candidate.lane === "B").length,
    proven: candidates.filter((candidate) => candidate.quadrant === "proven").length,
    hidden: candidates.filter((candidate) => candidate.quadrant === "hidden").length,
    categoryOnly: candidates.filter((candidate) => candidate.quadrant === "category_only").length,
    none: candidates.filter((candidate) => candidate.quadrant === "none").length,
    renewal: candidates.filter((candidate) => candidate.flags.renewal).length,
  };
}

function emptyCounts(): Omit<DiscoveryCounts, "qlooCalls"> {
  return {
    candidates: 0,
    laneA: 0,
    laneB: 0,
    proven: 0,
    hidden: 0,
    categoryOnly: 0,
    none: 0,
    renewal: 0,
    excluded: 0,
    discoverOverlap: 0,
    laneAPending: 0,
    basketSignals: 0,
  };
}

function finish(
  deps: SponsorDiscoveryDeps,
  result: Omit<SponsorDiscoveryResult, "counts"> & { counts: Omit<DiscoveryCounts, "qlooCalls"> },
): SponsorDiscoveryResult {
  deps.trace.emit({ kind: "budget", summary: `qloo calls ${deps.budget.used}` });
  return {
    ...result,
    counts: { ...result.counts, qlooCalls: deps.budget.used },
  };
}
