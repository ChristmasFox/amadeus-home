#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE="${OPENCLAW_PERMISSION_TEST_IMAGE:-node:22-bookworm-slim}"
VOLUME="amadeus-pr3-permissions-$$"
docker image inspect "$IMAGE" >/dev/null
docker volume create "$VOLUME" >/dev/null
cleanup() { docker volume rm "$VOLUME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Use a disposable Docker volume. This exercises the exact Unix uid/gid and
# mode contract without touching the OrbStack guest's existing /tmp.
docker run --rm -v "$VOLUME:/fixture" --entrypoint sh "$IMAGE" -eu -c '
  mkdir -p /fixture/etc/amadeus-gateway /fixture/preflight
  chown 0:3001 /fixture/etc/amadeus-gateway
  chmod 0710 /fixture/etc/amadeus-gateway
  printf private > /fixture/etc/amadeus-gateway/account-map.json
  chown 0:1001 /fixture/etc/amadeus-gateway/account-map.json
  chmod 0640 /fixture/etc/amadeus-gateway/account-map.json
  printf probe > /fixture/etc/amadeus-gateway/account-map-probe.json
  chown 0:1002 /fixture/etc/amadeus-gateway/account-map-probe.json
  chmod 0640 /fixture/etc/amadeus-gateway/account-map-probe.json
  printf secret > /fixture/etc/amadeus-gateway/unrelated-secret
  chown 0:0 /fixture/etc/amadeus-gateway/unrelated-secret
  chmod 0600 /fixture/etc/amadeus-gateway/unrelated-secret
  before=$(stat -c %a /tmp)
  dir=/tmp/amadeus-map-smoke-$$
  test ! -e "$dir"
  mkdir "$dir"
  chmod 0700 "$dir"
  printf map > "$dir/map.json"
  chown 1000:1000 "$dir/map.json"
  chmod 0600 "$dir/map.json"
  test "$(stat -c %a /tmp)" = "$before"
  rm -rf -- "$dir"
  printf node-readable > /fixture/preflight/vps-account-map.json
  chown 1000:1000 /fixture/preflight/vps-account-map.json
  chmod 0600 /fixture/preflight/vps-account-map.json
'

docker run --rm --user 1001:1001 --group-add 3001 -v "$VOLUME:/fixture:ro" --entrypoint node "$IMAGE" -e '
  const fs=require("fs");
  if (fs.readFileSync("/fixture/etc/amadeus-gateway/account-map.json", "utf8") !== "private") process.exit(1);
  for (const path of ["/fixture/etc/amadeus-gateway/account-map-probe.json", "/fixture/etc/amadeus-gateway/unrelated-secret"]) {
    try { fs.readFileSync(path); process.exit(2); } catch {}
  }
'

docker run --rm --user 1002:1002 --group-add 3001 -v "$VOLUME:/fixture:ro" --entrypoint node "$IMAGE" -e '
  const fs=require("fs");
  if (fs.readFileSync("/fixture/etc/amadeus-gateway/account-map-probe.json", "utf8") !== "probe") process.exit(1);
  for (const path of ["/fixture/etc/amadeus-gateway/account-map.json", "/fixture/etc/amadeus-gateway/unrelated-secret"]) {
    try { fs.readFileSync(path); process.exit(2); } catch {}
  }
'

docker run --rm --user 1000:1000 -v "$VOLUME:/fixture:ro" --entrypoint node "$IMAGE" -e '
  const fs=require("fs");
  if (fs.readFileSync("/fixture/preflight/vps-account-map.json", "utf8") !== "node-readable") process.exit(1);
'

printf '%s\n' 'VPS_ACCOUNT_MAP_PERMISSION_SMOKE=passed'
