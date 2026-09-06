#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
CONFIG_FILE="${CODEX_CONFIG_FILE:-$CODEX_HOME_DIR/config.toml}"
SCRIPT="$CODEX_HOME_DIR/bin/codex-notify.sh"
SECRET_FILE="${CODEX_NOTIFY_SECRET_FILE:-$CODEX_HOME_DIR/secrets/codex-notify-secret}"
BASE_URL="${CODEX_NOTIFY_RUNTIME_URL:-http://127.0.0.1:5679/webhook/codex-complete}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-notification-runtime-smoke.XXXXXX")"

cleanup() {
  local status=$?
  rm -rf "$TMP_DIR"
  exit "$status"
}
trap cleanup EXIT INT TERM

[[ -x "$SCRIPT" ]] || { echo "Global notify script is missing: $SCRIPT" >&2; exit 1; }
[[ -s "$SECRET_FILE" ]] || { echo "Shared secret file is missing: $SECRET_FILE" >&2; exit 1; }
grep -F "notify = [\"zsh\", \"$SCRIPT\"]" "$CONFIG_FILE" >/dev/null || { echo 'Global Codex notify config is not installed.' >&2; exit 1; }
cmp -s "$ROOT_DIR/integrations/codex/codex-notify.sh" "$SCRIPT" || { echo 'Installed notify script differs from Git source.' >&2; exit 1; }

payload='{"event":"agent-turn-complete","threadId":"runtime-smoke-thread-'"$(date +%s)"'","turnId":"runtime-smoke-turn-1","cwd":"/Users/example/project-a","projectName":"payload-recipient-must-be-ignored","lastAssistantMessage":"Codex notification runtime smoke.","timestamp":"2026-09-06T04:10:00Z","recipient":{"type":"group","id":"must-be-ignored"}}'
secret="$(cat "$SECRET_FILE")"

/usr/bin/curl -sS -o "$TMP_DIR/invalid.json" -w '%{http_code}' --max-time 30 \
  -H 'content-type: application/json' \
  -d "$payload" "$BASE_URL" >"$TMP_DIR/invalid.status"
[[ "$(cat "$TMP_DIR/invalid.status")" == 401 ]] || { echo 'Missing-secret request was not rejected.' >&2; exit 1; }

/usr/bin/curl --fail --silent --show-error --max-time 40 \
  -H 'content-type: application/json' -H "X-Codex-Notify-Secret: $secret" \
  -d "$payload" "$BASE_URL" >"$TMP_DIR/first.json"
/usr/bin/curl --fail --silent --show-error --max-time 40 \
  -H 'content-type: application/json' -H "X-Codex-Notify-Secret: $secret" \
  -d "$payload" "$BASE_URL" >"$TMP_DIR/duplicate.json"
unset secret payload

node --input-type=module - "$TMP_DIR/first.json" "$TMP_DIR/duplicate.json" <<'NODE'
import fs from 'node:fs';
const first = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const duplicate = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
if (first.accepted !== true || first.duplicate !== false) throw new Error('first completion was not accepted');
if (first.telegram?.status !== 'sent' || first.kook?.status !== 'sent') throw new Error('both private platform sends were not confirmed');
if (first.projectName !== 'project-a') throw new Error('project name was not derived from cwd');
if (duplicate.accepted !== false || duplicate.duplicate !== true) throw new Error('duplicate completion was not suppressed');
console.log(`Runtime smoke passed: Telegram=${first.telegram.status}, KOOK=${first.kook.status}, duplicate suppressed, project=${first.projectName}.`);
NODE
