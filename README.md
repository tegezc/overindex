# overindex

A podcast name goes in. A Sponsor Report comes out: brands the show's audience over-indexes on in Qloo's taste graph, placed in a fit quadrant, with a sourced pitch.

This repository is the submission for the Qloo Agentic Hackathon. The public demo is the thing to try. Local setup is below for a judge who wants to run it from an empty checkout.

## Problem

Mid-tier podcasters pitch sponsors by category. Shows in the same category then pitch the same brands. A host-read ad trades on audience taste, not on the topic label.

overindex keeps those two questions apart. Qloo scores a shared candidate set. A language model, with no taste graph, writes a separate list. The report shows both. The test on 2026-10-21 did not find a difference between them. That result is in [Limitations](#limitations). This project does not claim to beat a language-model list, and it does not claim that people prefer it.

## Public demo

[http://34.67.15.187](http://34.67.15.187)

Checked 2026-10-22: one Compute Engine instance named `overindex`, project `hackathon-460016`, zone `us-central1-a`, status `RUNNING`, external IP `34.67.15.187`. `GET /api/health` returned `{"ok":true,"qloo":"ready","llm":"configured"}`.

That IP is ephemeral. If it changes, this URL is wrong. Do not stop the VM while this README still names this address. Check the address again on the day you submit.

Open a featured report first. Four cached reports are dated `2026-10-21`: This Week in Startups, SmartLess, New Heights with Jason & Travis Kelce, and Gastropod. Opening one does not start a live report and does not call Qloo.

A live report is capped at 3 starts per address per calendar day in WIB (UTC+7). A start that fails still counts. The next start returns 429 and links to the featured list. No API key is required to use the public demo.

## What a report shows

- An audience taste card. Tags, artists, TV shows, movies, books, and demographics. Each block has its own status. The figures are aggregate taste-graph values, not statements about a person.
- A fit quadrant: Proven, Hidden, or Category-only. Brands low on both axes are left off the chart. A run can have an empty quadrant. That is shown as empty.
- Lane A, Ready buyers: brands that appear in the public podcast-ad ground truth. Lane B, Greenfield: the rest.
- A **Without Qloo** toggle. It opens the language-model list and labels each row `model list, no taste graph`.
- A brand drawer. **Draft pitch** builds sentences from evidence already on the report. Each claim is labeled `Qloo` or `input Anda`. There is no send-email button.
- On a cached featured report, shared-TV bridge status is `skipped` when that evidence was not saved. Opening the brand does not call Qloo. Trend lookup is not called.
- A trace and a Qloo call budget on the report. The Method page is at `/method`.

## Workflow and tools

There is no agent framework. A fixed orchestrator calls Qloo. The model does not choose tools.

Qloo is reached only through the official harness. Workflows use `qloo mcp`. Scoring and popularity filters use `qloo api insights`, because those parameters are not on the recommend workflow. The process refuses to call unless the local harness base URL is `https://hackathon.api.qloo.com`. The harness sends `X-Api-Key` from the server environment. The browser never receives the key. This app does not call the API with its own `fetch`.

A live report does this:

1. `qloo_describe` resolves the podcast. A confident match continues. `needs_input` shows every candidate and waits. No candidates returns `empty` and explains that nothing matched. It does not render an error page, and it does not invent a proxy list.
2. `disambiguate_show` is a structured model call. It may narrow a semantic match. It does not hide candidates when Qloo already asked for a choice.
3. The taste card calls `qloo_entity_tags`, `qloo_audience_demographics`, and `qloo_recommend` for artist, TV show, movie, and book.
4. `llm_baseline` is the other structured model call. It returns the Without Qloo list. It receives the show name and a description. It does not receive affinity scores.
5. Brand discovery uses `qloo api insights` with two popularity bands. `qloo_recommend` cannot express that filter.
6. Names from the model list, the ready-buyer catalog, and any sponsors typed in are resolved with `qloo_describe`, inside the call budget.
7. The shared candidate set is scored with `qloo api insights` and `filter.results.entities`. `qloo_rank` is not used. The same insights call, with a fixed basket of eight podcasts, produces the baseline. Fit uses alpha 1, so fit equals the show percentile. The quadrant cutoff on a report is 0.7. That cutoff was not an evaluation result.
8. **Draft pitch** does not call a model. `check_claims` drops numbers that are not in the evidence, causal sentences, and claims about an individual.

Not called on this path: `qloo_rank`, `qloo_compare_audiences`, and trend lookup.

Opening a brand on a report that is still in server memory can call `qloo_recommend` twice, for TV shows the show audience and the brand audience both surface. A featured report read from disk does not take that path.

The hard cap is 40 Qloo calls per report. The target is 25. Past the plan, the candidate section is marked `partial` and the run stops adding calls.

## Redacted example

One public live report, 2026-10-22, show query `Crime Junkie`. No response body, entity id, brand name, or key is included. Counts are the aggregates already recorded for that run.

```text
POST /api/resolve
  query: Crime Junkie
  status: ok
  duration: 569 ms

POST /api/report
  HTTP: 202
  done: 43.7 s (43667 ms)
  mode: direct
  confidence: medium
  taste card: ok
  candidates: partial
  Without Qloo: ok
  budget.used: 38
  budget.target: 25
  budget.cap: 40
  trace events: 88
  tool_result events: 40
  qloo_describe: 28
  api:insights: 6
  qloo_recommend: 4
  qloo_entity_tags: 1
  qloo_audience_demographics: 1
  qloo_rank: not called
  qloo_compare_audiences: not called
  qloo_trends: not called
```

Forty tool results were recorded and `budget.used` is 38, so two trace results did not add to the budget.

A later open of one cached featured brand, same day, did not call Qloo. The drawer showed 9 claims, labeled `Qloo` and `input Anda`. Bridge status was `skipped`. There was no email button.

## Setup

Requirements:

- Node.js >= 22.19.0
- npm
- `@qloo/qloo-harness` >= 0.1.26
- A Qloo hackathon API key, for live calls
- An OpenAI API key, for live calls

The public demo does not need either key. `USE_FAKE_QLOO=true` runs the UI on synthetic data and also needs no keys. Synthetic data is not the public demo.

```bash
git clone https://github.com/tegezc/overindex.git
cd overindex
npm install
npm install --global @qloo/qloo-harness@0.1.26
qloo setup --qloo
qloo api config set base-url https://hackathon.api.qloo.com
```

Copy `.env.example` to `.env.local`. Fill in `OPENAI_API_KEY` locally. Leave `QLOO_API_KEY` empty if `qloo setup --qloo` already stored the key for the harness. Never commit `.env.local`. Never put a key in the frontend, a screenshot, or a log.

On Windows the server starts the harness entry with `node`. You still need the `qloo` command on `PATH` so the base-URL check can run. Hackathon keys are rejected by the harness default host, so the `base-url` command is required.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Health check: `GET /api/health`.

Featured reports are not in this repository. A fresh machine shows an empty featured list until you generate one. `npm run featured:generate` calls Qloo. Use the public demo if you only need to read a finished report.

`npm test` does not call Qloo or OpenAI. Do not run `npm run eval:test`. The test split was measured once, on 2026-10-21 03:17 WIB, and the script refuses a second run. `npm run eval:dev` is also a live run. It is not part of setup.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit tests. No live API calls |
| `npm run qloo:smoke` | One live capabilities check and one describe. Prints status only |
| `npm run report:cli -- "<show>"` | Live shortlist in the terminal. Stops at the Qloo call cap |

## Screenshots

Public UI only, saved 2026-10-22. They are not a substitute for the demo. They do not include a terminal, an env file, or a log.

| File | What it shows |
| --- | --- |
| `submission/screenshots/home-featured.png` | Home. Four featured reports dated 2026-10-21 |
| `submission/screenshots/featured-taste-card.png` | Taste card, tags, status ok |
| `submission/screenshots/featured-taste-domains.png` | Taste card domains |
| `submission/screenshots/featured-quadrant.png` | Fit quadrant |
| `submission/screenshots/featured-without-qloo.png` | Without Qloo toggle open |
| `submission/screenshots/featured-bridge-skipped.png` | Drawer. Bridge skipped. Trend skipped. No email button |
| `submission/screenshots/featured-claim-drawer.png` | Pitch heading and the first source labels |
| `submission/screenshots/featured-claim-labels.png` | Nine claims labeled `Qloo` or `input Anda` |
| `submission/screenshots/method-results.png` | Method. No difference was detected |
| `submission/screenshots/method-limitations.png` | Method limitations, including no preference test |

## Limitations

One test run finished at 2026-10-21 03:17 WIB. It was not repeated. Locked settings: alpha 1, lambda 0, prompt A.1a, baseline basket-8, no quadrant threshold. The full tables are on the public Method page.

No difference was detected between overindex and the language-model list (n = 15). The Jaccard difference, overindex minus the language-model list, is -0.0094 (95% CI -0.0223 to 0.0048). That interval does not lie entirely below zero. The recall@20 difference is -0.1064 (95% CI -0.2193 to -0.0255). That interval lies entirely below zero. A tighter list is not treated as better unless both conditions hold.

No difference was detected on nDCG@10 between hybrid and the language-model ranking (n = 9). The paired difference, hybrid minus the language-model ranking, is 0.0492 (95% CI -0.1182 to 0.2158). With lambda 0, the hybrid score is the popularity percentile, and hybrid nDCG@10 matched popularity at 0.7659 (95% CI 0.5131 to 0.9636).

The test split has 20 shows. 15 resolved. Q2 measured 15. Q1 measured 9. Ground-truth brands resolved 13 of 176. No blind preference test has been run.

Other limits, also on the Method page:

- The taste card is an aggregate from Qloo's taste graph. It is not a survey of that show's listeners. There is no causal claim and no claim about an individual.
- An actual sponsor is not the same thing as best fit.
- The language model may already know older sponsors.
- A brand name can resolve to the wrong entity. Coverage gaps stay labeled.
- The taste-graph date and the episode date can differ. The graph may already reflect podcast advertising.
- The quadrant cutoff 0.7 is a product rule. The locked evaluation threshold is none.
- Qloo responses are not committed. Caches stay in `CACHE_DIR`, outside the repo or git-ignored.

## License

[MIT](LICENSE). The copyright line still says `overindex contributors` until the rights holder replaces it.
