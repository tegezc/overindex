# overindex

> Work in progress for the *Qloo Agentic Hackathon: Agents, but with taste*.

overindex turns a podcast name into a **Sponsor Report**: the brands its audience over-indexes on according to Qloo's taste graph, split into proven buyers and greenfield prospects, with sourced pitch drafts.

## Status

QlooGateway is in place. LlmGateway calls the OpenAI Responses API. Sponsor discovery (`npm run report:cli`) builds a candidate table with lane and quadrant. Confirm can start a report. The report page streams a taste card, fit quadrant, Lane A, Lane B, a Without Qloo toggle, and a trace panel, with a status on each section. Opening a brand loads score components, evidence, provenance, and the intersection of TV recommendations for the show and the brand. Trend lookup is not called. Draft pitch is built from that evidence. Each claim is labeled Qloo or input Anda. Featured reports are cached files under `CACHE_DIR/featured/`. Home lists them with a data date. `GET /api/featured` returns the same list. Opening a featured report does not start a live report. `npm run featured:generate` runs the report pipeline for the working show list and writes those files. Do not commit them.

`POST /api/report` allows 3 live starts per address per calendar day in WIB, and 50 across all addresses, unless the env limits say otherwise. The next start returns 429 and tells you to open a featured report. The check happens before any Qloo call.

The report page has a print view: taste card, the five highest-fit brands, and a short method note. The Method page describes the protocol, the test-split figures, and the limits.

The eval harness checks the stored split and computes rankings, metrics, and bootstrap intervals from data the caller supplies. It does not call Qloo or OpenAI. `npm run eval:dev` records aggregate dev scores under `eval/results/`. `npm run eval:test` measures the test split once with the locked settings and writes `q1-test.json`, `q2-test.json`, and `test-run.json` beside the dev files.

## Evaluation

One test run finished at 2026-10-21 03:17 WIB. It was not repeated. Locked settings: alpha 1, lambda 0, prompt A.1a, baseline basket-8, no quadrant threshold. Product fit now uses that same alpha, 1, so fit equals the show percentile. The quadrant cutoff stays 0.7 because the locked threshold is none. That cutoff was not a result of the test run.

No difference was detected between overindex and the language-model list on the test split (n = 15). The Jaccard difference (overindex minus the language-model list) is -0.0094 (95% CI -0.0223 to 0.0048). That interval does not lie entirely below zero. The recall@20 difference is -0.1064 (95% CI -0.2193 to -0.0255). That interval lies entirely below zero. A tighter list is not reported as better unless both conditions hold.

No difference was detected between hybrid and the language-model ranking on nDCG@10 (n = 9). The paired difference is 0.0492 (95% CI -0.1182 to 0.2158). Hybrid and popularity returned the same nDCG@10, 0.7659 (95% CI 0.5131 to 0.9636). With lambda 0, the hybrid score is the popularity percentile.

The test split has 20 shows. 15 resolved. Q2 measured those 15 and skipped 5 unresolved shows: `all-on-the-table`, `chewed-up`, `good-hang`, `locked-on-big-12`, `post-games`. Q1 measured 9 and excluded 11: the same 5 unresolved shows, plus 6 resolved shows whose sponsors were not in the candidate set (`business-of-home`, `courageous-parenting`, `diary-of-a-ceo`, `haunted-american-history`, `liz-moody`, `morbid`). Q1 strata: 4 large, 5 mid-tier. Q2 strata: 6 large, 9 mid-tier. Ground-truth brands resolved 13 of 176. Language-model suggestion coverage is 0.6267 (95% CI 0.5333 to 0.7033, n = 15). Baseline basket returned a signal for 6 of 8 shows. Every Q1 candidate list was shorter than 30. Mean unscored brands for M3 and M4 were 0. Qloo calls: 417 (312 describe, 105 insights). Cache hits in this process: 337. OpenAI calls: 24. Rank was not called. Intervals are percentile bootstrap means, 10,000 resamples, seed 20261017. Cells below are mean (95% CI). Columns are all shows, large shows, and mid-tier shows.

### Q2, overindex versus the language-model list

