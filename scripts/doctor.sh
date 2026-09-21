#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="$ORBSTACK_MACHINE"
STRICT="${DOCTOR_STRICT:-1}"
failures=0
warnings=0

pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

if ! command -v orb >/dev/null 2>&1; then
  fail 'OrbStack CLI not found'
else
  pass 'OrbStack CLI found'
fi

containers=''
if command -v orb >/dev/null 2>&1; then
  if orb list 2>/dev/null | awk -v machine="$MACHINE" '$1 == machine && $2 == "running" { found = 1 } END { exit found ? 0 : 1 }'; then
    pass "OrbStack machine $MACHINE is running"
    containers="$(orb -m "$MACHINE" -u root docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null || true)"
  else
    fail "OrbStack machine $MACHINE is not running"
  fi
fi

container_line() {
  local name="$1"
  printf '%s\n' "$containers" | awk -F '\t' -v name="$name" '$1 == name { print; found = 1 } END { exit found ? 0 : 1 }'
}

check_required_container() {
  local label="$1" name="$2" line status
  if line="$(container_line "$name")"; then
    status="$(printf '%s\n' "$line" | cut -f2-)"
    pass "$label container $name ($status)"
  else
    fail "$label container $name is not running"
  fi
}

check_required_container 'OpenClaw' openclaw
if printf '%s\n' "$containers" | awk -F '\t' '$1 == "9router" || $1 == "nine-router" { found = 1 } END { exit found ? 0 : 1 }'; then
  pass '9Router container is running'
else
  fail '9Router container is not running'
fi

check_required_container 'Product Radar' product-radar
check_required_container 'Media adapter' media-organizer-adapter

check_immich_container() {
  local name="$1" status
  if ! line="$(container_line "$name")"; then
    fail "Immich container $name is not running"
    return
  fi
  status="$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || true)"
  [[ "$status" == healthy ]] && pass "Immich container $name is healthy" || fail "Immich container $name health is ${status:-unknown}"
}

check_immich_container immich-server
check_immich_container immich-machine-learning
check_immich_container immich-postgres
check_immich_container immich-redis

if orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 8 http://127.0.0.1:2283/api/server/ping >/dev/null 2>&1; then
  pass 'Immich local /api/server/ping'
else
  fail 'Immich local /api/server/ping'
fi
if orb -m "$MACHINE" -u root docker exec immich-postgres psql -U postgres -d immich -Atqc 'select 1' 2>/dev/null | grep -Fx '1' >/dev/null; then
  pass 'Immich PostgreSQL query'
else
  fail 'Immich PostgreSQL query'
fi
if orb -m "$MACHINE" -u root docker exec immich-postgres psql -U postgres -d immich -Atqc "select count(*) from pg_extension where extname in ('vector','vectors')" 2>/dev/null | awk '$1 >= 1 { found = 1 } END { exit found ? 0 : 1 }'; then
  pass 'Immich vector extension present'
else
  fail 'Immich vector extension present'
fi

if orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 8 http://127.0.0.1:20128/dashboard >/dev/null 2>&1; then
  pass '9Router dashboard health'
else
  fail '9Router dashboard health'
fi
if orb -m "$MACHINE" -u root curl --silent --show-error --max-time 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:20128/v1/models | grep -Fx '401' >/dev/null; then
  pass '9Router /v1/models rejects unauthenticated access'
else
  fail '9Router /v1/models authentication boundary'
fi
if orb -m "$MACHINE" -u root docker image inspect "${NINE_ROUTER_IMAGE:-local/9router:0.5.81}" >/dev/null 2>&1; then
  pass "9Router expected runtime image ${NINE_ROUTER_IMAGE:-local/9router:0.5.81}"
else
  fail '9Router expected runtime image is unavailable'
fi

if bash "$ROOT_DIR/scripts/storage-preflight.sh" --status --allow-existing --source /DATA/Gallery/immich --destination "$IMMICH_MEDIA_ROOT" >/dev/null 2>&1; then
  pass 'verified external storage identity and Immich media boundary'
else
  fail 'verified external storage identity and Immich media boundary'
fi
if orb -m "$MACHINE" -u root docker system df >/dev/null 2>&1; then
  pass 'Docker storage accounting is available'
else
  fail 'Docker storage accounting is unavailable'
fi

for managed in openclaw product-radar 9router immich-server immich-machine-learning immich-postgres immich-redis changedetection; do
  log_policy="$(orb -m "$MACHINE" -u root docker inspect --format '{{.HostConfig.LogConfig.Type}}|{{index .HostConfig.LogConfig.Config "max-size"}}|{{index .HostConfig.LogConfig.Config "max-file"}}' "$managed" 2>/dev/null || true)"
  if [[ "$log_policy" == "local|${DOCKER_LOG_MAX_SIZE}|${DOCKER_LOG_MAX_FILE}" ]]; then
    pass "bounded Docker log policy: $managed"
  else
    fail "bounded Docker log policy: $managed (${log_policy:-unknown})"
  fi
done

if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 5 http://127.0.0.1:18789/healthz >/dev/null 2>&1; then
    pass 'OpenClaw health endpoint :18789/healthz'
  else
    fail 'OpenClaw health endpoint :18789/healthz'
  fi
  if curl -fsS --max-time 5 http://127.0.0.1:5315/health >/dev/null 2>&1; then
    pass 'Product Radar health endpoint :5315/health'
  else
    fail 'Product Radar health endpoint :5315/health'
  fi
else
  warn 'curl is unavailable; HTTP health checks skipped'
fi

if command -v curl >/dev/null 2>&1; then
  fashion_health="$(curl -fsS --max-time 5 "http://127.0.0.1:${FASHION_SIGLIP_PORT}/health" 2>/dev/null || true)"
  if [ -n "$fashion_health" ] && printf '%s' "$fashion_health" | python3 -c 'import json,sys; value=json.load(sys.stdin); raise SystemExit(0 if value.get("status") == "ok" and value.get("device") == "mps" else 1)' >/dev/null 2>&1; then
    pass "FashionSigLIP worker :${FASHION_SIGLIP_PORT}/health (MPS)"
  elif [ "${DOCTOR_REQUIRE_FASHION_SIGLIP:-0}" = "1" ]; then
    fail "FashionSigLIP worker :${FASHION_SIGLIP_PORT}/health is unavailable or not using MPS"
  else
    warn "FashionSigLIP worker :${FASHION_SIGLIP_PORT}/health is unavailable or not using MPS"
  fi
fi

printf 'Doctor result: %s failure(s), %s warning(s).\n' "$failures" "$warnings"
if [ "$failures" -gt 0 ] && [ "$STRICT" != "0" ]; then exit 1; fi
