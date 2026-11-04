# Askmetry

**Open-source AI search visibility tracking.** Askmetry measures how visible your brand is in AI search engines – ChatGPT, Gemini, Claude, Google AI Overviews and Google AI Mode (Perplexity optional) –, which sources those AIs rely on, and where your brand is missing while competitors get mentioned. Then it tells you what to do about it.

Self-hosted, multi-tenant, AGPL-3.0. You bring your own API keys and pay the providers directly – typically around $40/month for a weekly measurement of 20 questions.

[Deutsche Version](README.de.md)

<!-- TODO: add a screenshot of the dashboard, e.g. docs/screenshot.png -->
> _Screenshot coming soon._

## Features

- **Overview:** visibility, average position, recommendation rate, share of voice and "your own site used as a source" – per engine and compared with your competitors.
- **Actions:** concrete, evidence-based recommendations (own content, other sites, communities, technical basics) derived from every measurement, each with a ready-to-copy prompt for your AI assistant.
- **Questions:** heatmap question × engine, every answer in full text with highlighted brands and sources; filter for the gaps where competitors get named and you don't.
- **Sources:** the most-used domains, pages that mention competitors but not you (outreach targets), answers that use your site but don't name your brand.
- **Settings:** brands, competitors, questions, topics, engines, repetitions, schedule, monthly budget, "measure now".
- **Cost controls:** per-workspace monthly budget cap, instance-wide budget ceiling, schedules off by default for new workspaces.
- **Multi-tenant:** accounts and workspaces with strict tenant separation; self-signup can be disabled.
- **Bilingual UI:** German and English.
- **Mock mode:** `ASKMETRY_MOCK_ENGINES=1` replaces every engine with a free local mock – try everything without API keys.

## Quickstart (Docker)

Requirements: Docker with Compose v2.

```bash
git clone https://github.com/mafauth2/askmetry.git askmetry && cd askmetry
cp .env.example .env
# Edit .env – at least:
#   POSTGRES_PASSWORD   e.g. openssl rand -hex 24
#   BETTER_AUTH_SECRET  e.g. openssl rand -hex 32
#   BETTER_AUTH_URL     the URL you open in the browser, e.g. http://localhost:3010 or https://geo.example.com
#   API keys            see "Configuration" (or ASKMETRY_MOCK_ENGINES=1 to try it for free)
docker compose up -d
```

Open <http://localhost:3010>, create an account under `/signup`, create a workspace, add your brand, competitors and questions, and click "Measure now".

What `docker compose up -d` starts (project name `askmetry-selfhost`):

| Service | What it does |
|---|---|
| `db` | Postgres 17, data in the volume `db-data`, not exposed on the host |
| `migrate` | one-shot: applies new database migrations (`packages/db/drizzle`), then exits |
| `web` | the dashboard (Next.js) on `127.0.0.1:${ASKMETRY_PORT:-3010}` |
| `worker` | scheduler + queue: runs due measurements every 60 s |

Operations:

```bash
docker compose logs -f web worker            # logs
git pull && docker compose up -d --build   # update: rebuild images, migrate, restart (back up first)
docker compose exec -T db pg_dump -U askmetry askmetry > backup.sql   # backup
docker compose exec -T db psql -U askmetry askmetry < backup.sql      # restore into an empty database
docker compose down                          # stop (data stays in the volume)
```

- **Public access:** the web port binds to `127.0.0.1` by default. Put a reverse proxy with TLS (Caddy, nginx, Traefik) in front and set `BETTER_AUTH_URL` to the public URL. Set `ASKMETRY_BIND=0.0.0.0` only if you really want to expose the port directly.
- **Close signups** after creating your accounts: `ASKMETRY_ALLOW_SIGNUP=false`, then `docker compose up -d`.
- **Schema updates** are versioned SQL migrations in `packages/db/drizzle`, reviewed and committed with the code. `migrate` applies the ones your database doesn't have yet on every start; already applied migrations are skipped, so restarts change nothing. If a migration fails, it is rolled back, `migrate` exits with an error and web and worker don't start (`docker compose logs migrate`). Take a backup before updating.
- **Installations from before migrations existed** (schema created with `drizzle-kit push`) are adopted automatically on the first update: if the schema matches the baseline migration, it is recorded as applied without running it, and your data stays untouched. If it doesn't match, `migrate` stops without changing anything and prints the differences and how to fix them.

## Costs

The default engine settings are cost-optimised and were chosen in a measured cost and quality experiment (see [SPEC.md](SPEC.md), chapter 9 – in German):

| Engine | Default setting | ≈ cost per request |
|---|---|---|
| ChatGPT | gpt-5.5, search context `low`, reasoning `low`, `flex` tier | $0.065 |
| Claude | Sonnet 5.5, effort `medium`, max. 3 searches | $0.08–0.09 |
| Gemini | gemini-3.5-flash + Google Search grounding | $0.01 |
| Google AI Overviews / AI Mode | DataForSEO Live | $0.004 each |
| Analysis of answers | Claude Haiku 5.5 | < $0.001 |

With 20 questions × 2 repetitions × weekly that is **about $40/month**. Every workspace has a monthly budget cap – once it is reached, further requests are skipped. New workspaces start with the schedule switched off. `ASKMETRY_MAX_BUDGET_USD` caps what any workspace may set as its budget. Monthly spend is the sum of run costs by completion time (Europe/Berlin); paid failed attempts count too.

