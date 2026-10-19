# overindex

> Work in progress for the *Qloo Agentic Hackathon: Agents, but with taste*.

overindex turns a podcast name into a **Sponsor Report**: the brands its audience over-indexes on according to Qloo's taste graph, split into proven buyers and greenfield prospects, with sourced pitch drafts.

## Status

QlooGateway is in place (MCP client, `qloo api` insights runner, fake client, budget, trace, cache). Report pipeline, UI, and evaluation are not built yet. No evaluation numbers exist yet.

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

## Deploy

Production target (decision 2026-10-20): one always-on Compute Engine `e2-micro` in `us-central1`, `us-east1`, or `us-west1`, with a 10 GB standard boot disk and `CACHE_DIR=/data` on that disk. No HTTPS load balancer. The VM is not created yet, and there is no public URL.

`fly.toml` is left over from the previous host. Do not use it to deploy.

The image sets the harness base URL to `https://hackathon.api.qloo.com` for the non-root user. API keys are not in the image. Set `QLOO_API_KEY` and `OPENAI_API_KEY` on the VM yourself. Do not paste the values into chat.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (standalone output) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run qloo:smoke` | Live `qloo_capabilities` plus one `describe`. Prints status only |

## Data handling

Qloo API responses are never committed to this repository. Runtime caches live in `CACHE_DIR`, outside the repo or git-ignored.

## License

[MIT](LICENSE)
