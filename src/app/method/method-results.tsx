import path from "node:path";
import { loadShowsCsv } from "../../../eval/src/dataset";
import { formatMetric, q1ClaimSentence, q2ClaimSentence } from "../../../eval/src/claims";
import q1 from "../../../eval/results/q1-test.json";
import q2 from "../../../eval/results/q2-test.json";
import run from "../../../eval/results/test-run.json";

type Interval = { mean: number; low: number; high: number; n: number };

const q1Methods = [
  ["M1", "Popularity"],
  ["M2", "LLM-only"],
  ["M3", "Qloo affinity"],
  ["M4", "Hybrid"],
] as const;

export default function MethodResults() {
  const shows = loadShowsCsv(path.join(process.cwd(), "eval/dataset/shows.csv"));
  const resolved = new Set(run.resolvedShowIds);
  const measuredQ1 = new Set(run.measuredQ1ShowIds);
  const testShows = shows.filter((show) => show.split === "test");
  const unresolved = testShows.filter((show) => !resolved.has(show.showId)).map((show) => show.showId);
  const emptyRelevance = testShows
    .filter((show) => resolved.has(show.showId) && !measuredQ1.has(show.showId))
    .map((show) => show.showId);
  const jaccard = q2.paired.specificityOverindexMinusLlm;
  const recall = q2.paired.recallOverindexMinusLlm;
  const ndcg = q1.paired.ndcgAt10.m4MinusM2;
  const hybridVsPopularity = q1.paired.ndcgAt10.m4MinusM1;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-lg font-medium">{q2ClaimSentence(jaccard, recall)}</p>
        <p className="text-sm">
          {jaccard.high < 0
            ? "The Jaccard difference interval lies entirely below zero."
            : "The Jaccard difference interval does not lie entirely below zero."}{" "}
          {recall.high >= 0
            ? "The recall@20 difference interval is not entirely below zero."
            : "The recall@20 difference interval lies entirely below zero."}{" "}
          Specificity here means average pairwise Jaccard of the top 20. Lower Jaccard is tighter, and it is not treated as better unless the recall condition also holds.
        </p>
        <p className="text-sm">{q1ClaimSentence(ndcg)}</p>
        {hybridVsPopularity.low === 0 && hybridVsPopularity.high === 0 ? (
          <p className="text-sm">
            Hybrid and popularity returned the same nDCG@10. The locked lambda is 0, so the hybrid score is the popularity percentile.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <p>
          One test run, finished {run.finishedAt}. Locked settings: alpha {run.locked.alpha}, lambda {run.locked.lambda}, prompt{" "}
          {run.locked.promptVariant}, baseline {run.locked.baselineLift}, quadrant threshold{" "}
          {run.locked.quadrantThreshold === null ? "none" : String(run.locked.quadrantThreshold)}. The run was not repeated.
        </p>
        <p>
          Test split: {testShows.length} shows. Shows resolved {run.showResolution.resolved} of {run.showResolution.attempted}. Q1 measured{" "}
          {q1.measured} and excluded {q1.excluded} ({run.exclusionCounts.show_unresolved} unresolved, {run.exclusionCounts.empty_relevance} with no
          relevant sponsor inside the candidate set). Q2 measured {q2.measured} and skipped {run.q2Skipped}. Large shows in Q1:{" "}
          {q1.strata.besar?.M1.recallAt10.n ?? 0}. Mid-tier shows in Q1: {q1.strata.mid?.M1.recallAt10.n ?? 0}. Large shows in Q2:{" "}
          {q2.strata.besar?.measured ?? 0}. Mid-tier shows in Q2: {q2.strata.mid?.measured ?? 0}.
        </p>
        <p>Unresolved shows: {unresolved.join(", ")}. Resolved shows left out of Q1: {emptyRelevance.join(", ")}.</p>
        <p>
          Ground-truth brands resolved {run.brandResolution.resolved} of {run.brandResolution.attempted}. Language-model suggestion coverage{" "}
          {interval(q2.llmCoverage)}. Baseline basket signals {run.basketSignals} of 8. Every Q1 candidate list was shorter than 30 ({run.shortCandidateLists} of{" "}
          {run.measuredQ1}). Mean unscored brands in M3 and M4: {formatMetric(run.meanUnscoredM3)} and {formatMetric(run.meanUnscoredM4)}.
        </p>
        <p>
          Qloo calls {run.qlooCalls}: describe {run.tools.qloo_describe}, insights {run.tools["api:insights"]}. Cache hits in this process{" "}
          {run.qlooCacheHitsThisProcess}. OpenAI calls {run.openaiCalls}. Rank was not called. Intervals are percentile bootstrap means, 10000 resamples, seed
          20261017.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Q2 main comparison, L-OI minus L-LLM</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-current/20">
                <th className="py-2 pr-3 font-medium">Metric</th>
                <th className="py-2 pr-3 font-medium">All</th>
                <th className="py-2 pr-3 font-medium">Large</th>
                <th className="py-2 font-medium">Mid-tier</th>
              </tr>
            </thead>
            <tbody>
              {q2Rows(q2).map((row) => (
                <tr key={row.label} className="border-b border-current/10 align-top">
                  <th className="py-2 pr-3 font-medium">{row.label}</th>
                  <td className="py-2 pr-3">{cell(row.all)}</td>
                  <td className="py-2 pr-3">{cell(row.besar)}</td>
                  <td className="py-2">{cell(row.mid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Q2 secondary comparison, Lane B</h3>
        <p className="text-sm">
          L-OI-B is the top 20 outside Lane A. L-LLM-B is the language-model list outside Lane A. This comparison is reported. It is not the pre-registered claim.
          Measured {q2.secondary.measured}. Skipped {q2.secondary.skipped}.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-current/20">
                <th className="py-2 pr-3 font-medium">Metric</th>
                <th className="py-2 pr-3 font-medium">All</th>
                <th className="py-2 pr-3 font-medium">Large</th>
                <th className="py-2 font-medium">Mid-tier</th>
              </tr>
            </thead>
            <tbody>
              {secondaryRows(q2.secondary).map((row) => (
                <tr key={row.label} className="border-b border-current/10 align-top">
                  <th className="py-2 pr-3 font-medium">{row.label}</th>
                  <td className="py-2 pr-3">{cell(row.all)}</td>
                  <td className="py-2 pr-3">{cell(row.besar)}</td>
                  <td className="py-2">{cell(row.mid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Q1 ranking on the same candidate set</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-current/20">
                <th className="py-2 pr-3 font-medium">Method</th>
                <th className="py-2 pr-3 font-medium">recall@10</th>
                <th className="py-2 font-medium">nDCG@10</th>
              </tr>
            </thead>
            <tbody>
              {q1Methods.flatMap(([id, label]) =>
                (["all", "besar", "mid"] as const).map((stratum) => {
                  const block = stratum === "all" ? q1.methods : q1.strata[stratum];
                  const metrics = block?.[id];
                  return (
                    <tr key={`${id}-${stratum}`} className="border-b border-current/10 align-top">
                      <th className="py-2 pr-3 font-medium">
                        {label}
                        <span className="block text-xs font-normal opacity-70">{stratum === "all" ? "All" : stratum === "besar" ? "Large" : "Mid-tier"}</span>
                      </th>
                      <td className="py-2 pr-3">{metrics ? cell(metrics.recallAt10) : "—"}</td>
                      <td className="py-2">{metrics ? cell(metrics.ndcgAt10) : "—"}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
        <p className="text-sm">
          Paired nDCG@10, M4 minus M2: {interval(ndcg)}. M4 minus M1: {interval(hybridVsPopularity)}. M3 minus M2:{" "}
          {interval(q1.paired.ndcgAt10.m3MinusM2)}. M3 minus M1: {interval(q1.paired.ndcgAt10.m3MinusM1)}.
        </p>
        <p className="text-sm">
          Paired recall@10, M4 minus M2: {interval(q1.paired.recallAt10.m4MinusM2)}. M4 minus M1: {interval(q1.paired.recallAt10.m4MinusM1)}. M3 minus M2:{" "}
          {interval(q1.paired.recallAt10.m3MinusM2)}. M3 minus M1: {interval(q1.paired.recallAt10.m3MinusM1)}.
        </p>
      </div>
    </div>
  );
}

function q2Rows(report: typeof q2) {
  const besar = report.strata.besar;
  const mid = report.strata.mid;
  return [
    row("Jaccard, overindex", report.specificityOverindex, besar?.specificityOverindex, mid?.specificityOverindex),
    row("Jaccard, language model", report.specificityLlm, besar?.specificityLlm, mid?.specificityLlm),
    row("Jaccard difference", report.paired.specificityOverindexMinusLlm, report.pairedStrata.besar?.specificityOverindexMinusLlm, report.pairedStrata.mid?.specificityOverindexMinusLlm),
    row("Generic share, overindex", report.genericOverindex, besar?.genericOverindex, mid?.genericOverindex),
    row("Generic share, language model", report.genericLlm, besar?.genericLlm, mid?.genericLlm),
    row("recall@20, overindex", report.recallOverindex, besar?.recallOverindex, mid?.recallOverindex),
    row("recall@20, language model", report.recallLlm, besar?.recallLlm, mid?.recallLlm),
    row("recall@20 difference", report.paired.recallOverindexMinusLlm, report.pairedStrata.besar?.recallOverindexMinusLlm, report.pairedStrata.mid?.recallOverindexMinusLlm),
    row("Hit rate, overindex", report.hitOverindex, besar?.hitOverindex, mid?.hitOverindex),
    row("Hit rate, language model", report.hitLlm, besar?.hitLlm, mid?.hitLlm),
    row("Suggestion coverage", report.llmCoverage, besar?.llmCoverage, mid?.llmCoverage),
  ];
}

function secondaryRows(secondary: typeof q2.secondary) {
  return [
    row("Jaccard, overindex", secondary.specificityOverindex, secondary.strata.besar?.specificityOverindex, secondary.strata.mid?.specificityOverindex),
    row("Jaccard, language model", secondary.specificityLlm, secondary.strata.besar?.specificityLlm, secondary.strata.mid?.specificityLlm),
    row("Jaccard difference", secondary.paired.specificityOverindexMinusLlm, secondary.pairedStrata.besar?.specificityOverindexMinusLlm, secondary.pairedStrata.mid?.specificityOverindexMinusLlm),
    row("recall@20, overindex", secondary.recallOverindex, secondary.strata.besar?.recallOverindex, secondary.strata.mid?.recallOverindex),
    row("recall@20, language model", secondary.recallLlm, secondary.strata.besar?.recallLlm, secondary.strata.mid?.recallLlm),
    row("recall@20 difference", secondary.paired.recallOverindexMinusLlm, secondary.pairedStrata.besar?.recallOverindexMinusLlm, secondary.pairedStrata.mid?.recallOverindexMinusLlm),
    row("Hit rate, overindex", secondary.hitOverindex, secondary.strata.besar?.hitOverindex, secondary.strata.mid?.hitOverindex),
    row("Hit rate, language model", secondary.hitLlm, secondary.strata.besar?.hitLlm, secondary.strata.mid?.hitLlm),
  ];
}

function row(label: string, all: Interval | null | undefined, besar: Interval | null | undefined, mid: Interval | null | undefined) {
  return { label, all: all ?? null, besar: besar ?? null, mid: mid ?? null };
}

function cell(value: Interval | null) {
  if (!value) return "—";
  return (
    <>
      {formatMetric(value.mean)}
      <span className="block text-xs opacity-70">
        {formatMetric(value.low)} to {formatMetric(value.high)}, n={value.n}
      </span>
    </>
  );
}

function interval(value: Interval): string {
  return `${formatMetric(value.mean)} (${formatMetric(value.low)} to ${formatMetric(value.high)}, n = ${value.n})`;
}
