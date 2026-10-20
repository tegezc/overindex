import { assignLane, assignQuadrant, fit, lift, normalizeLift, percentile, reachBand } from "./scoring";
import { isCategoryExcluded, normalizeBrandName } from "./names";
import { brandCandidateSchema, type BrandCandidate, type CandidateOrigin, type PoolItem } from "./types";

const ORIGIN_ORDER: readonly CandidateOrigin[] = ["qloo_discovery", "llm_baseline", "lane_a", "user_sponsor"];

export function buildShortlist(input: {
  items: readonly PoolItem[];
  laneA: ReadonlySet<string>;
  excludedCategories: readonly string[];
  renewalNames: ReadonlySet<string>;
  renewalIds: ReadonlySet<string>;
}): { candidates: BrandCandidate[]; excluded: number } {
  const kept: PoolItem[] = [];
  let excluded = 0;
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const labels = item.categories.map((category) => category.label);
    if (isCategoryExcluded(labels, input.excludedCategories)) {
      excluded += 1;
      continue;
    }
    kept.push(item);
  }

  const showSample = finite(kept.map((item) => item.affinityShow));
  const baseSample = finite(kept.map((item) => item.affinityBase));
  const candidates = kept
    .map((item) => toCandidate(item, input, showSample, baseSample))
    .sort(byFitThenName);
  return { candidates: candidates.map((candidate) => brandCandidateSchema.parse(candidate)), excluded };
}

function toCandidate(
  item: PoolItem,
  input: {
    laneA: ReadonlySet<string>;
    renewalNames: ReadonlySet<string>;
    renewalIds: ReadonlySet<string>;
  },
  showSample: number[],
  baseSample: number[],
): BrandCandidate {
  const lane = assignLane(item.name, input.laneA);
  const renewal = input.renewalIds.has(item.id) || input.renewalNames.has(normalizeBrandName(item.name));
  const origins = new Set(item.origins);
  if (lane === "A") origins.add("lane_a");
  if (renewal) origins.add("user_sponsor");
  const pctShow = item.affinityShow !== undefined && showSample.length > 0 ? percentile(item.affinityShow, showSample) : undefined;
  const pctBase = item.affinityBase !== undefined && baseSample.length > 0 ? percentile(item.affinityBase, baseSample) : undefined;
  const liftValue = pctShow !== undefined && pctBase !== undefined ? lift(pctShow, pctBase) : undefined;
  const liftNorm = liftValue !== undefined ? normalizeLift(liftValue) : undefined;
  const fitValue = pctShow !== undefined && liftNorm !== undefined ? fit(pctShow, liftNorm) : undefined;
  const category = displayCategory(item);
  const reach = reachBand(item.popularity);
  return {
    brand: { id: item.id, name: item.name, type: "brand" },
    origins: ORIGIN_ORDER.filter((origin) => origins.has(origin)),
    ...(item.affinityShow !== undefined ? { affinityRaw: item.affinityShow } : {}),
    ...(pctShow !== undefined ? { pctShow } : {}),
    ...(pctBase !== undefined ? { pctBase } : {}),
    ...(liftValue !== undefined ? { lift: liftValue } : {}),
    ...(item.popularity !== undefined ? { popularity: item.popularity } : {}),
    ...(reach ? { reachBand: reach } : {}),
    ...(fitValue !== undefined ? { fit: fitValue } : {}),
    ...(item.llmRank !== undefined ? { llmRank: item.llmRank } : {}),
    lane,
    quadrant: assignQuadrant({ fit: fitValue, llmRank: item.llmRank }),
    flags: {
      ...(renewal ? { renewal: true } : {}),
      ...(item.affinityShow === undefined ? { noTasteSignal: true } : {}),
      ...(category ? { category } : {}),
    },
  };
}

function displayCategory(item: PoolItem): PoolItem["categories"][number] | undefined {
  return item.categories.find((category) => category.source === "qloo_tags") ?? item.categories[0];
}

function finite(values: readonly (number | undefined)[]): number[] {
  return values.filter((value): value is number => value !== undefined && Number.isFinite(value));
}

function byFitThenName(a: BrandCandidate, b: BrandCandidate): number {
  const af = a.fit ?? Number.NEGATIVE_INFINITY;
  const bf = b.fit ?? Number.NEGATIVE_INFINITY;
  if (af !== bf) return bf - af;
  return a.brand.name.localeCompare(b.brand.name);
}
