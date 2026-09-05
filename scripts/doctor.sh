#!/usr/bin/env bash
set -Eeuo pipefail

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
STRICT="${DOCTOR_STRICT:-1}"
failures=0
warnings=0

pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

if ! command -v orb >/dev/null 2>&1; then
  fail "OrbStack CLI not found"
else
  pass "OrbStack CLI found"
fi

containers=""
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

check_container() {
  local label="$1"
  local name="$2"
  local line
  if line="$(container_line "$name")"; then
    pass "$label container $name (${line#*$'\t'})"
  else
    fail "$label container $name is not running"
  fi
}

check_container "LangBot" langbot
check_container "Mastra runtime" pubg-query-engine-v3
check_container "n8n" n8n

if container_line pubg-query-engine-v3 >/dev/null 2>&1; then
  pass "Telemetry Worker is embedded in the Mastra runtime and its container is running"
else
  fail "Telemetry Worker runtime container is unavailable"
fi

if printf '%s\n' "$containers" | awk -F '\t' '$1 ~ /^(postgres|postgresql|immich-postgres)$/ { found = 1 } END { exit found ? 0 : 1 }'; then
  pass "Postgres container detected"
else
  warn "No Postgres container detected; current n8n setup may use SQLite"
fi

if printf '%s\n' "$containers" | awk -F '\t' '$1 ~ /^(redis|immich-redis)$/ { found = 1 } END { exit found ? 0 : 1 }'; then
  pass "Redis container detected (cache is rebuildable)"
else
  warn "No Redis container detected; Redis is optional and treated as rebuildable cache"
fi

if printf '%s\n' "$containers" | awk -F '\t' '$1 ~ /cloudflared|cloudflare|tunnel/ { found = 1 } END { exit found ? 0 : 1 }'; then
  pass "Cloudflare Tunnel container detected"
else
  if command -v cloudflared >/dev/null 2>&1; then
    pass "cloudflared CLI detected; verify tunnel status separately"
  else
    warn "Cloudflare Tunnel is not running or cloudflared is not installed"
  fi
fi

if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 5 http://127.0.0.1:5310/healthz >/dev/null 2>&1; then
    pass "Mastra runtime health endpoint :5310/healthz"
  else
    fail "Mastra runtime health endpoint :5310/healthz"
  fi
  if curl -fsS --max-time 5 http://127.0.0.1:5679/healthz >/dev/null 2>&1; then
    pass "n8n health endpoint :5679/healthz"
  else
    warn "n8n health endpoint :5679/healthz is unavailable or this n8n version uses another health route"
  fi
else
  warn "curl is unavailable; HTTP health checks skipped"
fi

printf 'Doctor result: %s failure(s), %s warning(s).\n' "$failures" "$warnings"
if [ "$failures" -gt 0 ] && [ "$STRICT" != "0" ]; then
  exit 1
fi
