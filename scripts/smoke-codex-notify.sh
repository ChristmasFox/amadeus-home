#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/integrations/codex/codex-notify.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-notify-smoke.XXXXXX")"
SERVER_PID=""

cleanup() {
  local status=$?
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
  exit "$status"
}
trap cleanup EXIT INT TERM

command -v python3 >/dev/null 2>&1 || { echo 'python3 is required.' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo 'curl is required.' >&2; exit 1; }
[[ -x "$SCRIPT" ]] || { echo "notify script is not executable: $SCRIPT" >&2; exit 1; }

cat >"$TMP_DIR/server.py" <<'PY'
from pathlib import Path
import json
import socketserver
import sys

root = Path(sys.argv[1])
port_file = root / 'port'
request_file = root / 'requests.jsonl'

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        data = bytearray()
        self.request.settimeout(5)
        while b'\r\n\r\n' not in data:
            chunk = self.request.recv(4096)
            if not chunk:
                break
            data.extend(chunk)
        header_end = data.find(b'\r\n\r\n')
        if header_end < 0:
            return
        header_text = bytes(data[:header_end]).decode('iso-8859-1')
        headers = {}
        for line in header_text.split('\r\n')[1:]:
            if ':' in line:
                key, value = line.split(':', 1)
                headers[key.lower()] = value.strip()
        expected = int(headers.get('content-length', '0'))
        body = bytes(data[header_end + 4:])
        while len(body) < expected:
            chunk = self.request.recv(4096)
            if not chunk:
                break
            body += chunk
        try:
            decoded = json.loads(body.decode('utf-8'))
        except Exception:
            decoded = {'invalid_json': body.decode('utf-8', 'replace')}
        record = {'headers': headers, 'body': decoded}
        with request_file.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + '\n')
        self.request.sendall(b'HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')

class Server(socketserver.TCPServer):
    allow_reuse_address = True

server = Server(('127.0.0.1', 0), Handler)
port_file.write_text(str(server.server_address[1]), encoding='utf-8')
while True:
    server.handle_request()
PY
python3 "$TMP_DIR/server.py" "$TMP_DIR" &
SERVER_PID=$!
for _ in $(seq 1 40); do
  [[ -s "$TMP_DIR/port" ]] && break
  sleep 0.05
done
[[ -s "$TMP_DIR/port" ]] || { echo 'smoke server did not start.' >&2; exit 1; }
PORT="$(cat "$TMP_DIR/port")"
URL="http://127.0.0.1:${PORT}/kurisu/notifications/events"
LOG_FILE="$TMP_DIR/notify.log"

valid_payload='{"type":"agent-turn-complete","thread-id":"thread-fixture","turn-id":"turn-fixture","cwd":"/Users/example/project-a","client":"codex_exec","last-assistant-message":"smoke complete api_key=hidden","timestamp":"2026-09-06T03:00:00Z"}'
SMOKE_SECRET='smoke-secret-value-20260916'
CODEX_NOTIFY_URL="$URL" CODEX_NOTIFY_SECRET="$SMOKE_SECRET" CODEX_NOTIFY_LOG_FILE="$LOG_FILE" CODEX_NOTIFY_SPOOL_DIR="$TMP_DIR/spool" "$SCRIPT" "$valid_payload"

python3 - "$TMP_DIR/requests.jsonl" <<'PY'
import json
import sys
from pathlib import Path
rows = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
assert len(rows) == 1, rows
record = rows[0]
assert record['headers']['x-kurisu-notification-secret'] == 'smoke-secret-value-20260916'
body = record['body']
assert body['event'] == 'agent-turn-complete'
assert body['threadId'] == 'thread-fixture'
assert body['turnId'] == 'turn-fixture'
assert body['cwd'] == '/Users/example/project-a'
assert body['projectName'] == 'project-a'
assert body['lastAssistantMessage'] == 'smoke complete api_key=[REDACTED]'
assert body['timestamp'] == '2026-09-06T03:00:00Z'
PY

ignored_payload='{"type":"item.completed","thread-id":"thread-fixture","turn-id":"turn-tool","cwd":"/Users/example/project-a","last-assistant-message":"must be ignored"}'
CODEX_NOTIFY_URL="$URL" CODEX_NOTIFY_SECRET="$SMOKE_SECRET" CODEX_NOTIFY_LOG_FILE="$LOG_FILE" CODEX_NOTIFY_SPOOL_DIR="$TMP_DIR/spool" "$SCRIPT" "$ignored_payload"
[[ "$(wc -l <"$TMP_DIR/requests.jsonl" | tr -d ' ')" == 1 ]] || { echo 'non-completion event was forwarded.' >&2; exit 1; }

set +e
SPOOL_DIR="$TMP_DIR/spool"
CODEX_NOTIFY_URL='http://127.0.0.1:9/kurisu/notifications/events' CODEX_NOTIFY_SECRET="$SMOKE_SECRET" CODEX_NOTIFY_LOG_FILE="$LOG_FILE" CODEX_NOTIFY_SPOOL_DIR="$SPOOL_DIR" "$SCRIPT" "$valid_payload"
network_status=$?
set -e
[[ "$network_status" -eq 0 ]] || { echo 'network failure changed notify hook exit status.' >&2; exit 1; }
[[ "$(find "$SPOOL_DIR" -maxdepth 1 -type f -name '*.json' | wc -l | tr -d ' ')" == 1 ]] || { echo 'network failure did not create one durable spool item.' >&2; exit 1; }
CODEX_NOTIFY_URL='http://127.0.0.1:9/kurisu/notifications/events' CODEX_NOTIFY_SECRET="$SMOKE_SECRET" CODEX_NOTIFY_LOG_FILE="$LOG_FILE" CODEX_NOTIFY_SPOOL_DIR="$SPOOL_DIR" "$SCRIPT" "$valid_payload"
[[ "$(find "$SPOOL_DIR" -maxdepth 1 -type f -name '*.json' | wc -l | tr -d ' ')" == 1 ]] || { echo 'duplicate spool item was not collapsed by payload hash.' >&2; exit 1; }
if grep -F "$SMOKE_SECRET" "$SPOOL_DIR"/*.json >/dev/null 2>&1; then
  echo 'spooled notification leaked the shared secret.' >&2
  exit 1
fi
if grep -F "$SMOKE_SECRET" "$LOG_FILE" >/dev/null 2>&1; then
  echo 'notify log leaked the shared secret.' >&2
  exit 1
fi
drain_output="$(CODEX_NOTIFY_URL='http://127.0.0.1:9/kurisu/notifications/events' CODEX_NOTIFY_SPOOL_DIR="$SPOOL_DIR" "$ROOT_DIR/scripts/drain-codex-notification-spool.sh" --dry-run)"
printf '%s\n' "$drain_output" | grep -F 'SPOOL_COUNT=1' >/dev/null || { echo 'spool drain dry-run did not enumerate the pending item.' >&2; exit 1; }

printf '%s\n' 'Codex notify script smoke passed: completion normalization, event filtering, redaction, timeout/fail-open, and secret-safe logging.'
