import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bootstrapMeanCi, bootstrapPairedMeanCi } from "./bootstrap";
import { loadShowsCsv, parseBrandNormalizationCsv, parseGroundTruthCsv, parseShowsCsv } from "./dataset";
import { rankM1, rankM2, rankM3, rankM4 } from "./methods";
import { jaccard, ndcgAt, perShowSpecificity, recallAt } from "./metrics";
import { chooseTunedValue, REDUCED_DEV_COUNTS } from "./protocol";
import { renderQ1Prompt } from "./prompts";
import { candidateSet, scoreQ1Split, type Q1ShowResult } from "./q1";
import { llmBrandsOutsideLaneA, mostFrequentBrands, scoreQ2Split } from "./q2";
import { publishedResultsDir, q2Paired, summarizeQ1, summarizeQ2, writeAggregateReport, writeTestAggregate } from "./results";
import { assignSplit, splitMismatches, tierShuffle } from "./split";

/**
 * Reference mulberry32 copied from `eval-protocol.md` §3.3 so the bootstrap
 * expectation is recalculated here instead of calling the harness RNG.
 */
function referenceUniform(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function referencePermutation(ids: readonly string[], seed: number): string[] {
  const copy = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const random = referenceUniform(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index] as string;
    copy[index] = copy[swap] as string;
    copy[swap] = current;
  }
  return copy;
}

function referenceBootstrap(values: readonly number[], resamples: number, seed: number) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const random = referenceUniform(seed);
  const means: number[] = [];
  for (let sample = 0; sample < resamples; sample += 1) {
    let sum = 0;
    for (let draw = 0; draw < values.length; draw += 1) {
      sum += values[Math.floor(random() * values.length)] ?? 0;
    }
    means.push(sum / values.length);
  }
  means.sort((left, right) => left - right);
  const at = (p: number) => {
    const position = (means.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const low = means[lower] ?? 0;
    const high = means[upper] ?? 0;
    if (lower === upper) return low;
    return low + (high - low) * (position - lower);
  };
  return { mean, low: at(0.025), high: at(0.975) };
}

const PROTOCOL_DEV_BESAR = ["my-favorite-murder", "rest-is-history", "theo-von"];
const PROTOCOL_DEV_MID = [
  "victorian-nightmare",
  "at-parenting-survival",
  "gamertag-radio",
  "fighter-and-the-kid",
  "pillow-talks",
  "kinda-funny",
  "decoded",
];

describe("stored split", () => {
  it("matches shows.csv and the protocol's dev order", () => {
    const shows = loadShowsCsv(fileURLToPath(new URL("../dataset/shows.csv", import.meta.url)));
    expect(shows).toHaveLength(30);
    expect(splitMismatches(shows)).toEqual([]);
    expect(tierShuffle(shows, "besar").slice(0, 3)).toEqual(PROTOCOL_DEV_BESAR);
    expect(tierShuffle(shows, "mid").slice(0, 7)).toEqual(PROTOCOL_DEV_MID);
    expect(shows.filter((show) => show.split === "dev" && show.tier === "besar")).toHaveLength(3);
    expect(shows.filter((show) => show.split === "dev" && show.tier === "mid")).toHaveLength(7);
    expect(shows.filter((show) => show.split === "test" && show.tier === "besar")).toHaveLength(7);
    expect(shows.filter((show) => show.split === "test" && show.tier === "mid")).toHaveLength(13);
    for (const showId of [...PROTOCOL_DEV_BESAR, ...PROTOCOL_DEV_MID]) {
      expect(shows.find((show) => show.showId === showId)?.split).toBe("dev");
    }
  });

  it("can express the 20-show contingency without rewriting the stored split", () => {
    const shows = [
      ...Array.from({ length: 10 }, (_, index) => ({ showId: `b${index.toString().padStart(2, "0")}`, tier: "besar" as const })),
      ...Array.from({ length: 20 }, (_, index) => ({ showId: `m${index.toString().padStart(2, "0")}`, tier: "mid" as const })),
    ];
    const assigned = assignSplit(shows, REDUCED_DEV_COUNTS);
    const devBesar = shows.filter((show) => show.tier === "besar" && assigned.get(show.showId) === "dev").map((show) => show.showId);
    const devMid = shows.filter((show) => show.tier === "mid" && assigned.get(show.showId) === "dev").map((show) => show.showId);
    expect(devBesar).toHaveLength(2);
    expect(devMid).toHaveLength(4);
    expect([...devBesar].sort()).toEqual([...tierShuffle(shows, "besar").slice(0, 2)].sort());
  });
});

