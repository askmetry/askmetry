# Contributing to Askmetry

Thanks for your interest! Bug reports, ideas and pull requests are welcome. Please follow our [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go through [SECURITY.md](SECURITY.md), not public issues.

<!-- TODO (maintainer): decide on a Contributor License Agreement (CLA) or DCO before merging the first external PR (see SPEC.md 13.2) and document it here. -->

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Read [SPEC.md](SPEC.md) (what the product does) and [DESIGN.md](DESIGN.md) (design principles: answer first, radically simple). Both are in German; questions in English are fine.
- Recommendations must stay realistic and evidence-based – see [GEO-PLAYBOOK.md](GEO-PLAYBOOK.md).

## Setup

Node 24, pnpm 11 (`corepack enable` or `npm i -g pnpm@11`), Docker.

```bash
cp .env.example .env        # set BETTER_AUTH_SECRET; ASKMETRY_MOCK_ENGINES=1 needs no API keys
pnpm install
pnpm db:up                  # Postgres on localhost:5433
pnpm db:migrate             # schema (versioned migrations)
pnpm dev                    # http://localhost:3010
pnpm worker                 # second terminal
```

## Checks before opening a PR

```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration       # needs `pnpm db:up`; drops and recreates the separate database askmetry_test
pnpm --filter @askmetry/web build
```

CI runs the same steps plus a check that `packages/db/drizzle` matches `schema.ts`, a migration run against a fresh database, and the Docker image builds.

## Guidelines

- **No paid API calls in tests.** Tests run with `ASKMETRY_MOCK_ENGINES=1`; new engine code needs a mock path.
- **Cost matters.** Changes that increase cost per request (models, search settings, repetitions) need a measurement and a note in SPEC.md chapter 9.
- **Tenant separation.** Every query in the web app must be scoped to the current user's workspace.
- **Schema changes** need a migration, see [Schema changes](#schema-changes).
- TypeScript ESM everywhere, strict mode. Keep dependencies few and AGPL-compatible (MIT, BSD, ISC, Apache-2.0, MPL-2.0, LGPL are fine; no GPL-2.0-only, SSPL or proprietary licenses).
- UI texts exist in German and English – add both.
- Keep PRs focused; describe what changed and how you tested it.

By submitting a contribution you agree that it is licensed under the project's license, [AGPL-3.0-only](LICENSE).

## Schema changes

The schema lives in `packages/db/src/schema.ts`; every change ships as a versioned SQL migration in `packages/db/drizzle`, which self-hosters apply on their next start (`migrate` service).

1. Edit `packages/db/src/schema.ts`.
2. `pnpm db:generate` – writes `packages/db/drizzle/NNNN_<name>.sql` plus snapshot and journal (use `pnpm db:generate --name add_xyz` for a readable name; for renames drizzle-kit asks whether it is a rename or drop + add).
3. Read the SQL. Prefer additive changes; anything that drops or rewrites data must be called out in the PR. Never edit a migration that is already on `main` – add a new one.
4. `pnpm db:migrate` applies it to your dev database. Commit the `drizzle/` files together with the schema change.

CI fails when `schema.ts` and the migrations disagree (it runs `pnpm db:generate` and expects no new files, plus `drizzle-kit check`). It cannot detect hand edits to an existing `.sql` file – reviewers have to.

Things to know about how migrations run:
- All pending migrations run in **one transaction**, across files. So `CREATE INDEX CONCURRENTLY` is not possible, and a value added with `ALTER TYPE … ADD VALUE` cannot be used by a later migration in the same run (fresh installs and updates that skip versions run them together) – add enum values in a migration of their own and don't use them in SQL migrations.
- Order is decided by the `when` timestamps in `meta/_journal.json`. If two branches each added a migration, regenerate yours on top after merging `main` (delete your file and its snapshot, `pnpm db:generate` again); `pnpm db:migrate` refuses to run when a migration would be skipped.
- A migration waits at most 60 s for table locks (`lock_timeout`), then fails and is rolled back.

`pnpm db:push` (drizzle-kit push) still exists for quick throwaway experiments: it syncs your local database directly, without a migration and without asking. After using it, your dev database is ahead of the migrations, and `pnpm db:migrate` will fail on the migration that adds the same change. Revert the experiment with push before generating, or recreate the dev database (`docker compose -f docker-compose.dev.yml down -v`, `pnpm db:up`, `pnpm db:migrate` – this deletes **all** local dev data). Never use push on a shared or production database.

Databases created with push before migrations existed (no `drizzle.__drizzle_migrations` table) are adopted by `pnpm db:migrate`: if the schema matches the baseline migration `0000_baseline`, it is marked as applied without running it.

## CI and self-hosted runners

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on GitHub-hosted `ubuntu-latest` by default, which is free for public repositories. Pull requests – including those from forks – **always** run there.

Maintainers can move trusted runs (pushes to `main`, manual runs) to their own machine by registering a self-hosted runner with the label `askmetry` and setting the repository variable `ASKMETRY_SELF_HOSTED=true` (Settings → Secrets and variables → Actions → Variables). Before doing that, understand the risk: a self-hosted runner executes whatever code the workflow checks out, with the permissions of the runner's user. The `runs-on` condition lives in the workflow file, and **a pull request can edit the workflow file** – so the condition alone does not keep fork code off your machine. Required precautions:

1. Settings → Actions → General → "Fork pull request workflows from outside collaborators": choose **"Require approval for all external contributors"**, and never approve a run without reading the diff, especially changes under `.github/`.
2. Run the runner as a **separate, unprivileged OS user** (or in a VM) that has no access to your SSH keys, keychain, other repositories or tokens. Don't run it as root/admin.
3. Node is installed by the workflow; the runner itself needs Docker (the integration tests start a Postgres container on port 55439, the Docker job builds images).
4. Prefer an ephemeral runner (`./config.sh --ephemeral`) that is re-registered after every job.
5. Keep secrets out of CI: the workflow needs none.

Registering a runner (macOS/Linux, as that separate user): GitHub repository → Settings → Actions → Runners → "New self-hosted runner", follow the download/`config.sh` steps there and add `--labels askmetry`, then start it with `./run.sh`. An ephemeral runner exits after one job, so wrap `config.sh --ephemeral … && ./run.sh` in a loop or launchd job that re-registers it; a persistent runner can instead be installed as a service with `./svc.sh install && ./svc.sh start` (simpler, but state from earlier jobs survives).
