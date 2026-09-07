FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json tsconfig.json ./
RUN corepack enable && corepack prepare pnpm@9.9.0 --activate && pnpm install --no-frozen-lockfile
COPY src ./src
COPY tests ./tests
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 5315
CMD ["node", "dist/src/index.js"]