describe("dataset loader", () => {
  it("parses quoted synthetic rows", () => {
    const shows = parseShowsCsv(
      "show_id,name,tier,genre,apple_url,rss_url,description,description_url,apple_ratings,curated_on,split\n" +
        'show-north,Show North,mid,tech,https://example.test/a,https://example.test/rss,"Hello, world",https://example.test/rss,10,2026-10-19,dev\n',
    );
    expect(shows[0]).toMatchObject({ showId: "show-north", description: "Hello, world", split: "dev", appleRatings: 10 });
    const truth = parseGroundTruthCsv(
      "show_id,brand_raw,brand_norm,episode_url,episode_date,ad_type,seen_before_cutoff\n" +
        "show-north,Alpha,Alpha,https://example.test/e,2026-10-01,unclear,unknown\n",
    );
    expect(truth).toEqual([
      {
        showId: "show-north",
        brandRaw: "Alpha",
        brandNorm: "Alpha",
        episodeUrl: "https://example.test/e",
        episodeDate: "2026-10-01",
        adType: "unclear",
        seenBeforeCutoff: "unknown",
      },
    ]);
    const norms = parseBrandNormalizationCsv("brand_raw,brand_norm,note\nAlpha,Alpha,Synthetic note\n");
    expect(norms[0]).toEqual({ brandRaw: "Alpha", brandNorm: "Alpha", note: "Synthetic note" });
  });
});

describe("metrics", () => {
  it("recalculates recall and nDCG from a fixed ranking", () => {
    expect(recallAt(["b", "a", "c"], new Set(["b", "c", "z"]), 2)).toBeCloseTo(1 / 3);
    expect(ndcgAt(["a", "b", "c"], new Set(["a", "b"]), 10)).toBe(1);
    expect(ndcgAt(["miss", "hit"], new Set(["hit"]), 10)).toBeCloseTo(1 / Math.log2(3));
    expect(jaccard(["a", "b"], ["a", "c"])).toBeCloseTo(1 / 3);
    expect(perShowSpecificity([["a", "b"], ["a", "c"]])).toEqual([expect.closeTo(1 / 3), expect.closeTo(1 / 3)]);
  });
});

describe("bootstrap", () => {
  it("returns the arithmetic mean and the same interval as a second implementation", () => {
    const values = [1, 0, 1];
    const expected = referenceBootstrap(values, 32, 20261017);
    const actual = bootstrapMeanCi(values, { resamples: 32, seed: 20261017 });
    expect(actual.mean).toBeCloseTo(2 / 3);
    expect(actual.mean).toBe(expected.mean);
    expect(actual.low).toBe(expected.low);
    expect(actual.high).toBe(expected.high);

    const flat = bootstrapMeanCi([0.25, 0.25, 0.25], { resamples: 20, seed: 20261017 });
    expect(flat.mean).toBe(0.25);
    expect(flat.low).toBe(0.25);
    expect(flat.high).toBe(0.25);

    const paired = bootstrapPairedMeanCi([1, 0], [0, 0], { resamples: 16, seed: 20261017 });
    expect(paired.mean).toBe(0.5);
    const pairedExpected = referenceBootstrap([1, 0], 16, 20261017);
    expect(paired.low).toBe(pairedExpected.low);
    expect(paired.high).toBe(pairedExpected.high);
  });

  it("uses 10000 resamples and seed 20261017 unless a test overrides them", () => {
    const actual = bootstrapMeanCi([0, 1]);
    expect(actual.resamples).toBe(10_000);
    expect(actual.seed).toBe(20261017);
    expect(actual.mean).toBe(0.5);
    expect(actual.low).toBeGreaterThanOrEqual(0);
    expect(actual.high).toBeLessThanOrEqual(1);
    expect(actual.low).toBeLessThanOrEqual(actual.mean);
    expect(actual.high).toBeGreaterThanOrEqual(actual.mean);
  });
});

