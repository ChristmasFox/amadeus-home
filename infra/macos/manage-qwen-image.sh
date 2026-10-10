#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CONFIG="$ROOT/infra/macos/qwen-image-engine.json"
FAST_CONFIG="$ROOT/infra/macos/qwen-image-fast-engine.json"
LABEL='com.amadeus.qwen-image'
KREA_LABEL='com.amadeus.krea2-image'
TARGET="gui/$(id -u)"
BASE="$HOME/Library/Application Support/Amadeus/QwenImage"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Amadeus/QwenImage"
TOKEN="$HOME/Library/Application Support/Amadeus/secrets/qwen-image-token"
RUNTIME_PROFILE="${QWEN_IMAGE_RUNTIME_PROFILE:-$HOME/Library/Application Support/Amadeus/secrets/qwen-image-runtime.json}"
OPERATOR_HOSTNAME="${AMADEUS_MAC_HOSTNAME:-${MAC_HOST_NAME:-}}"
SCRIPT="$BASE/bridge.py"
INSTALLED_CONFIG="$BASE/qwen-image-engine.json"
INSTALLED_FAST_CONFIG="$BASE/qwen-image-fast-engine.json"
PYTHON="$(command -v python3)"
action=--dry-run
apply=0
explicit_action=0

while (($#)); do
  case "$1" in
    --apply) apply=1 ;;
    --dry-run|--status|--health|--start|--stop|--restart|--uninstall) action="$1"; explicit_action=1 ;;
    --help|-h) echo 'Usage: manage-qwen-image.sh [--dry-run|--status|--health|--start|--stop|--restart|--uninstall] [--apply]'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if ((apply == 1 && explicit_action == 0)); then
  action=--start
fi

port="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["servicePort"])' "$CONFIG")"
printf 'MODE=%s\nAPPLY=%s\nSERVICE=%s\nPORT=%s\nTOKEN_FILE=%s\nRUNTIME_PROFILE=%s\nASSET_ROOT=operator-profile\nPLIST=%s\n' \
  "$action" "$apply" "$LABEL" "$port" "$TOKEN" \
  "$RUNTIME_PROFILE" "$PLIST"

if [[ "$action" == --status ]]; then
  launchctl print "$TARGET/$LABEL" 2>/dev/null | grep -E 'state =|pid =|last exit code =' || true
  curl -sS --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null || true
  exit 0
fi
if [[ "$action" == --health ]]; then
  curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:$port/health"
  exit 0
fi
if [[ "$action" == --dry-run ]]; then
  exit 0
fi
[[ "$action" == --uninstall || "$action" == --start || "$action" == --stop || "$action" == --restart ]] || { echo 'an action is required' >&2; exit 2; }
((apply == 1)) || { echo "$action changes the LaunchAgent or service files; pass --apply explicitly" >&2; exit 2; }
[[ -n "$OPERATOR_HOSTNAME" && "$(hostname -s)" == "$OPERATOR_HOSTNAME" ]] || { echo 'operator host profile required' >&2; exit 1; }

if [[ "$action" == --uninstall ]]; then
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  rm -f -- "$PLIST"
  rm -f -- "$SCRIPT" "$INSTALLED_CONFIG" "$INSTALLED_FAST_CONFIG"
  echo 'QWEN_IMAGE_UNINSTALLED=yes'
  echo 'MODEL_ASSETS_PRESERVED=yes'
  echo 'TOKEN_PRESERVED=yes'
  exit 0
fi

if [[ "$action" == --stop ]]; then
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  echo 'QWEN_IMAGE_STOPPED=yes'
  exit 0
fi

