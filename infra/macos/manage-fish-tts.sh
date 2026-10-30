#!/usr/bin/env bash
# Single native TTS LaunchAgent: Fish Audio S2 Pro (MLX) behind the Qwen-compatible speech contract on 127.0.0.1:18794.
# Syncs the service sources from Git into the runtime directory, renders the LaunchAgent and (re)starts it.
# Models, the voice profile and the shared token are never written by this script.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
LABEL='com.amadeus.fish-tts'
BASE="$HOME/Library/Application Support/Amadeus/speech-fish"
VOICE="$HOME/Library/Application Support/Amadeus/voices/kurisu-v1"
TOKEN="$HOME/Library/Application Support/Amadeus/speech/tts.token"
SRC="$ROOT/apps/qwen3-tts-service"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TARGET="gui/$(id -u)"
FILES=(service.py engine_contract.py fish_engine.py fish_emotion.py)
mode=--dry-run
while (($#)); do
  case "$1" in
    --dry-run|--apply|--status|--uninstall) mode="$1" ;;
    *) echo 'Usage: manage-fish-tts.sh [--dry-run|--apply|--status|--uninstall]' >&2; exit 2 ;;
  esac
  shift
done
if [[ "$mode" == --status ]]; then
  launchctl print "$TARGET/$LABEL" 2>/dev/null | grep -E 'state =|pid =|last exit code =' || echo 'NOT_LOADED'
  /usr/bin/curl -s --max-time 3 http://127.0.0.1:18794/healthz || true; echo
  for f in "${FILES[@]}"; do
    if cmp -s "$SRC/$f" "$BASE/$f"; then echo "IN_SYNC $f"; else echo "DRIFT $f"; fi
  done
  exit 0
fi
printf 'MODE=%s\nSERVICE=%s\nPROFILE=%s\nPLIST=%s\n' "$mode" "$BASE" "$VOICE" "$PLIST"
if [[ "$mode" == --uninstall ]]; then
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  rm -f -- "$PLIST" # keeps the runtime directory, models, voice profile and token for rollback
  exit 0
fi
for f in "${FILES[@]}"; do [[ -f "$SRC/$f" ]] || { echo "missing source $f" >&2; exit 1; }; done
[[ -f "$VOICE/reference.wav" && -f "$VOICE/reference.txt" ]] || { echo 'kurisu-v1 voice profile missing' >&2; exit 1; }
[[ -f "$TOKEN" ]] || { echo 'shared TTS token missing' >&2; exit 1; }
if [[ "$mode" == --dry-run ]]; then
  [[ -x "$BASE/venv/bin/python" ]] && echo 'VENV=present' || echo 'VENV=missing (--apply would create it from requirements-fish-tts.txt)'
  for f in "${FILES[@]}"; do cmp -s "$SRC/$f" "$BASE/$f" && echo "IN_SYNC $f" || echo "WOULD_SYNC $f"; done
  exit 0
fi
mkdir -p "$BASE" "$HOME/Library/Logs/Amadeus" "$(dirname "$PLIST")"
if [[ ! -x "$BASE/venv/bin/python" ]]; then
  python3 -m venv "$BASE/venv"
  "$BASE/venv/bin/pip" install -r "$ROOT/infra/macos/requirements-fish-tts.txt"
fi
for f in "${FILES[@]}"; do install -m 0644 "$SRC/$f" "$BASE/$f"; done
sed "s#/Users/OPERATOR#$HOME#g" "$ROOT/infra/macos/$LABEL.plist.example" > "$PLIST.tmp"
plutil -lint "$PLIST.tmp" >/dev/null
chmod 600 "$PLIST.tmp"; mv "$PLIST.tmp" "$PLIST"
if launchctl print "$TARGET/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "$TARGET/$LABEL"
else
  launchctl bootstrap "$TARGET" "$PLIST"
fi
for _ in $(seq 1 90); do
  if /usr/bin/curl -fsS --max-time 3 http://127.0.0.1:18794/healthz 2>/dev/null | grep -q '"status": *"ready"'; then echo 'FISH_TTS=ready'; exit 0; fi
  sleep 5
done
echo 'FISH_TTS=not_ready' >&2; exit 1
