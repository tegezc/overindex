/** Shown until S9 records a test run. This is not a numeric result. */
export const METHOD_RESULTS = "results pending";

export const METHOD_RESULTS_NOTE =
  "Evaluation results are not available yet. After the locked test run, this page will show the metrics, confidence intervals, and sample size. No figure is filled in before that.";

export const METHOD_KIT_NOTE =
  "Method: affinity percentile versus a published baseline basket, then lift and fit. Evaluation results pending. These are aggregate taste-graph figures, not claims about individual listeners. An actual sponsor is not the same thing as best fit.";

export const METHOD_PROTOCOL = [
  "Ground truth is a public sponsor mention with a source URL. The dataset was frozen before any evaluation run.",
  "The run order is the dev split, then a locked scoring configuration, then one test run.",
  "The main comparison is this product's shortlist against the same model's list with no taste graph.",
  "A tighter list is not a better list unless recall stays in range. That rule is already written down. The numbers are not.",
  "Qloo response bodies are not published.",
] as const;

export const METHOD_READING = [
  "Affinity percentile is where a brand sits among the brands scored for that show. The highest score in the sample is the top of that sample.",
  "Lift is the show percentile minus the baseline percentile.",
  "Fit mixes the show percentile and a rescaled lift.",
  "Proven means the model listed the brand and fit is high. Hidden means fit is high and the model did not list it among its predicted ranks. Category-only means the model listed it and fit is not high. Category-only is not a claim that the brand would refuse the show.",
  "Lane A is a brand that has bought a podcast ad in the public ground truth. Lane B has not.",
  "A number on a report is an aggregate from the taste graph, or a figure you typed. It is not a statement about a person.",
] as const;

export const METHOD_LIMITATIONS = [
  "Actual sponsors are not the same as best fit. Deals, dynamic insertion, and bundles sit outside the taste graph.",
  "The language model may already know older sponsors of well-known shows. Reported results will be split by show size.",
  "A popularity baseline can win the secondary comparison because podcast ads cluster on repeat buyers. The main comparison is the one that does not rely on that.",
  "Qloo coverage limits which shows can be scored. Coverage will be reported as a finding, not hidden.",
  "A brand name can resolve to the wrong entity.",
  "The taste-graph date and the episode date can differ.",
  "The taste-graph signal might already reflect podcast ad exposure.",
  "The test split is small, so an interval can be wide.",
  "No blind preference test has been run. This product does not claim that people prefer it.",
] as const;