describe("methods M1-M4", () => {
  it("orders M1 by sponsor count, then by the seeded shuffle", () => {
    expect(rankM1(new Map([["A", 2], ["B", 1], ["C", 3]])).ranking).toEqual(["C", "A", "B"]);
    expect(rankM1(new Map([["B", 1], ["A", 1]])).ranking).toEqual(referencePermutation(["A", "B"], 20261017));
  });

  it("keeps valid M2 ids and appends everyone else in seeded order", () => {
    expect(rankM2(["a", "b", "c"], ["nope", "b", "b", "a"]).ranking).toEqual(["b", "a", "c"]);
    expect(rankM2(["a", "b", "c"], ["nope"]).ranking).toEqual(referencePermutation(["a", "b", "c"], 20261017));
  });

  it("places brands without an affinity after scored brands", () => {
    const ranked = rankM3(new Map<string, number | undefined>([["c", 0.9], ["a", 0.2], ["b", undefined]]));
    expect(ranked.ranking).toEqual(["c", "a", "b"]);
    expect(ranked.unscored).toEqual(["b"]);
  });

  it("recalculates the hybrid score from percentile, lift, and fit", () => {
    const ranked = rankM4({
      counts: new Map([["A", 2], ["B", 1], ["C", 3]]),
      affinities: new Map<string, number | undefined>([["A", 0.9], ["B", 0.2], ["C", undefined]]),
      baselinePercentile: new Map([["A", 0.25], ["B", 0.25], ["C", 0.25]]),
      alpha: 0.5,
      lambda: 0.25,
    });
    const fitA = 0.5 * 1 + 0.5 * ((1 - 0.25 + 1) / 2);
    const fitB = 0.5 * 0.5 + 0.5 * ((0.5 - 0.25 + 1) / 2);
    expect(ranked.score.get("A")).toBeCloseTo(0.25 * fitA + 0.75 * (2 / 3));
    expect(ranked.score.get("B")).toBeCloseTo(0.25 * fitB + 0.75 * (1 / 3));
    expect(ranked.ranking).toEqual(["A", "B", "C"]);
    expect(ranked.unscored).toEqual(["C"]);
  });

  it("breaks a tuning tie toward the simpler grid value", () => {
    expect(chooseTunedValue([{ value: 0.25, metric: 0.5 }, { value: 1, metric: 0.5 }])).toBe(1);
    expect(chooseTunedValue([{ value: 0, metric: 0.8 }, { value: 1, metric: 0.2 }])).toBe(0);
  });
});

describe("Q1 scoring", () => {
  const shows = [
    { showId: "dev-one", tier: "mid" as const, split: "dev" as const },
    { showId: "dev-gap", tier: "mid" as const, split: "dev" as const },
    { showId: "dev-empty", tier: "besar" as const, split: "dev" as const },
    { showId: "test-one", tier: "mid" as const, split: "test" as const },
  ];
  const sponsors = [
    { showId: "dev-one", brandNorm: "shared" },
    { showId: "dev-one", brandNorm: "only-dev" },
    { showId: "dev-gap", brandNorm: "shared" },
    { showId: "dev-empty", brandNorm: "lonely" },
    { showId: "test-one", brandNorm: "shared" },
    { showId: "test-one", brandNorm: "only-test" },
  ];

  it("scores the requested split and does not emit a row for the other split", () => {
    const result = scoreQ1Split(shows, sponsors, {
      resolvedShows: new Set(["dev-one", "dev-empty", "test-one"]),
      resolvedBrands: new Set(["shared", "only-dev", "only-test", "lonely"]),
      affinityByShow: new Map([
        ["dev-one", new Map([["shared", 0.9], ["only-test", 0.2]])],
      ]),
      baselinePercentile: new Map([["shared", 0.4], ["only-test", 0.4], ["lonely", 0.4]]),
      modelRankingByShow: new Map([["dev-one", ["shared", "only-test"]]]),
      alpha: 0.5,
      lambda: 0.5,
    }, "dev");

    expect(result.measured.map((row) => row.showId)).toEqual(["dev-one"]);
    expect(result.measured.every((row) => row.split === "dev")).toBe(true);
    expect(result.excluded).toEqual([
      { showId: "dev-gap", reason: "show_unresolved" },
      { showId: "dev-empty", reason: "empty_relevance" },
    ]);
    expect(candidateSet("dev-one", sponsors, new Set(["shared", "only-dev", "only-test", "lonely"])).candidates).toEqual([
      "lonely",
      "only-test",
      "shared",
    ]);
    expect(result.measured[0]?.metrics.M1.recallAt10).toBe(1);
    expect(result.measured[0]?.metrics.M1.ndcgAt10).toBe(1);
    expect(result.measured[0]?.metrics.M4.ndcgAt10).toBe(1);
  });

  it("uses a per-show baseline percentile instead of the shared map", () => {
    const result = scoreQ1Split(shows, sponsors, {
      resolvedShows: new Set(["dev-one"]),
      resolvedBrands: new Set(["shared", "only-dev", "only-test", "lonely"]),
      affinityByShow: new Map([
        ["dev-one", new Map([["shared", 0.9], ["only-test", 0.2], ["lonely", 0.1]])],
      ]),
      baselinePercentile: new Map([["shared", 0.4], ["only-test", 0.4], ["lonely", 0.4]]),
      baselinePercentileByShow: new Map([["dev-one", new Map()]]),
      modelRankingByShow: new Map([["dev-one", ["shared"]]]),
      alpha: 1,
      lambda: 1,
    }, "dev");
    expect(result.measured[0]?.unscoredM4).toBe(3);
  });

  it("refuses to measure the test split before the configuration is locked", () => {
    expect(() => scoreQ1Split(shows, sponsors, {
      resolvedShows: new Set(),
      resolvedBrands: new Set(),
      affinityByShow: new Map(),
      baselinePercentile: new Map(),
      modelRankingByShow: new Map(),
      alpha: 0.5,
      lambda: 0.5,
    }, "test")).toThrow(/test split/);
  });
});

