FROM node:22-bookworm-slim AS build
WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/product-radar/package.json apps/product-radar/package.json
COPY packages/presentation/package.json packages/presentation/package.json
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate && pnpm install --frozen-lockfile --filter @agent/product-radar...
COPY packages/presentation ./packages/presentation
COPY apps/product-radar ./apps/product-radar
RUN pnpm --filter @agent/presentation build
RUN pnpm --filter @agent/product-radar build
RUN pnpm --filter @agent/product-radar deploy --prod --legacy /prod
RUN rm -f /prod/node_modules/@agent/presentation \
  && mkdir -p /prod/node_modules/@agent/presentation \
  && cp -a /workspace/packages/presentation/. /prod/node_modules/@agent/presentation/

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /prod/ ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 5315
CMD ["node", "dist/src/index.js"]