Prices are list prices as measured on 31 Oct 2026 – check your providers' current pricing.

## Configuration

All configuration is done through environment variables in `.env` (see [.env.example](.env.example) for a commented template). Docker Compose reads the same file.

| Variable | Default | Used by | Description |
|---|---|---|---|
| `POSTGRES_PASSWORD` | – (required for Docker) | Docker | Password of the bundled Postgres. Use URL-safe characters (e.g. hex). |
| `DATABASE_URL` | `postgres://askmetry:askmetry@localhost:5433/askmetry` | dev | Postgres connection string. In Docker it is built from `POSTGRES_PASSWORD`. |
| `BETTER_AUTH_SECRET` | – (required) | web | Secret for sessions; long random string. |
| `BETTER_AUTH_URL` | `http://localhost:3010` | web | Public base URL of the dashboard. |
| `OPENAI_API_KEY` | – | worker | ChatGPT engine. |
| `GEMINI_API_KEY` | – | worker | Gemini engine. |
| `ANTHROPIC_API_KEY` | – | worker, web | Claude engine, the analysis of all answers (required for real measurements) and brand profile suggestions in the web app. |
| `PERPLEXITY_API_KEY` | – | worker | Perplexity engine (optional). |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | – | worker | Google AI Overviews and AI Mode via DataForSEO. |
| `ASKMETRY_MOCK_ENGINES` | `0` | worker, web | `1` = replace all engines and the analysis with a free local mock. |
| `ASKMETRY_MAX_BUDGET_USD` | `200` | worker, web | Upper limit for any workspace's monthly budget (USD). |
| `ASKMETRY_ALLOW_SIGNUP` | `true` | web | `false` disables self-signup (`/signup` and the sign-up API). |
| `ASKMETRY_SITE_CHECK` | on | worker | `0` disables fetching your brand's website (robots.txt, homepage) for technical recommendations. |
| `ASKMETRY_HEARTBEAT_FILE` | unset | worker | File the worker touches on every loop and measurement; the Docker healthcheck uses it (set automatically in `docker-compose.yml`). |
| `ASKMETRY_PORT` | `3010` | Docker | Host port of the web dashboard. |
| `ASKMETRY_BIND` | `127.0.0.1` | Docker | Host interface the web port binds to. |
| `ASKMETRY_WEB_IMAGE` / `ASKMETRY_WORKER_IMAGE` | `askmetry-web:local` / `askmetry-worker:local` | Docker | Image names (to use prebuilt images). |

Engines without a key are skipped. If `ANTHROPIC_API_KEY` is missing, the worker aborts a real measurement before the first engine call. If only the analysis fails, the answer is kept and analysed on the next worker pass without a new engine call.

Development and test-only variables: `TEST_DATABASE_URL` (integration tests, default `…localhost:5433/askmetry_test`), `ASKMETRY_MOCK_COST_USD` (cost reported by the mock engine), `E2E_BASE` / `E2E_SHOTS` (browser test).

## Development

Requirements: Node 24, pnpm 11, Docker.

```bash
cp .env.example .env                 # add keys, set BETTER_AUTH_SECRET (or ASKMETRY_MOCK_ENGINES=1)
pnpm install
pnpm db:up                           # Postgres on localhost:5433 (docker-compose.dev.yml)
pnpm db:migrate                      # create/update the schema (versioned migrations)
pnpm dev                             # dashboard on http://localhost:3010
pnpm worker                          # worker: schedule + queue (second terminal)
```

Schema changes: edit `packages/db/src/schema.ts`, run `pnpm db:generate`, review and commit the new file in `packages/db/drizzle`, then `pnpm db:migrate`. CI fails if `schema.ts` has changes without a migration. `pnpm db:push` syncs the schema directly without a migration – a shortcut for quick local experiments only (see [CONTRIBUTING.md](CONTRIBUTING.md#schema-changes)).

Sample data without API costs: `pnpm --filter @askmetry/worker seed --owner you@example.com` (needs the local spike results). More worker commands: [apps/worker/README.md](apps/worker/README.md) (German).

Tests:

```bash
pnpm typecheck
pnpm test:unit                       # no database, no network
pnpm test:integration                # mock engines, database askmetry_test (recreated on every run)
pnpm test                            # everything
node e2e/full-flow.mjs login|check|create|verify   # browser test against http://localhost:3010 (credentials in .e2e-credentials)
```

`create` + `verify` trigger a real measurement through the worker (1 question × 5 engines ≈ $0.25) unless the worker runs in mock mode.

Repository layout:

```
packages/db      Drizzle schema, migrations (drizzle/), migrate command, database client
packages/core    engine adapters, pricing, analysis, measurement runner with budget checks, recommendations
apps/worker      scheduler loop + CLI (seed, collect, once, recommend, …), launchd templates
apps/web         Next.js dashboard with login and tenant separation
spike/           prototype and cost experiment
e2e/             browser test
```

Running permanently on a Mac without Docker (launchd): see [apps/worker/README.md](apps/worker/README.md).

Background documents (German): [SPEC.md](SPEC.md) (specification), [DESIGN.md](DESIGN.md) (design principles), [GEO-PLAYBOOK.md](GEO-PLAYBOOK.md) (what really helps visibility), [CONTRACT.md](CONTRACT.md) (internal build agreements).

## Contributing

Contributions are welcome – see [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md). Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0 only](LICENSE) (AGPL-3.0-only). If you run a modified version of Askmetry as a network service, you must make the source code of your version available to its users.
