#!/usr/bin/env bash
# Manage the protected, loopback-only Wild Krea2 image service.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CONFIG="$ROOT/infra/macos/krea2-image-engine.json"
LABEL='com.amadeus.krea2-image'
TARGET="gui/$(id -u)"
BASE="$HOME/Library/Application Support/Amadeus/Krea2Image"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Amadeus/Krea2Image"
TOKEN="$HOME/Library/Application Support/Amadeus/secrets/krea2-image-token"
SCRIPT="$BASE/bridge.py"
INSTALLED_CONFIG="$BASE/krea2-image-engine.json"
PYTHON="$(command -v python3)"
action=--dry-run
apply=0
remove_models=0

while (($#)); do
  case "$1" in
    --dry-run) action=--dry-run ;;
    --apply) apply=1 ;;
    --status|--health|--start|--stop|--restart|--uninstall) action="$1" ;;
    --remove-models) remove_models=1 ;;
    --help|-h) echo 'Usage: manage-krea2-image.sh [--dry-run|--status|--health|--start|--stop|--restart|--uninstall] [--apply] [--remove-models]'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if ((apply == 1)) && [[ "$action" == --dry-run ]]; then
  action=--start
fi

port="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["servicePort"])' "$CONFIG")"
printf 'MODE=%s\nAPPLY=%s\nSERVICE=%s\nPORT=%s\nTOKEN_FILE=%s\nMODEL_ROOT=%s\nPLIST=%s\n' "$action" "$apply" "$LABEL" "$port" "$TOKEN" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["assetRoot"])' "$CONFIG")" "$PLIST"

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
  ((remove_models == 0)) || { echo '--remove-models requires --uninstall --apply' >&2; exit 2; }
  exit 0
fi
[[ "$action" == --uninstall || "$action" == --start || "$action" == --stop || "$action" == --restart ]] || { echo 'an action is required' >&2; exit 2; }
((apply == 1)) || { echo "$action changes the LaunchAgent or model files; pass --apply explicitly" >&2; exit 2; }

if [[ "$action" == --uninstall ]]; then
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  rm -f -- "$PLIST"
  if ((remove_models)); then
    model_root="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["assetRoot"])' "$CONFIG")"
    [[ "$model_root" == /Volumes/Avalon/models/krea2/* ]] || { echo 'refusing unexpected model root' >&2; exit 1; }
    [[ ! -L "$model_root" ]] || { echo 'refusing symlink model root' >&2; exit 1; }
    rm -rf -- "$model_root"
    echo 'MODELS_REMOVED=explicit'
  else
    echo 'MODELS_PRESERVED=yes'
  fi
  echo 'KREA2_UNINSTALLED=yes'
  exit 0
fi

if [[ "$action" == --stop ]]; then
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  echo 'KREA2_STOPPED=yes'
  exit 0
fi

if [[ "$action" == --start || "$action" == --restart ]]; then
  [[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 host required' >&2; exit 1; }
  model_root="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["assetRoot"])' "$CONFIG")"
  [[ -s "$CONFIG" ]] || { echo 'engine config missing' >&2; exit 1; }
  [[ -s "$model_root/Wild_Krea-2-turbo_NSFW-Q4_1.gguf" && -s "$model_root/wan_2.1_vae.safetensors" && -s "$model_root/Qwen3VL-4B-Instruct-Q4_K_M.gguf" ]] || { echo 'pinned Krea assets missing; run the asset preparation step first' >&2; exit 1; }
  [[ -x "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sdCppBinary"])' "$CONFIG")" ]] || { echo 'pinned sd-server binary missing' >&2; exit 1; }
  mkdir -p "$BASE" "$LOG" "$(dirname "$TOKEN")" "$(dirname "$PLIST")"
  chmod 700 "$BASE" "$LOG" "$(dirname "$TOKEN")"
  if [[ ! -s "$TOKEN" ]]; then
    umask 077; python3 - "$TOKEN" <<'PY'
from pathlib import Path
import secrets, sys
p=Path(sys.argv[1]); p.write_text(secrets.token_urlsafe(48)+'\n'); p.chmod(0o600)
PY
  fi
  [[ "$(stat -f %Lp "$TOKEN")" == 600 ]] || { echo 'Krea token must be mode 600' >&2; exit 1; }
  install -m 700 "$ROOT/apps/krea2-image-service/bridge.py" "$SCRIPT"
  install -m 600 "$CONFIG" "$INSTALLED_CONFIG"
  temporary="$(mktemp "$PLIST.tmp.XXXXXX")"
  trap 'rm -f "$temporary"' EXIT
  sed -e "s|__PYTHON__|$PYTHON|g" -e "s|__SERVICE_SCRIPT__|$SCRIPT|g" -e "s|__ENGINE_CONFIG__|$INSTALLED_CONFIG|g" -e "s|__TOKEN_FILE__|$TOKEN|g" -e "s|__LOG_DIR__|$LOG|g" "$ROOT/infra/macos/com.amadeus.krea2-image.plist.example" > "$temporary"
  plutil -lint "$temporary" >/dev/null
  install -m 600 "$temporary" "$PLIST"
  rm -f "$temporary"
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$TARGET" "$PLIST"
  launchctl enable "$TARGET/$LABEL"
  echo 'KREA2_AGENT=installed'
  for _ in {1..15}; do
    if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$port/health" >/dev/null; then
      echo 'KREA2_HEALTH=ready'
      break
    fi
    sleep 1
  done
fi
if [[ "$action" == --restart ]]; then
  echo 'KREA2_RESTARTED=yes'
elif [[ "$action" == --start ]]; then
  echo 'KREA2_STARTED=yes'
fi