if [[ "$action" == --start || "$action" == --restart ]]; then
  [[ -f "$RUNTIME_PROFILE" && ! -L "$RUNTIME_PROFILE" && "$(stat -f %Lp "$RUNTIME_PROFILE")" == 600 ]] || {
    echo "Qwen runtime profile is missing or not mode 600: $RUNTIME_PROFILE" >&2
    exit 1
  }
  operator_hostname="$(python3 -c 'import json,sys; value=json.load(open(sys.argv[1])).get("hostName", ""); print(value if isinstance(value,str) else "")' "$RUNTIME_PROFILE")"
  [[ -n "$operator_hostname" && "$(hostname -s)" == "$operator_hostname" ]] || {
    echo 'Qwen runtime profile host identity mismatch' >&2
    exit 1
  }
  if launchctl print "$TARGET/$KREA_LABEL" >/dev/null 2>&1; then
    echo 'refusing concurrent Krea diffusion service' >&2
    exit 1
  fi
  python3 "$ROOT/scripts/render-qwen-image-config.py" "$CONFIG" "$RUNTIME_PROFILE" "$INSTALLED_CONFIG"
  python3 "$ROOT/scripts/render-qwen-image-config.py" "$FAST_CONFIG" "$RUNTIME_PROFILE" "$INSTALLED_FAST_CONFIG"
  asset_root="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["assetRoot"])' "$INSTALLED_CONFIG")"
  runtime_repo="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sdCppSourcePath"])' "$INSTALLED_CONFIG")"
  expected_commit="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sdCppCommit"])' "$INSTALLED_CONFIG")"
  runtime_binary="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sdCppBinary"])' "$INSTALLED_CONFIG")"
  [[ -s "$asset_root/diffusion/qwen-image-2.1-UC-Q4_K_M.gguf" && -s "$asset_root/text-encoder/Qwen3VL-8B-Instruct-Q4_K_M.gguf" && -s "$asset_root/text-encoder/mmproj-Qwen3VL-8B-Instruct-F16.gguf" && -s "$asset_root/vae/qwen_image_2.1_vae_bf16.safetensors" ]] || { echo 'pinned Qwen assets missing' >&2; exit 1; }
  [[ -x "$runtime_binary" ]] || { echo 'pinned sd-server binary missing' >&2; exit 1; }
  [[ "$(git -C "$runtime_repo" rev-parse HEAD)" == "$expected_commit" ]] || { echo 'pinned stable-diffusion.cpp revision mismatch' >&2; exit 1; }
  mkdir -p "$BASE" "$LOG" "$(dirname "$TOKEN")" "$(dirname "$PLIST")"
  chmod 700 "$BASE" "$LOG" "$(dirname "$TOKEN")"
  for log_file in bridge.stdout.log bridge.stderr.log sd-server.log; do
    touch "$LOG/$log_file"
    chmod 600 "$LOG/$log_file"
  done
  if [[ ! -s "$TOKEN" ]]; then
    umask 077
    python3 - "$TOKEN" <<'PY'
from pathlib import Path
import secrets
import sys

token_path = Path(sys.argv[1])
token_path.write_text(secrets.token_urlsafe(48) + "\n")
token_path.chmod(0o600)
PY
  fi
  [[ "$(stat -f %Lp "$TOKEN")" == 600 ]] || { echo 'Qwen token must be mode 600' >&2; exit 1; }
  install -m 700 "$ROOT/apps/qwen-image-service/bridge.py" "$SCRIPT"
  temporary="$(mktemp "$PLIST.tmp.XXXXXX")"
  trap 'rm -f "$temporary"' EXIT
  sed -e "s|__PYTHON__|$PYTHON|g" -e "s|__SERVICE_SCRIPT__|$SCRIPT|g" -e "s|__QUALITY_CONFIG__|$INSTALLED_CONFIG|g" -e "s|__FAST_CONFIG__|$INSTALLED_FAST_CONFIG|g" -e "s|__TOKEN_FILE__|$TOKEN|g" -e "s|__LOG_DIR__|$LOG|g" "$ROOT/infra/macos/com.amadeus.qwen-image.plist.example" > "$temporary"
  plutil -lint "$temporary" >/dev/null
  install -m 600 "$temporary" "$PLIST"
  rm -f "$temporary"
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  bootstrapped=0
  for _ in {1..10}; do
    if launchctl bootstrap "$TARGET" "$PLIST" 2>/dev/null; then
      bootstrapped=1
      break
    fi
    sleep 1
  done
  ((bootstrapped == 1)) || { echo 'Qwen image bridge LaunchAgent could not be loaded; inspect launchd state' >&2; exit 1; }
  launchctl enable "$TARGET/$LABEL"
  echo 'QWEN_IMAGE_AGENT=installed'
  ready=0
  for _ in {1..660}; do
    if response="$(curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null)"; then
      if [[ "$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("model", ""))')" == local/qwen-image-2.1-uncensored ]]; then
        echo 'QWEN_IMAGE_HEALTH=ready'
        ready=1
        break
      fi
    fi
    sleep 1
  done
  ((ready == 1)) || { echo 'Qwen image service health timeout; inspect protected launchd logs' >&2; exit 1; }
fi

if [[ "$action" == --restart ]]; then
  echo 'QWEN_IMAGE_RESTARTED=yes'
elif [[ "$action" == --start ]]; then
  echo 'QWEN_IMAGE_STARTED=yes'
fi