describe("Q2 metrics", () => {
  it("recalculates specificity, generic share, recall, and coverage on synthetic lists", () => {
    const frequent = new Set(mostFrequentBrands([
      { showId: "s1", brandNorm: "alpha" },
      { showId: "s1", brandNorm: "beta" },
      { showId: "s2", brandNorm: "alpha" },
      { showId: "s3", brandNorm: "gamma" },
    ], 2));
    expect([...frequent]).toEqual(["alpha", "beta"]);
    expect(llmBrandsOutsideLaneA(["Lane, Inc.", "Keep Co", "Other"], new Set(["lane"]), 1)).toEqual(["keep"]);

    const scored = scoreQ2Split([
      {
        showId: "north",
        tier: "mid",
        split: "dev",
        overindexTop: ["Alpha", "Beta"],
        llmTop: ["Alpha", "Beta"],
        sponsors: ["Alpha", "Delta"],
        llmSuggestions: ["Alpha, Inc.", "Missing"],
        llmResolved: ["Alpha, Inc."],
      },
      {
        showId: "south",
        tier: "besar",
        split: "dev",
        overindexTop: ["Alpha", "Gamma"],
        llmTop: ["Alpha", "Gamma"],
        sponsors: ["Alpha", "Delta"],
        llmSuggestions: ["Alpha, Inc.", "Missing"],
        llmResolved: ["Alpha, Inc."],
      },
      {
        showId: "test-show",
        tier: "mid",
        split: "test",
        overindexTop: ["ZZZ"],
        llmTop: ["ZZZ"],
        sponsors: ["ZZZ"],
        llmSuggestions: ["ZZZ"],
        llmResolved: ["ZZZ"],
      },
    ], frequent, "dev");

    expect(scored.map((row) => row.showId)).toEqual(["north", "south"]);
    expect(scored[0]?.specificityOverindex).toBeCloseTo(1 / 3);
    expect(scored[0]?.genericOverindex).toBe(1);
    expect(scored[1]?.genericOverindex).toBeCloseTo(0.5);
    expect(scored[0]?.recallOverindex).toBeCloseTo(0.5);
    expect(scored[0]?.hitOverindex).toBe(1);
    expect(scored[0]?.llmCoverage).toBeCloseTo(0.5);
    const summary = summarizeQ2(scored, { synthetic: true, split: "dev" }, { resamples: 8, seed: 20261017 });
    expect(summary.specificityOverindex.mean).toBeCloseTo(1 / 3);
    expect(summary.recallOverindex.mean).toBeCloseTo(0.5);
    expect(summary.measured).toBe(2);
    const paired = q2Paired(scored, { resamples: 8, seed: 20261017 });
    expect(paired.specificityOverindexMinusLlm.mean).toBeCloseTo(0);
    expect(paired.recallOverindexMinusLlm.n).toBe(2);
  });
});

