FROM ghcr.io/openclaw/openclaw:2026.9.4@sha256:cc596b846506a5f4cfcee111394a2725f375f01cca2ebb492a161fd1b747f101

LABEL org.opencontainers.image.title="OpenClaw Amadeus agent" \
      org.opencontainers.image.source="agent-monorepo" \
      org.opencontainers.image.version="2026.9.4"

WORKDIR /app

# The plugin bundle is self-contained; the OpenClaw SDK remains provided by
# the pinned base image. No source, credentials, media directory, or Docker
# socket is copied into the image.
COPY plugins/pubg/dist/index.js /app/extensions/pubg/dist/index.js
COPY plugins/pubg/dist/index.js.map /app/extensions/pubg/dist/index.js.map
COPY plugins/pubg/dist/migrate.js /app/extensions/pubg/dist/migrate.js
COPY plugins/pubg/dist/migrate.js.map /app/extensions/pubg/dist/migrate.js.map
COPY plugins/pubg/openclaw.plugin.json /app/extensions/pubg/openclaw.plugin.json
COPY plugins/pubg/package.json /app/extensions/pubg/package.json
COPY plugins/pubg/README.md /app/extensions/pubg/README.md
COPY plugins/pubg/skills /app/extensions/pubg/skills
COPY plugins/amadeus/dist/index.js /app/extensions/amadeus/dist/index.js
COPY plugins/amadeus/dist/index.js.map /app/extensions/amadeus/dist/index.js.map
COPY plugins/amadeus/openclaw.plugin.json /app/extensions/amadeus/openclaw.plugin.json
COPY plugins/amadeus/package.json /app/extensions/amadeus/package.json
COPY plugins/amadeus/README.md /app/extensions/amadeus/README.md
COPY plugins/amadeus/briefing /app/extensions/amadeus/briefing
COPY plugins/amadeus/skills /app/extensions/amadeus/skills

USER node
