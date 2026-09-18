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

printf 'Doctor result: %s failure(s), %s warning(s).\n' "$failures" "$warnings"
if [ "$failures" -gt 0 ] && [ "$STRICT" != "0" ]; then exit 1; fi
