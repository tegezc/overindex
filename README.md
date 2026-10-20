# overindex

> Work in progress for the *Qloo Agentic Hackathon: Agents, but with taste*.

overindex turns a podcast name into a **Sponsor Report**: the brands its audience over-indexes on according to Qloo's taste graph, split into proven buyers and greenfield prospects, with sourced pitch drafts.

## Status

QlooGateway is in place. LlmGateway calls the OpenAI Responses API. Sponsor discovery (`npm run report:cli`) builds a candidate table with lane and quadrant. The audience taste card is on the Confirm screen. The full report UI and evaluation are not built yet. No evaluation numbers exist yet.

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

Show flow: Home posts nothing until you submit. Confirm calls `POST /api/resolve` with `{ query }`. Confirming a candidate calls `POST /api/profile` with `{ entityId, name }` and renders the taste card. `name` is display-only.

## Deploy

Production target (D-025): one always-on, non-preemptible Compute Engine `e2-micro` in `us-central1-a`, with a 10 GB standard boot disk and `CACHE_DIR=/data` on that disk. No load balancer. The VM `overindex` (project `hackathon-460016`) is running that container. On 2026-10-20, `GET /api/health` on its public HTTP URL returned `qloo: ready`. The external IP is ephemeral.

`fly.toml` is a comment-only remnant of the previous host. It has no app or region. Do not run `fly deploy`.

Build the image on a machine with more than 1 GB of RAM. Do not run `docker build` on the `e2-micro`. The VM only starts an image that already exists, via `deploy/gce/run-container.sh`.

The image uses Node 22 or newer (at least 22.19), `@qloo/qloo-harness@0.1.26`, and a non-root user `app`. At build time that user sets the harness base URL to `https://hackathon.api.qloo.com`.

API keys are not in the image. Outside this repo, create a UTF-8 file with two lines and no quotes:

```
QLOO_API_KEY=...
OPENAI_API_KEY=...
```

Do not print that file, paste it into chat, or pass the values as `gcloud` arguments. Copy it to the VM and install it with `deploy/gce/install-env.sh`, which writes `/etc/overindex.env` mode 600 and prints only `QLOO_API_KEY set` and `OPENAI_API_KEY set`. On 2026-10-20 that script reported both names set. The values are not in this repo.

Public acceptance for this skeleton, met 2026-10-20: `GET /api/health` returned `qloo: ready`.

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

## Data handling

Qloo API responses are never committed to this repository. Runtime caches live in `CACHE_DIR`, outside the repo or git-ignored. `report:cli` prints the shortlist to the terminal and does not write brand names or Qloo bodies into the repository.

## License

[MIT](LICENSE)
