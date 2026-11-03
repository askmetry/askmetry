# syntax=docker/dockerfile:1
# OpenGEO production images. One Dockerfile, two targets:
#   docker build --target web    -t opengeo-web    .
#   docker build --target worker -t opengeo-worker .
# The worker image also runs the schema migration (drizzle-kit push), see docker-compose.yml.

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

# ---------------------------------------------------------------------------
# web-build: install web deps and build the Next.js standalone bundle
FROM manifests AS web-build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@opengeo/web..." --store-dir /pnpm/store
COPY packages/db packages/db
COPY packages/core packages/core
COPY apps/web apps/web
ENV OPENGEO_STANDALONE=1 NODE_ENV=production
# Placeholder secret only silences better-auth during prerendering; the runtime image gets the real one from the environment
RUN BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime pnpm --filter @opengeo/web build

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
# worker-deps: worker + db (incl. tsx and drizzle-kit, which are devDependencies)
FROM manifests AS worker-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@opengeo/worker..." --filter "@opengeo/db" --store-dir /pnpm/store \
 # drop build/test tooling the worker never loads at runtime
 && rm -rf node_modules/.pnpm/typescript@* node_modules/.pnpm/@typescript+* node_modules/.pnpm/playwright-core@* \
           node_modules/.pnpm/vitest@* node_modules/.pnpm/@vitest+* node_modules/.pnpm/vite@* \
           node_modules/.pnpm/rollup@* node_modules/.pnpm/@rollup+* node_modules/.pnpm/rolldown@* node_modules/.pnpm/@rolldown+* \
           node_modules/.pnpm/lightningcss* node_modules/.pnpm/@types+* \
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
COPY apps/worker/package.json apps/worker/tsconfig.json apps/worker/
COPY apps/worker/src apps/worker/src
USER node
WORKDIR /app/apps/worker
# `migrate` service overrides this with: drizzle-kit push (in /app/packages/db)
CMD ["node", "--import", "tsx", "src/cli.ts", "start"]
