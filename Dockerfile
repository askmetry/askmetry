# syntax=docker/dockerfile:1
# Askmetry production images. One Dockerfile, two targets:
#   docker build --target web    -t askmetry-web    .
#   docker build --target worker -t askmetry-worker .
# The worker image also runs the schema migrations (packages/db/src/migrate.ts), see docker-compose.yml.

ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=11.13.1

# ---------------------------------------------------------------------------
# base: Node + pnpm
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN npm install -g pnpm@${PNPM_VERSION} && npm cache clean --force
WORKDIR /app

# ---------------------------------------------------------------------------
# manifests: only the files that determine the dependency graph (better layer caching)
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/report/package.json packages/report/

# ---------------------------------------------------------------------------
# web-build: install web deps and build the Next.js standalone bundle
FROM manifests AS web-build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@askmetry/web..." --store-dir /pnpm/store
COPY packages/db packages/db
COPY packages/core packages/core
COPY apps/web apps/web
ENV ASKMETRY_STANDALONE=1 NODE_ENV=production
# Placeholder secret only silences better-auth during prerendering; the runtime image gets the real one from the environment
RUN BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime pnpm --filter @askmetry/web build

# ---------------------------------------------------------------------------
# web: minimal runtime, only the traced standalone output
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3010 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3010)+'/api/auth/ok').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------------------
# worker-deps: worker + db (incl. tsx, a devDependency the worker runs with)
FROM manifests AS worker-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@askmetry/worker..." --store-dir /pnpm/store \
 # drop build/test tooling the worker never loads at runtime. Migrations run with drizzle-orm's migrator
 # (src/migrate.ts), so drizzle-kit and its esbuild-kit loaders go too.
 && rm -rf node_modules/.pnpm/typescript@* node_modules/.pnpm/@typescript+* node_modules/.pnpm/playwright-core@* \
           node_modules/.pnpm/vitest@* node_modules/.pnpm/@vitest+* node_modules/.pnpm/vite@* \
           node_modules/.pnpm/rollup@* node_modules/.pnpm/@rollup+* node_modules/.pnpm/rolldown@* node_modules/.pnpm/@rolldown+* \
           node_modules/.pnpm/lightningcss* node_modules/.pnpm/@types+* \
           node_modules/.pnpm/drizzle-kit@* node_modules/.pnpm/@drizzle-team+brocli@* node_modules/.pnpm/@esbuild-kit+* \
           node_modules/.pnpm/esbuild-register@* \
 # keep only the esbuild version tsx uses (drizzle-kit pulled in older ones)
 && keep=$(basename "$(dirname "$(dirname "$(readlink node_modules/.pnpm/tsx@*/node_modules/esbuild)")")") \
 && case "$keep" in esbuild@[0-9]*) ;; *) echo "esbuild used by tsx not found (got '$keep')" >&2; exit 1 ;; esac \
 && ver=${keep#esbuild@} \
 && for d in node_modules/.pnpm/esbuild@* node_modules/.pnpm/@esbuild+*; do \
      case "$d" in *@"$ver"|*@"$ver"_*) ;; *) rm -rf "$d" ;; esac; \
    done \
 && find . -path '*/node_modules/*' -type l ! -exec test -e {} \; -delete

# ---------------------------------------------------------------------------
# worker: TypeScript sources run directly via tsx (same as `pnpm worker` in development)
FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production
WORKDIR /app
# Files stay root-owned (read-only for the runtime user)
COPY --from=worker-deps /app ./
COPY packages/db packages/db
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/report/package.json packages/report/tsconfig.json packages/report/
COPY packages/report/src packages/report/src
COPY apps/worker/package.json apps/worker/tsconfig.json apps/worker/
COPY apps/worker/src apps/worker/src
# Fail the build (not the first start) if pruning broke tsx or the migrate command (type stripping, drizzle imports).
# Importing migrate.ts does not run it (import.meta.main is false).
RUN cd apps/worker && node --import tsx -e 0 \
 && node -e "import('/app/packages/db/src/migrate.ts').then((m) => { if (typeof m.runMigrations !== 'function') process.exit(1) })" \
 && node --import tsx -e "import('@askmetry/report').then((m) => { if (typeof m.renderReportPdf !== 'function') process.exit(1) })"
USER node
WORKDIR /app/apps/worker
# `migrate` service overrides this with: node src/migrate.ts (in /app/packages/db)
CMD ["node", "--import", "tsx", "src/cli.ts", "start"]
