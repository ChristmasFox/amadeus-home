FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/pubg-saas/package.json apps/pubg-saas/package.json

RUN corepack enable \
  && corepack prepare pnpm@11.19.0 --activate \
  && pnpm install --frozen-lockfile --filter @agent/pubg-saas...

COPY apps/pubg-saas ./apps/pubg-saas
COPY infra/pubg-saas/container-entrypoint.sh ./infra/pubg-saas/container-entrypoint.sh

RUN pnpm --filter @agent/pubg-saas build \
  && pnpm --filter @agent/pubg-saas deploy --prod --legacy /prod

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /prod/ ./
COPY --chown=root:root --chmod=0555 infra/pubg-saas/container-entrypoint.sh /usr/local/bin/pubg-saas-entrypoint
ARG OCI_SOURCE_REVISION=unknown
ARG OCI_PRODUCT_VERSION=unknown
ARG OCI_BUILD_TIMESTAMP=unknown
LABEL org.opencontainers.image.title="Gate PUBG SaaS" \
      org.opencontainers.image.version="${OCI_PRODUCT_VERSION}" \
      org.opencontainers.image.revision="${OCI_SOURCE_REVISION}" \
      org.opencontainers.image.created="${OCI_BUILD_TIMESTAMP}" \
      com.amadeus.release.provenance="amadeus-product-release-v1"
USER node
ENTRYPOINT ["/usr/local/bin/pubg-saas-entrypoint"]
