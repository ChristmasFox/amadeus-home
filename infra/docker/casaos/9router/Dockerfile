# Pin the matching upstream runtime and package release. The manifest digest is
# immutable; build locally on the Gate-Local machine for its native platform.
FROM decolua/9router:0.5.104@sha256:5fc7020f3cf1ca6831bffe80314ecab9dde915d27ee3c479a4bb66f45dabbc27

ARG SOURCE_SHA=unknown
LABEL org.opencontainers.image.version="0.5.104" \
      org.opencontainers.image.revision="${SOURCE_SHA}"
RUN if [ "$SOURCE_SHA" != unknown ]; then \
      test "$(printf '%s' "$SOURCE_SHA" | wc -c | tr -d ' ')" = 40 \
      && printf '%s' "$SOURCE_SHA" | grep -Eq '^[0-9a-f]{40}$'; \
    fi

RUN npm install --global 9router@0.5.104 --prefer-online \
    && test "$(node -p 'require("/usr/local/lib/node_modules/9router/package.json").version')" = "0.5.104" \
    && npm cache clean --force

# Qwen-Audio-3.0-ASR-Flash exposes DashScope multimodal-generation rather than
# standard multipart STT. Keep only a bounded protocol adapter next to 9Router;
# the model alias, provider selection and credentials remain 9Router-owned.
RUN apk add --no-cache ffmpeg
COPY infra/docker/casaos/9router/asr-bridge.mjs /opt/amadeus/asr-bridge.mjs
COPY infra/docker/casaos/9router/tts-bridge.mjs /opt/amadeus/tts-bridge.mjs
COPY apps/qwen3-tts-service/kurisu_style.json /opt/amadeus/kurisu_style.json
COPY infra/docker/casaos/9router/start-9router.mjs /opt/amadeus/start-9router.mjs
COPY infra/docker/casaos/9router/patch-selfhosted-tts-style.mjs /opt/amadeus/patch-selfhosted-tts-style.mjs
RUN node /opt/amadeus/patch-selfhosted-tts-style.mjs --root /usr/local/lib/node_modules/9router
# 9Router has no strict per-model account allowlist and the published CLI is
# already compiled. Pin/check the exact bundle shape, fail the build on drift.
# The protected account policy is injected into an external temporary build
# context and never committed. A build without it must fail closed.
COPY infra/9router/runtime-policy.json /opt/amadeus/runtime-policy.json
COPY infra/docker/casaos/9router/patch-runtime-policy.mjs /opt/amadeus/patch-runtime-policy.mjs
RUN node /opt/amadeus/patch-runtime-policy.mjs --root /usr/local/lib/node_modules/9router --policy /opt/amadeus/runtime-policy.json --apply
COPY infra/docker/casaos/9router/patch-image-upstream-diagnostics.mjs /opt/amadeus/patch-image-upstream-diagnostics.mjs
RUN node /opt/amadeus/patch-image-upstream-diagnostics.mjs --root /usr/local/lib/node_modules/9router --apply
COPY infra/docker/casaos/9router/patch-image-combo-safety.mjs /opt/amadeus/patch-image-combo-safety.mjs
RUN node /opt/amadeus/patch-image-combo-safety.mjs --root /usr/local/lib/node_modules/9router --apply
COPY infra/docker/casaos/9router/patch-combo-location-fallback.mjs /opt/amadeus/patch-combo-location-fallback.mjs
RUN node /opt/amadeus/patch-combo-location-fallback.mjs --root /usr/local/lib/node_modules/9router --apply
# The pinned upstream image also keeps a standalone bundle at /app. Keep its
# Combo safety behavior identical and require the same exact 0.5.104 version.
RUN node /opt/amadeus/patch-image-combo-safety.mjs --root /app --apply

# The upstream Docker image runs the packaged server directly. The npm CLI is
# desktop-oriented and can exit after launching its tray/server child in a
# headless container.
CMD ["node", "/opt/amadeus/start-9router.mjs"]
