FROM ghcr.io/openclaw/openclaw:2026.9.4@sha256:cc596b846506a5f4cfcee111394a2725f375f01cca2ebb492a161fd1b747f101

LABEL org.opencontainers.image.title="OpenClaw Amadeus agent" \
      org.opencontainers.image.source="agent-monorepo" \
      org.opencontainers.image.version="2026.9.4"

WORKDIR /app

# The plugin bundle is self-contained; the OpenClaw SDK remains provided by
# the pinned base image. No source, credentials, media directory, or Docker
# socket is copied into the image.
# Carry provider-native identity metadata through the pinned OpenClaw 2026.9.4
# Telegram ingress. The WhatsApp package is installed outside this image and is
# patched from the same source-controlled script during an apply.
COPY scripts/patch-openclaw-channel-identity.mjs /tmp/patch-openclaw-channel-identity.mjs
USER root
RUN node /tmp/patch-openclaw-channel-identity.mjs --core-root /app/dist \
    && rm /tmp/patch-openclaw-channel-identity.mjs

# Install our business plugins in OpenClaw's bundled-extension tree. This keeps
# the plugin runtime trusted for narrow host-owned capabilities such as the
# in-process WhatsApp owner notifier; load.paths would classify them as local
# external plugins and deny Gateway runtime requests.
COPY plugins/pubg/dist/index.js /app/dist/extensions/pubg/dist/index.js
COPY plugins/pubg/dist/index.js.map /app/dist/extensions/pubg/dist/index.js.map
COPY plugins/pubg/dist/migrate.js /app/dist/extensions/pubg/dist/migrate.js
COPY plugins/pubg/dist/migrate.js.map /app/dist/extensions/pubg/dist/migrate.js.map
COPY plugins/pubg/openclaw.plugin.json /app/dist/extensions/pubg/openclaw.plugin.json
COPY plugins/pubg/package.json /app/dist/extensions/pubg/package.json
COPY plugins/pubg/README.md /app/dist/extensions/pubg/README.md
COPY plugins/pubg/skills /app/dist/extensions/pubg/skills
COPY plugins/amadeus/dist/index.js /app/dist/extensions/amadeus/dist/index.js
COPY plugins/amadeus/dist/index.js.map /app/dist/extensions/amadeus/dist/index.js.map
COPY plugins/amadeus/openclaw.plugin.json /app/dist/extensions/amadeus/openclaw.plugin.json
COPY plugins/amadeus/package.json /app/dist/extensions/amadeus/package.json
COPY plugins/amadeus/README.md /app/dist/extensions/amadeus/README.md
COPY plugins/amadeus/briefing /app/dist/extensions/amadeus/briefing
COPY plugins/amadeus/skills /app/dist/extensions/amadeus/skills

USER node
