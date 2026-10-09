#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=com.amadeus.qwen-image-debug-ui
TARGET="gui/$(id -u)"
BASE="$HOME/Library/Application Support/Amadeus/QwenImageDebugUI"
OUTPUT="$HOME/Pictures/Amadeus/QwenImage"
LOG="$HOME/Library/Logs/Amadeus/QwenImageDebugUI"
SECRETS="$HOME/Library/Application Support/Amadeus/secrets"
BRIDGE_TOKEN="$SECRETS/qwen-image-token"
LEGACY_UI_TOKEN="$SECRETS/qwen-image-debug-ui-token"
PUBLIC_AUTH="$SECRETS/qwen-image-lab-auth.json"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=18798
ACTION=--dry-run
APPLY=0

for argument in "$@"; do
  case "$argument" in
    --apply) APPLY=1 ;;
    --dry-run) ACTION=--dry-run ;;
    --status|--stop) ACTION="$argument" ;;
    *) echo "unknown argument: $argument" >&2; exit 2 ;;
  esac
done

if [[ "$ACTION" == --status ]]; then
  if launchctl print "$TARGET/$LABEL" >/dev/null 2>&1; then
    echo 'QWEN_DEBUG_UI_AGENT=loaded'
  else
    echo 'QWEN_DEBUG_UI_AGENT=not_loaded'
  fi
  curl -sS --max-time 2 -o /dev/null -w 'QWEN_DEBUG_UI_HTTP=%{http_code}\n' "http://127.0.0.1:$PORT/" || true
  for interface in en0 en1; do
    address="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    [[ -z "$address" ]] || printf 'QWEN_DEBUG_UI_URL=http://%s:%s\n' "$address" "$PORT"
  done
  exit 0
fi

if [[ "$ACTION" == --stop ]]; then
  (( APPLY == 1 )) || { echo '--stop changes a LaunchAgent; pass --stop --apply' >&2; exit 2; }
  [[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 host required' >&2; exit 1; }
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  echo 'QWEN_DEBUG_UI_STOPPED=yes'
  exit 0
fi

if (( APPLY == 0 )); then
  cat <<EOF
QWEN_DEBUG_UI_ACTION=install_or_update
QWEN_DEBUG_UI_HOST=0.0.0.0
QWEN_DEBUG_UI_PORT=$PORT
QWEN_BRIDGE_TARGET=http://127.0.0.1:18793
QWEN_DEBUG_UI_PRIVATE_ACCESS=no-login
QWEN_DEBUG_UI_PUBLIC_HOST=image.nyannyan.top
QWEN_DEBUG_UI_PUBLIC_AUTH=runtime-scrypt-verifier-required
QWEN_DEBUG_UI_RUNTIME=lightweight Python LaunchAgent; no model process added
QWEN_DEBUG_UI_OUTPUT_DIR=$OUTPUT
Run with --apply to install and start the LAN-only page.
EOF
  exit 0
fi

[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 host required' >&2; exit 1; }
PYTHON=/opt/homebrew/opt/python@3.11/libexec/bin/python3
[[ -x "$PYTHON" ]] || PYTHON="$(command -v python3)"
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || { echo 'Python 3.11 or newer is required' >&2; exit 1; }
[[ -s "$BRIDGE_TOKEN" && "$(stat -f %Lp "$BRIDGE_TOKEN")" == 600 ]] || { echo 'Qwen bridge token is missing or not mode 600' >&2; exit 1; }
[[ -s "$PUBLIC_AUTH" && "$(stat -f %Lp "$PUBLIC_AUTH")" == 600 ]] || { echo 'public Image Lab verifier is missing or not mode 600' >&2; exit 1; }
health="$(curl -fsS --max-time 3 http://127.0.0.1:18793/health)" || { echo 'Qwen bridge is not responding on port 18793' >&2; exit 1; }
printf '%s' "$health" | "$PYTHON" -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("status")=="ready" and d.get("model")=="local/qwen-image-2.1-uncensored" else 1)' || {
  echo 'Qwen bridge health is not ready' >&2
  exit 1
}

mkdir -p "$BASE" "$LOG" "$OUTPUT" "$(dirname "$PLIST")"
chmod 700 "$BASE" "$LOG"
chmod 700 "$OUTPUT"
for log_file in debug-ui.stdout.log debug-ui.stderr.log; do
  touch "$LOG/$log_file"
  chmod 600 "$LOG/$log_file"
done
install -m 700 "$ROOT/apps/qwen-image-service/debug_ui.py" "$BASE/debug_ui.py"
install -m 600 "$ROOT/apps/qwen-image-service/debug-ui.html" "$BASE/debug-ui.html"
temporary="$(mktemp "$PLIST.tmp.XXXXXX")"
trap 'rm -f "$temporary"' EXIT
sed \
  -e "s|__PYTHON__|$PYTHON|g" \
  -e "s|__SCRIPT__|$BASE/debug_ui.py|g" \
  -e "s|__BRIDGE_TOKEN_FILE__|$BRIDGE_TOKEN|g" \
  -e "s|__AUTH_FILE__|$PUBLIC_AUTH|g" \
  -e "s|__HTML_FILE__|$BASE/debug-ui.html|g" \
  -e "s|__OUTPUT_DIR__|$OUTPUT|g" \
  -e "s|__LOG_DIR__|$LOG|g" \
  "$ROOT/infra/macos/com.amadeus.qwen-image-debug-ui.plist.example" > "$temporary"
plutil -lint "$temporary" >/dev/null
install -m 600 "$temporary" "$PLIST"
rm -f "$temporary"
trap - EXIT
launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
bootstrapped=0
for _ in {1..10}; do
  if launchctl bootstrap "$TARGET" "$PLIST" 2>/dev/null; then
    bootstrapped=1
    break
  fi
  sleep 1
done
(( bootstrapped == 1 )) || { echo 'Qwen debug UI LaunchAgent could not be loaded; inspect launchd state' >&2; exit 1; }
launchctl enable "$TARGET/$LABEL"

ready=0
for _ in {1..20}; do
  if curl -fsS --max-time 2 -H 'Host: 127.0.0.1:18798' "http://127.0.0.1:$PORT/" | grep -q 'Qwen Image 本地调试台'; then
    ready=1
    break
  fi
  sleep 1
done
(( ready == 1 )) || { echo 'Qwen debug UI did not become ready; inspect protected LaunchAgent logs' >&2; exit 1; }

"$PYTHON" - "$PORT" <<'PY'
import http.client
import json
import sys

port = int(sys.argv[1])
connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
connection.request("GET", "/api/models", headers={"Host": f"127.0.0.1:{port}"})
models = connection.getresponse()
payload = json.loads(models.read())
if models.status != 200 or payload.get("data", [{}])[0].get("id") != "local/qwen-image-2.1-uncensored":
    raise SystemExit("Qwen debug UI open LAN model discovery smoke failed")
connection.close()
print("QWEN_DEBUG_UI_NO_LOGIN_SMOKE=pass")
print("QWEN_DEBUG_UI_LOCAL_MODEL_DISCOVERY=pass")
PY

echo 'QWEN_DEBUG_UI_AGENT=installed'
echo 'QWEN_DEBUG_UI_ACCESS=all-private-and-loopback-clients'
echo 'QWEN_DEBUG_UI_PUBLIC_AUTH=password-only-scrypt-session'
rm -f "$LEGACY_UI_TOKEN"
for interface in en0 en1; do
  address="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
  [[ -z "$address" ]] || printf 'QWEN_DEBUG_UI_URL=http://%s:%s\n' "$address" "$PORT"
done
