# The upstream Docker image currently lags the npm package version.
# Keep the existing image's runtime/base and install the matching npm release.
FROM decolua/9router:0.5.75@sha256:7c893bc2c27ecea2ae337abd5eacfec9e5763091b3a3b7862fc0625b770bb156

RUN npm install --global 9router@0.5.81 --prefer-online \
    && test "$(node -p 'require("/usr/local/lib/node_modules/9router/package.json").version')" = "0.5.81" \
    && npm cache clean --force

# The upstream Docker image runs the packaged server directly. The npm CLI is
# desktop-oriented and can exit after launching its tray/server child in a
# headless container.
CMD ["node", "/usr/local/lib/node_modules/9router/app/custom-server.js"]
