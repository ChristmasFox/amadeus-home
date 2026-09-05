#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/apps/agent-runtime"
HOST="${AGENT_RUNTIME_SMOKE_HOST:-127.0.0.1}"
PORT="${AGENT_RUNTIME_SMOKE_PORT:-15310}"
BASE_URL="http://${HOST}:${PORT}"
LOG_FILE="$(mktemp "${TMPDIR:-/tmp}/agent-runtime-smoke.XXXXXX.log")"
PID=""

cleanup() {
  local status=$?
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 ]]; then
    printf '%s\n' "Agent runtime smoke failed; server log: $LOG_FILE" >&2
    cat "$LOG_FILE" >&2 || true
  fi
  rm -f "$LOG_FILE"
  exit "$status"
}
trap cleanup EXIT INT TERM

if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' 'curl is required for the local runtime smoke test.' >&2
  exit 1
fi

(
  cd "$RUNTIME_DIR"
  PUBG_QUERY_ENGINE_HOST="$HOST" \
  PUBG_QUERY_ENGINE_PORT="$PORT" \
  node --env-file-if-exists=../../.env --import tsx/esm src/server.ts
) >"$LOG_FILE" 2>&1 &
PID=$!

for _ in $(seq 1 40); do
  if curl --fail --silent --show-error --max-time 1 "$BASE_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
  if ! kill -0 "$PID" 2>/dev/null; then
    printf '%s\n' 'Agent runtime exited before the smoke endpoint became ready.' >&2
    exit 1
  fi
done

curl --fail --silent --show-error --max-time 3 "$BASE_URL/healthz" >/dev/null
curl --fail --silent --show-error --max-time 3 "$BASE_URL/homehub/health" >/dev/null
printf '%s\n' "Local agent-runtime smoke passed: $BASE_URL/healthz and /homehub/health"