describe("aggregate scores", () => {
  const north = q1Row("north", "mid", 1, 0, 0.2, 0);
  const south = q1Row("south", "besar", 0, 1, 0.6, 0.2);

  it("averages synthetic per-show scores in memory", () => {
    const summary = summarizeQ1([south, north], { synthetic: true, split: "dev", excluded: 2 }, { resamples: 32, seed: 20261017 });
    const expected = referenceBootstrap([1, 0], 32, 20261017);
    expect(summary.methods.M1.recallAt10.mean).toBe(0.5);
    expect(summary.methods.M1.recallAt10.n).toBe(2);
    expect(summary.methods.M1.recallAt10.low).toBe(expected.low);
    expect(summary.methods.M1.recallAt10.high).toBe(expected.high);
    expect(summary.paired.ndcgAt10.m4MinusM2.mean).toBeCloseTo(0.3);
    expect(summary.strata.mid?.M1.recallAt10.mean).toBe(1);
    expect(summary.strata.besar?.M1.recallAt10.mean).toBe(0);
    expect(summary.excluded).toBe(2);
    expect(summary.synthetic).toBe(true);
  });

  it("writes synthetic scores outside eval/results and does not replace published files", () => {
    const summary = summarizeQ1([south, north], { synthetic: true, split: "dev", excluded: 0 }, { resamples: 4, seed: 20261017 });
    const published = publishedResultsDir();
    const before = existsSync(join(published, "q1.json")) ? readFileSync(join(published, "q1.json"), "utf8") : null;
    expect(() => writeAggregateReport(summary, published)).toThrow(/Synthetic aggregate scores/);
    if (before !== null) expect(readFileSync(join(published, "q1.json"), "utf8")).toBe(before);

    const directory = mkdtempSync(join(tmpdir(), "overindex-eval-"));
    try {
      const written = writeAggregateReport(summary, directory);
      expect(written.includes(join("eval", "results"))).toBe(false);
      const body = JSON.parse(readFileSync(written, "utf8")) as { synthetic: boolean; methods: { M1: { recallAt10: { mean: number } } } };
      expect(body.synthetic).toBe(true);
      expect(body.methods.M1.recallAt10.mean).toBe(0.5);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    expect(existsSync(directory)).toBe(false);
    if (before !== null) expect(readFileSync(join(published, "q1.json"), "utf8")).toBe(before);
  });

  it("writes a test aggregate under a separate name and refuses the dev file names", () => {
    const summary = summarizeQ1([{ ...north, split: "test" }], { synthetic: false, split: "test", excluded: 0 }, { resamples: 4, seed: 20261017 });
    const directory = mkdtempSync(join(tmpdir(), "overindex-eval-test-"));
    try {
      expect(() => writeTestAggregate(summary, directory, "q1.json")).toThrow(/untouched/);
      expect(() => writeTestAggregate(summary, directory, "q2.json")).toThrow(/untouched/);
      expect(() => writeTestAggregate(summary, directory, "tuning.json")).toThrow(/untouched/);
      expect(() => writeTestAggregate({ ...summary, split: "dev" }, directory, "q1-test.json")).toThrow(/test split/);
      const written = writeTestAggregate(summary, directory, "q1-test.json");
      expect(JSON.parse(readFileSync(written, "utf8")).split).toBe("test");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Q1 prompt", () => {
  it("fills the show and the brand ids without calling a model", () => {
    const rendered = renderQ1Prompt("A.1a", {
      showName: "Show North",
      showDescription: "Wood stories.",
      brands: [{ id: "alpha", name: "Alpha" }],
    });
    expect(rendered).toContain("Podcast: Show North");
    expect(rendered).toContain("Description: Wood stories.");
    expect(rendered).toContain("alpha: Alpha");
    expect(rendered).toContain("exactly 30 unique IDs");
    expect(renderQ1Prompt("A.1b", {
      showName: "Show North",
      showDescription: "Wood stories.",
      brands: [{ id: "alpha", name: "Alpha" }],
    })).toContain("what else they spend money on");
  });
});

function q1Row(showId: string, tier: "besar" | "mid", recall: number, ndcg: number, m4Ndcg: number, m2Ndcg: number): Q1ShowResult {
  const metric = (recallAt10: number, ndcgAt10: number) => ({ recallAt10, ndcgAt10 });
  return {
    showId,
    tier,
    split: "dev",
    relevantCount: 1,
    unscoredM3: 0,
    unscoredM4: 0,
    metrics: {
      M1: metric(recall, ndcg),
      M2: metric(recall, m2Ndcg),
      M3: metric(recall, ndcg),
      M4: metric(recall, m4Ndcg),
    },
  };
}
