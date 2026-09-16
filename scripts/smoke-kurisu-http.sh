#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/apps/agent-runtime"
HOST="${KURISU_HTTP_SMOKE_HOST:-127.0.0.1}"
PORT="${KURISU_HTTP_SMOKE_PORT:-15311}"
BASE_URL="http://${HOST}:${PORT}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kurisu-http-smoke.XXXXXX")"
LOG_FILE="$TEMP_DIR/server.log"
PID=""

cleanup() {
  local status=$?
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 ]]; then
    printf '%s\n' "Kurisu HTTP smoke failed; server log: $LOG_FILE" >&2
    sed -n '1,160p' "$LOG_FILE" >&2 || true
  fi
  rm -rf "$TEMP_DIR"
  exit "$status"
}
trap cleanup EXIT INT TERM

command -v curl >/dev/null 2>&1 || { printf '%s\n' 'curl is required.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { printf '%s\n' 'node is required.' >&2; exit 1; }

(
  cd "$RUNTIME_DIR"
  PUBG_QUERY_ENGINE_HOST="$HOST" \
  PUBG_QUERY_ENGINE_PORT="$PORT" \
  PUBG_STATE_FILE="$TEMP_DIR/state.json" \
  PUBG_FEATURE_STATE_FILE="$TEMP_DIR/features.json" \
  PUBG_SELECTION_STATE_FILE="$TEMP_DIR/selections.json" \
  KURISU_STATE_FILE="$TEMP_DIR/kurisu.sqlite" \
  KURISU_GATEWAY_SECRET='kurisu-http-smoke-secret' \
  KURISU_NOTIFICATIONS_ENABLE=0 \
  KURISU_ENABLE_WRITE_TOOLS=0 \
  KURISU_CODEX_ENABLE=0 \
  node --import tsx/esm src/server.ts
) >"$LOG_FILE" 2>&1 &
PID=$!

for _ in $(seq 1 40); do
  if curl --fail --silent --show-error --max-time 1 "$BASE_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
  if ! kill -0 "$PID" 2>/dev/null; then
    printf '%s\n' 'Kurisu HTTP server exited before readiness.' >&2
    exit 1
  fi
done

health_payload="$(curl --fail --silent --show-error --max-time 3 "$BASE_URL/healthz")"
status_payload="$(curl --fail --silent --show-error --max-time 3 "$BASE_URL/kurisu/status")"
tools_payload="$(curl --fail --silent --show-error --max-time 3 "$BASE_URL/kurisu/tools")"

printf '%s' "$health_payload" | node --input-type=module -e '
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk); const body=JSON.parse(Buffer.concat(chunks));
if (body.status !== "ok" || body.service !== "pubg-query-engine-v3") process.exit(1);
'
printf '%s' "$status_payload" | node --input-type=module -e '
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk); const body=JSON.parse(Buffer.concat(chunks));
if (body.contractVersion !== "kurisu.v1" || body.toolCount < 10 || !body.storage) process.exit(1);
'
printf '%s' "$tools_payload" | node --input-type=module -e '
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk); const body=JSON.parse(Buffer.concat(chunks));
const names=new Set((body.tools ?? []).map((tool) => tool.name));
if (body.contractVersion !== "kurisu.v1" || !names.has("kurisu.pubg.query") || !names.has("kurisu.notifications.preference.get")) process.exit(1);
'

unauthorized_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 3 \
  -H 'content-type: application/json' \
  -d '{"toolName":"kurisu.radar.list","input":{"includeRuns":false},"callId":"http-smoke-unauthorized","hostContext":{"platform":"test","platformUserId":"http-smoke-user","conversation":{"kind":"private","chatId":"http-smoke-chat"},"botId":"http-smoke-bot","queryId":"http-smoke-query"}}' \
  "$BASE_URL/kurisu/tool-call")"
if [[ "$unauthorized_status" != '401' ]]; then
  printf '%s\n' "Expected unauthorized Kurisu tool call to return 401, got $unauthorized_status" >&2
  exit 1
fi

tool_response="$(curl --silent --show-error --max-time 3 \
  -H 'content-type: application/json' \
  -H 'x-kurisu-gateway-secret: kurisu-http-smoke-secret' \
  -d '{"toolName":"kurisu.radar.list","input":{"includeRuns":false},"callId":"http-smoke-1","hostContext":{"platform":"test","platformUserId":"http-smoke-user","conversation":{"kind":"private","chatId":"http-smoke-chat"},"botId":"http-smoke-bot","queryId":"http-smoke-query"}}' \
  "$BASE_URL/kurisu/tool-call")"
printf '%s' "$tool_response" | node --input-type=module -e '
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk); const body=JSON.parse(Buffer.concat(chunks));
if (body.contractVersion !== "kurisu.v1" || body.status !== "error" || body.error?.code !== "CAPABILITY_UNAVAILABLE") process.exit(1);
'

printf '%s\n' "Kurisu HTTP smoke passed: /healthz, /kurisu/status, /kurisu/tools, /kurisu/tool-call"
