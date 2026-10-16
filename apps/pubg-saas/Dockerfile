FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
ARG OCI_SOURCE_REVISION=unknown
ARG OCI_PRODUCT_VERSION=unknown
ARG OCI_BUILD_TIMESTAMP=unknown

WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/pubg-saas/package.json apps/pubg-saas/package.json
COPY packages/agent-memory/package.json packages/agent-memory/package.json
COPY packages/pubg-domain/package.json packages/pubg-domain/package.json
COPY packages/presentation/package.json packages/presentation/package.json

RUN corepack enable \
  && corepack prepare pnpm@11.19.0 --activate \
  && pnpm install --frozen-lockfile --filter @agent/pubg-saas...

COPY apps/pubg-saas ./apps/pubg-saas
COPY packages/agent-memory ./packages/agent-memory
COPY packages/pubg-domain ./packages/pubg-domain
COPY packages/presentation ./packages/presentation
COPY infra/pubg-saas/container-entrypoint.sh ./infra/pubg-saas/container-entrypoint.sh

RUN pnpm --filter @agent/memory build \
  && pnpm --filter @agent/presentation build \
  && pnpm --filter @agent/pubg-domain build \
  && pnpm --filter @agent/pubg-saas build \
  && pnpm --filter @agent/pubg-saas deploy --prod --legacy /prod \
  && rm -rf /prod/node_modules/@agent/memory /prod/node_modules/@agent/pubg-domain /prod/node_modules/@agent/presentation \
  && mkdir -p /prod/node_modules/@agent/memory /prod/node_modules/@agent/pubg-domain /prod/node_modules/@agent/presentation \
  && cp packages/agent-memory/package.json /prod/node_modules/@agent/memory/package.json \
  && cp -a packages/agent-memory/dist /prod/node_modules/@agent/memory/dist \
  && cp packages/pubg-domain/package.json /prod/node_modules/@agent/pubg-domain/package.json \
  && cp packages/presentation/package.json /prod/node_modules/@agent/presentation/package.json \
  && cp -a packages/pubg-domain/dist /prod/node_modules/@agent/pubg-domain/dist \
  && cp -a packages/presentation/dist /prod/node_modules/@agent/presentation/dist

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
ARG OCI_SOURCE_REVISION=unknown
ARG OCI_PRODUCT_VERSION=unknown
ARG OCI_BUILD_TIMESTAMP=unknown
LABEL org.opencontainers.image.title="Gate PUBG SaaS" \
      org.opencontainers.image.version="${OCI_PRODUCT_VERSION}" \
      org.opencontainers.image.revision="${OCI_SOURCE_REVISION}" \
      org.opencontainers.image.created="${OCI_BUILD_TIMESTAMP}" \
      com.amadeus.release.provenance="amadeus-product-release-v1"

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /prod/ ./
COPY --chown=root:root --chmod=0555 infra/pubg-saas/container-entrypoint.sh /usr/local/bin/pubg-saas-entrypoint
USER node
ENTRYPOINT ["/usr/local/bin/pubg-saas-entrypoint"]
