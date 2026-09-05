FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@9.9.0 --activate

# Keep dependency resolution ahead of application source. A TypeScript-only change
# must not invalidate this layer or re-run `pnpm install`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent-runtime/package.json apps/agent-runtime/package.json
COPY packages/homehub-domain/package.json packages/homehub-domain/package.json

# The cache mount is intentionally shared by install and deploy. It is a local
# BuildKit cache only; it is never copied into the final runtime image.
RUN --mount=type=cache,id=agent-runtime-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @agent/agent-runtime... --frozen-lockfile

COPY apps/agent-runtime/tsconfig.json apps/agent-runtime/tsconfig.json
COPY packages/homehub-domain/tsconfig.json packages/homehub-domain/tsconfig.json
COPY packages/homehub-domain/src packages/homehub-domain/src
COPY apps/agent-runtime/src apps/agent-runtime/src
COPY apps/agent-runtime/teams apps/agent-runtime/teams
COPY apps/agent-runtime/pubg-query.schema.json apps/agent-runtime/pubg-query.schema.json

RUN pnpm --filter @agent/agent-runtime build
RUN --mount=type=cache,id=agent-runtime-pnpm-store,target=/pnpm/store \
    pnpm --filter @agent/agent-runtime deploy --prod /prod && \
    cp -R apps/agent-runtime/dist /prod/dist && \
    cp -R apps/agent-runtime/teams /prod/teams && \
    cp apps/agent-runtime/pubg-query.schema.json /prod/pubg-query.schema.json

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PUBG_QUERY_ENGINE_HOST=0.0.0.0
ENV PUBG_QUERY_ENGINE_PORT=5310
ENV PUBG_N8N_DATA_URL=http://n8n:5678/webhook/pubg-data-gateway-v3
ENV PUBG_STATE_FILE=/data/state.json
ENV PUBG_TIMEZONE=Asia/Shanghai
ENV PUBG_BUSINESS_DAY_START=06:00

COPY --chown=node:node --from=build /prod/ ./
RUN install -d -o node -g node /data
USER node

EXPOSE 5310

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:5310/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/src/server.js"]
