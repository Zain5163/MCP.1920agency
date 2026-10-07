# AdsPilot: one image for the hosted MCP, the worker and the one-shot tasks
# (migrate, monitor, refresh, keepalive). Built from committed code only: the
# build context is the repository root, and Dockerfile.dockerignore lets in
# nothing but source/ and deploy/docker/. No secret is ever part of the image;
# configuration arrives at run time through the env file (docker-compose.yml).
#
#   docker compose -f deploy/docker-compose.yml build      (from the repo root)
#
# How the apps start (checked 2026-10-08): the packages under source/packages
# are compiled to dist/ by tsc (their package.json "main" points at dist), while
# the apps under source/apps run their .ts sources directly with Node 22's
# --experimental-strip-types and have no build step. So the image compiles the
# packages and runs the apps from src, exactly as this PC does.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=12.5.1

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION

# openssl: Prisma picks its Linux engine by the OpenSSL it finds (3.0.x here).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# pnpm from npm rather than corepack: the version in package.json's
# packageManager, without corepack's signing-key lookups at build time.
RUN npm install -g "pnpm@${PNPM_VERSION}" --no-audit --no-fund

ENV CI=true \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

WORKDIR /app/source
COPY source/ ./

# pnpm 12 stops with ERR_PNPM_IGNORED_BUILDS while pnpm-workspace.yaml leaves
# Prisma's build scripts undecided ("set this to true or false"). The image
# allows them, because they are what downloads Prisma's Linux engines (query
# engine and the schema engine that `migrate deploy` needs). Only this copy
# inside the image is changed; the repository file is not.
RUN sed -i "s/: set this to true or false/: true/" pnpm-workspace.yaml \
 && grep -q "prisma: true" pnpm-workspace.yaml

# Only what the server runs: the MCP, the worker and the CLI with their
# workspace dependencies. The Next.js dashboard (apps/web) is not installed.
RUN pnpm install --frozen-lockfile \
      --filter "@social-publisher/mcp..." \
      --filter "@social-publisher/worker..." \
      --filter "@social-publisher/cli..."

RUN pnpm --filter @social-publisher/db exec prisma generate

RUN pnpm -r \
      --filter "@social-publisher/mcp..." \
      --filter "@social-publisher/worker..." \
      --filter "@social-publisher/cli..." \
      run build

# Fail the build now rather than at the first query: both Linux engines exist.
RUN ls node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node \
 && ls node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x

# Not needed at run time.
RUN rm -rf apps/web

# The worker's Docker healthcheck, placed where it resolves @social-publisher/db.
COPY deploy/docker/worker-healthcheck.mjs apps/worker/healthcheck.mjs

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOME=/home/node \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# pnpm's node_modules are relative symlinks inside /app/source, so copying the
# folder keeps them working; the pnpm store itself stays in the build stage.
COPY --from=build --chown=node:node /app/source /app/source

# The logger writes ~/.social-publisher/logs/events.jsonl; the compose file
# mounts a host folder there. The config loader also looks for
# ~/.social-publisher/.env, which deliberately does not exist in the image.
RUN mkdir -p /home/node/.social-publisher/logs \
 && chown -R node:node /home/node/.social-publisher

USER node
WORKDIR /app/source/apps/mcp
EXPOSE 8080

# The compose file sets the command per service; this default is the hosted MCP.
CMD ["node", "--experimental-strip-types", "src/http-server.ts"]
