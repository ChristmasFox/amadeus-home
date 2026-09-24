# The upstream Docker image currently lags the npm package version.
# Keep the existing image's runtime/base and install the matching npm release.
FROM decolua/9router:0.5.75@sha256:7c893bc2c27ecea2ae337abd5eacfec9e5763091b3a3b7862fc0625b770bb156

RUN npm install --global 9router@0.5.81 --prefer-online \
    && test "$(node -p 'require("/usr/local/lib/node_modules/9router/package.json").version')" = "0.5.81" \
    && npm cache clean --force

# Qwen-Audio-3.0-ASR-Flash exposes DashScope multimodal-generation rather than
# standard multipart STT. Keep only a bounded protocol adapter next to 9Router;
# the model alias, provider selection and credentials remain 9Router-owned.
RUN apk add --no-cache ffmpeg
COPY infra/docker/casaos/9router/asr-bridge.mjs /opt/amadeus/asr-bridge.mjs
COPY infra/docker/casaos/9router/start-9router.mjs /opt/amadeus/start-9router.mjs

# The upstream Docker image runs the packaged server directly. The npm CLI is
# desktop-oriented and can exit after launching its tray/server child in a
# headless container.
CMD ["node", "/opt/amadeus/start-9router.mjs"]
