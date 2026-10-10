# The upstream Docker image currently lags the npm package version.
# Keep the existing image's runtime/base and install the matching npm release.
FROM decolua/9router:0.5.75@sha256:7c893bc2c27ecea2ae337abd5eacfec9e5763091b3a3b7862fc0625b770bb156

RUN npm install --global 9router@0.5.95 --prefer-online \
    && test "$(node -p 'require("/usr/local/lib/node_modules/9router/package.json").version')" = "0.5.95" \
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
# Production build via scripts/deploy-9router.sh injects a protected local policy into the temp context.
# A direct build without that policy MUST fail instead of running without account segregation.
COPY infra/9router/runtime-policy.json /opt/amadeus/runtime-policy.json
COPY infra/docker/casaos/9router/patch-runtime-policy.mjs /opt/amadeus/patch-runtime-policy.mjs
RUN node /opt/amadeus/patch-runtime-policy.mjs --root /usr/local/lib/node_modules/9router --policy /opt/amadeus/runtime-policy.json --apply
COPY infra/docker/casaos/9router/patch-image-upstream-diagnostics.mjs /opt/amadeus/patch-image-upstream-diagnostics.mjs
RUN node /opt/amadeus/patch-image-upstream-diagnostics.mjs --root /usr/local/lib/node_modules/9router --apply
COPY infra/docker/casaos/9router/patch-image-combo-safety.mjs /opt/amadeus/patch-image-combo-safety.mjs
RUN node /opt/amadeus/patch-image-combo-safety.mjs --root /usr/local/lib/node_modules/9router --apply
# The pinned base image keeps a second standalone bundle at /app for the
# exact live Combo fixture; patch it too, but still require the same unique
# helper anchor and marker. The npm package above remains version-checked.
RUN node /opt/amadeus/patch-image-combo-safety.mjs --root /app --allow-version-drift --apply

# The upstream Docker image runs the packaged server directly. The npm CLI is
# desktop-oriented and can exit after launching its tray/server child in a
# headless container.
CMD ["node", "/opt/amadeus/start-9router.mjs"]
