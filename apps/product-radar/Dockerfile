FROM node:22-bookworm-slim AS build
ARG OCI_SOURCE_REVISION=unknown
ARG OCI_PRODUCT_VERSION=unknown
ARG OCI_BUILD_TIMESTAMP=unknown
WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/product-radar/package.json apps/product-radar/package.json
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate && pnpm install --frozen-lockfile --filter @agent/product-radar...
COPY apps/product-radar ./apps/product-radar
RUN pnpm --filter @agent/product-radar build
RUN pnpm --filter @agent/product-radar deploy --prod --legacy /prod

FROM node:22-bookworm-slim
ARG OCI_SOURCE_REVISION=unknown
ARG OCI_PRODUCT_VERSION=unknown
ARG OCI_BUILD_TIMESTAMP=unknown
LABEL org.opencontainers.image.title="Product Radar" \
  org.opencontainers.image.version="${OCI_PRODUCT_VERSION}" \
  org.opencontainers.image.revision="${OCI_SOURCE_REVISION}" \
  org.opencontainers.image.created="${OCI_BUILD_TIMESTAMP}" \
  com.amadeus.release.provenance="amadeus-product-release-v1"
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /prod/ ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 5315
CMD ["node", "dist/src/index.js"]
