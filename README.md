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