| Metric | All (n = 15) | Large (n = 6) | Mid-tier (n = 9) |
| --- | --- | --- | --- |
| Jaccard, overindex | 0.0191 (0.0101–0.0291) | 0.0174 (0.0025–0.0329) | 0.0203 (0.0096–0.0329) |
| Jaccard, language model | 0.0286 (0.0177–0.0400) | 0.0408 (0.0238–0.0576) | 0.0204 (0.0092–0.0337) |
| Jaccard difference | -0.0094 (-0.0223–0.0048) | -0.0234 (-0.0355–-0.0122) | -0.0001 (-0.0184–0.0194) |
| Generic share, overindex | 0.0100 (0.0000–0.0267) | 0.0167 (0.0000–0.0500) | 0.0056 (0.0000–0.0167) |
| Generic share, language model | 0.1067 (0.0633–0.1533) | 0.1417 (0.0667–0.2167) | 0.0833 (0.0333–0.1389) |
| recall@20, overindex | 0.0111 (0.0000–0.0333) | 0.0278 (0.0000–0.0833) | 0.0000 (0.0000–0.0000) |
| recall@20, language model | 0.1175 (0.0405–0.2279) | 0.2403 (0.0875–0.4545) | 0.0357 (0.0000–0.0784) |
| recall@20 difference | -0.1064 (-0.2193–-0.0255) | -0.2125 (-0.4407–-0.0341) | -0.0357 (-0.0784–0.0000) |
| Hit rate, overindex | 0.0667 (0.0000–0.2000) | 0.1667 (0.0000–0.5000) | 0.0000 (0.0000–0.0000) |
| Hit rate, language model | 0.5333 (0.2667–0.8000) | 0.8333 (0.5000–1.0000) | 0.3333 (0.0000–0.6667) |
| Suggestion coverage | 0.6267 (0.5333–0.7033) | 0.7375 (0.6708–0.7917) | 0.5528 (0.4306–0.6528) |

### Q2 secondary, Lane B

Measured 15. Skipped 5. This is not the pre-registered comparison. recall@20 and hit rate are 0 for both lists in every stratum.

| Metric | All (n = 15) | Large (n = 6) | Mid-tier (n = 9) |
| --- | --- | --- | --- |
| Jaccard, overindex | 0.0191 (0.0101–0.0291) | 0.0174 (0.0025–0.0329) | 0.0203 (0.0096–0.0329) |
| Jaccard, language model | 0.0240 (0.0158–0.0324) | 0.0348 (0.0206–0.0475) | 0.0168 (0.0091–0.0246) |
| Jaccard difference | -0.0048 (-0.0154–0.0074) | -0.0174 (-0.0288–-0.0063) | 0.0035 (-0.0100–0.0199) |
| recall@20, both lists | 0.0000 (0.0000–0.0000) | 0.0000 (0.0000–0.0000) | 0.0000 (0.0000–0.0000) |
| Hit rate, both lists | 0.0000 (0.0000–0.0000) | 0.0000 (0.0000–0.0000) | 0.0000 (0.0000–0.0000) |

### Q1, same candidate set

| Method | Metric | All (n = 9) | Large (n = 4) | Mid-tier (n = 5) |
| --- | --- | --- | --- | --- |
| M1 Popularity | recall@10 | 0.8889 (0.6667–1.0000) | 0.7500 (0.2500–1.0000) | 1.0000 (1.0000–1.0000) |
| M1 Popularity | nDCG@10 | 0.7659 (0.5131–0.9636) | 0.4933 (0.1505–0.8360) | 0.9839 (0.9518–1.0000) |
| M2 LLM-only | recall@10 | 1.0000 (1.0000–1.0000) | 1.0000 (1.0000–1.0000) | 1.0000 (1.0000–1.0000) |
| M2 LLM-only | nDCG@10 | 0.7167 (0.5593–0.8710) | 0.4949 (0.3508–0.6341) | 0.8941 (0.7625–0.9839) |
| M3 Qloo affinity | recall@10 | 1.0000 (1.0000–1.0000) | 1.0000 (1.0000–1.0000) | 1.0000 (1.0000–1.0000) |
| M3 Qloo affinity | nDCG@10 | 0.7075 (0.5274–0.8817) | 0.6797 (0.4167–0.9427) | 0.7298 (0.4933–0.9663) |
| M4 Hybrid | recall@10 | 0.8889 (0.6667–1.0000) | 0.7500 (0.2500–1.0000) | 1.0000 (1.0000–1.0000) |
| M4 Hybrid | nDCG@10 | 0.7659 (0.5131–0.9636) | 0.4933 (0.1505–0.8360) | 0.9839 (0.9518–1.0000) |

Paired nDCG@10: M4−M2 0.0492 (-0.1182–0.2158); M4−M1 0.0000 (0.0000–0.0000); M3−M2 -0.0091 (-0.2459–0.2103); M3−M1 -0.0583 (-0.3613–0.2804). Paired recall@10: M4−M2 -0.1111 (-0.3333–0.0000); M4−M1 0.0000 (0.0000–0.0000); M3−M2 0.0000 (0.0000–0.0000); M3−M1 0.1111 (0.0000–0.3333).

Actual sponsors are not the same as best fit. The language model may already know older sponsors. A popularity baseline can win the secondary comparison. Qloo coverage limits which shows are scored. A brand name can resolve to the wrong entity. The taste-graph date and the episode date can differ. The taste-graph signal might already reflect podcast advertising. The test split is small. No blind preference test has been run, so this product does not claim that people prefer it. The same limits are on the Method page. Aggregate files do not contain Qloo response bodies, entity IDs, or raw brand lists.

## Requirements

