# Contributing to OpenGEO

Thanks for your interest! Bug reports, ideas and pull requests are welcome. Please follow our [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go through [SECURITY.md](SECURITY.md), not public issues.

<!-- TODO (maintainer): decide on a Contributor License Agreement (CLA) or DCO before merging the first external PR (see SPEC.md 13.2) and document it here. -->

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Read [SPEC.md](SPEC.md) (what the product does) and [DESIGN.md](DESIGN.md) (design principles: answer first, radically simple). Both are in German; questions in English are fine.
- Recommendations must stay realistic and evidence-based – see [GEO-PLAYBOOK.md](GEO-PLAYBOOK.md).

## Setup

Node 24, pnpm 11 (`corepack enable` or `npm i -g pnpm@11`), Docker.

```bash
cp .env.example .env        # set BETTER_AUTH_SECRET; OPENGEO_MOCK_ENGINES=1 needs no API keys
pnpm install
pnpm db:up                  # Postgres on localhost:5433
pnpm db:push                # schema
pnpm dev                    # http://localhost:3010
pnpm worker                 # second terminal
```

## Checks before opening a PR

```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration       # needs `pnpm db:up`; uses the separate database opengeo_test
pnpm --filter @opengeo/web build
```

CI runs the same steps plus the Docker image builds.

## Guidelines

- **No paid API calls in tests.** Tests run with `OPENGEO_MOCK_ENGINES=1`; new engine code needs a mock path.
- **Cost matters.** Changes that increase cost per request (models, search settings, repetitions) need a measurement and a note in SPEC.md chapter 9.
- **Tenant separation.** Every query in the web app must be scoped to the current user's workspace.
- **Schema changes** go into `packages/db/src/schema.ts`; they are applied with `drizzle-kit push`. Avoid changes that drop data, or call them out clearly in the PR (self-hosters have to confirm them interactively).
- TypeScript ESM everywhere, strict mode. Keep dependencies few and AGPL-compatible (MIT, BSD, ISC, Apache-2.0, MPL-2.0, LGPL are fine; no GPL-2.0-only, SSPL or proprietary licenses).
- UI texts exist in German and English – add both.
- Keep PRs focused; describe what changed and how you tested it.

By submitting a contribution you agree that it is licensed under the project's license, [AGPL-3.0-only](LICENSE).

## CI and self-hosted runners

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on GitHub-hosted `ubuntu-latest` by default, which is free for public repositories. Pull requests – including those from forks – **always** run there.

Maintainers can move trusted runs (pushes to `main`, manual runs) to their own machine by registering a self-hosted runner with the label `opengeo` and setting the repository variable `OPENGEO_SELF_HOSTED=true` (Settings → Secrets and variables → Actions → Variables). Before doing that, understand the risk: a self-hosted runner executes whatever code the workflow checks out, with the permissions of the runner's user. The `runs-on` condition lives in the workflow file, and **a pull request can edit the workflow file** – so the condition alone does not keep fork code off your machine. Required precautions:

1. Settings → Actions → General → "Fork pull request workflows from outside collaborators": choose **"Require approval for all external contributors"**, and never approve a run without reading the diff, especially changes under `.github/`.
2. Run the runner as a **separate, unprivileged OS user** (or in a VM) that has no access to your SSH keys, keychain, other repositories or tokens. Don't run it as root/admin.
3. Node is installed by the workflow; the runner itself needs Docker (the integration tests start a Postgres container on port 55439, the Docker job builds images).
4. Prefer an ephemeral runner (`./config.sh --ephemeral`) that is re-registered after every job.
5. Keep secrets out of CI: the workflow needs none.

Registering a runner (macOS/Linux, as that separate user): GitHub repository → Settings → Actions → Runners → "New self-hosted runner", follow the download/`config.sh` steps there and add `--labels opengeo`, then start it with `./run.sh`. An ephemeral runner exits after one job, so wrap `config.sh --ephemeral … && ./run.sh` in a loop or launchd job that re-registers it; a persistent runner can instead be installed as a service with `./svc.sh install && ./svc.sh start` (simpler, but state from earlier jobs survives).