- Node.js >= 22.19.0
- `@qloo/qloo-harness` >= 0.1.26 (`npm install --global @qloo/qloo-harness`)
- A Qloo hackathon API key and an OpenAI API key (not needed for `USE_FAKE_QLOO=true`)

## Setup

```bash
npm install
cp .env.example .env.local   # fill in locally; never commit
qloo setup --qloo            # enter your own Qloo key interactively
qloo api config set base-url https://hackathon.api.qloo.com
npm run dev
```

Hackathon keys only work against `https://hackathon.api.qloo.com`; the harness defaults to another host, so the `base-url` step is required.

Health check: `GET /api/health`.

Show flow: Home posts nothing until you submit. It also lists featured reports from `CACHE_DIR`. Confirm calls `POST /api/resolve` with `{ query }`. Confirming a candidate calls `POST /api/profile` with `{ entityId, name }` and renders the taste card. `name` is display-only. Build report calls `POST /api/report` with `{ input: { showQuery }, showId }` and opens `/r/[reportId]`, which reads `GET /api/report/[id]` and the SSE stream at `GET /api/report/[id]/events`. A featured id is read from `CACHE_DIR/featured` when it is not an in-memory job. Brand and pitch use that same file. A stored report builds the drawer from the candidate already on it. If bridge evidence was not saved, the bridge status is `skipped` and that open does not call Qloo. After a live report completes, a brand row still calls `GET /api/report/[id]/brand/[brandId]`, and that in-memory path can request TV recommendations. Draft pitch calls `POST /api/report/[id]/pitch` with `{ brandId }`. Method is `/method`. Print media kit uses the browser print dialog on the report page.

## Deploy

Production target (D-025): one always-on, non-preemptible Compute Engine `e2-micro` in `us-central1-a`, with a 10 GB standard boot disk and `CACHE_DIR=/data` on that disk. No load balancer. The VM `overindex` (project `hackathon-460016`) is running `overindex:s10c`. On 2026-10-22, `GET /api/health` on `http://34.67.15.187/api/health` returned `qloo: ready`. That external IP is ephemeral. `GET /api/featured` still returns four cached reports dated 2026-10-21: This Week in Startups, SmartLess, New Heights with Jason & Travis Kelce, and Gastropod. The image copies `shows.csv` and `lane_a_buyers.csv` only (D-029). Ground truth stays out of the image. `overindex:s10a` and `overindex:s2b` remain on the VM disk and are not the running container.

`fly.toml` is a comment-only remnant of the previous host. It has no app or region. Do not run `fly deploy`.

Build the image on a machine with more than 1 GB of RAM. Do not run `docker build` on the `e2-micro`. The VM only starts an image that already exists, via `deploy/gce/run-container.sh`.

The image uses Node 22 or newer (at least 22.19), `@qloo/qloo-harness@0.1.26`, and a non-root user `app`. At build time that user sets the harness base URL to `https://hackathon.api.qloo.com`.

API keys are not in the image. Outside this repo, create a UTF-8 file with two lines and no quotes:

```
QLOO_API_KEY=...
OPENAI_API_KEY=...
```

Do not print that file, paste it into chat, or pass the values as `gcloud` arguments. Copy it to the VM and install it with `deploy/gce/install-env.sh`, which writes `/etc/overindex.env` mode 600 and prints only `QLOO_API_KEY set` and `OPENAI_API_KEY set`. On 2026-10-20 that script reported both names set. The values are not in this repo.

Public health for the current image, checked 2026-10-21: `GET /api/health` returned `qloo: ready`. The 2026-10-20 check was the skeleton image.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (standalone output) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run qloo:smoke` | Live `qloo_capabilities` plus one `describe`. Prints status only |
| `npm run llm:baseline -- "<show>" "<description>"` | Live `llm_baseline`. Prints 40 schema-valid brands. Requires `OPENAI_API_KEY` in the process environment |
| `npm run report:cli -- "<show>"` | Live sponsor shortlist. Prints lane and quadrant. Optional `--sponsors` and `--exclude`. At most `QLOO_BUDGET_CAP` Qloo calls |
| `npm run featured:generate -- ["Show A" "Show B"]` | Runs the report pipeline and writes each finished report to `CACHE_DIR/featured/<id>.json` with a data date. With no names, uses the working list in the script. Never commit that directory. A fresh server disk needs this script again |
| `npm run eval:dev` | Live dev-split eval. Writes aggregate scores to `eval/results/`. Requires `OPENAI_API_KEY` in the process environment. Does not measure the test split |
| `npm run eval:test` | One live test-split measurement with the locked settings. Writes `q1-test.json`, `q2-test.json`, and `test-run.json`. Refuses a second run and a resume after quota |

## Data handling

Qloo API responses are never committed to this repository. Runtime caches live in `CACHE_DIR`, outside the repo or git-ignored. `report:cli` prints the shortlist to the terminal and does not write brand names or Qloo bodies into the repository.

## License

[MIT](LICENSE)
