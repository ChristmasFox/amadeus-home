#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
LABEL='com.amadeus.qwen3-tts'
BASE="$HOME/Library/Application Support/Amadeus/speech"
VOICE="$HOME/Library/Application Support/Amadeus/voices/kurisu-v1"
LOG="$HOME/Library/Logs/Amadeus"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TARGET="gui/$(id -u)"
mode="${1:---dry-run}"
case "$mode" in --dry-run|--prepare-apply|--apply|--apply-plist-only|--status|--uninstall) ;; *) echo 'Usage: manage-qwen3-tts.sh [--dry-run|--prepare-apply|--apply|--apply-plist-only|--status|--uninstall]' >&2; exit 2;; esac
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 host required' >&2; exit 1; }
if [[ "$mode" == --status ]]; then
  launchctl print "$TARGET/$LABEL" 2>/dev/null | grep -E 'state =|pid =|last exit code =' || true
  /usr/bin/curl -s -o /dev/null -w 'HEALTH_HTTP=%{http_code}\n' --max-time 2 http://127.0.0.1:18792/healthz || true
  exit 0
fi
printf 'MODE=%s\nSERVICE=%s\nPROFILE=%s\nPLIST=%s\n' "$mode" "$BASE" "$VOICE" "$PLIST"
if [[ "$mode" == --dry-run ]]; then exit 0; fi
if [[ "$mode" == --uninstall ]]; then
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  rm -f -- "$PLIST" # preserve voice, token, model cache, logs and venv for rollback
  exit 0
fi
if [[ "$mode" == --apply || "$mode" == --apply-plist-only ]]; then
  [[ -s "$VOICE/reference.wav" && -s "$VOICE/reference.txt" ]] || { echo 'operator-owned kurisu-v1 profile missing' >&2; exit 1; }
  [[ "$(stat -f %Lp "$VOICE/reference.wav")" == 600 && "$(stat -f %Lp "$VOICE/reference.txt")" == 600 ]] || { echo 'reference pair must have mode 600' >&2; exit 1; }
  [[ -s "$BASE/tts.token" ]] || { echo "create protected 32+ character token at $BASE/tts.token" >&2; exit 1; }
  [[ "$(stat -f %Lp "$BASE/tts.token")" == 600 ]] || { echo 'token must have mode 600' >&2; exit 1; }
  [[ -s "$BASE/model/config.json" ]] || { echo 'pinned model absent; run --prepare-apply first' >&2; exit 1; }
fi
mkdir -p "$BASE" "$LOG" "$(dirname "$PLIST")"
if [[ "$mode" != --apply-plist-only ]]; then
  if [[ ! -x "$BASE/venv/bin/python" ]]; then python3 -m venv "$BASE/venv"; fi
  "$BASE/venv/bin/python" -m pip install -r "$ROOT/apps/qwen3-tts-service/requirements.txt"
fi
if [[ "$mode" == --prepare-apply ]]; then
  HF_HOME="$BASE/model-cache" "$BASE/venv/bin/python" - "$BASE/model" <<'PYMODEL'
from huggingface_hub import snapshot_download
import sys
snapshot_download(
    repo_id="Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    revision="fd4b254389122332181a7c3db7f27e918eec64e3",
    local_dir=sys.argv[1],
)
print("PINNED_MODEL=downloaded")
PYMODEL
  if [[ ! -s "$BASE/tts.token" ]]; then
    "$BASE/venv/bin/python" - "$BASE/tts.token" <<'PYTOKEN'
from pathlib import Path
import secrets,sys
p=Path(sys.argv[1])
with p.open('x', encoding='utf-8') as f:
    f.write(secrets.token_urlsafe(48) + '\n')
p.chmod(0o600)
print('TTS_TOKEN=created (value suppressed)')
PYTOKEN
  fi
  exit 0
fi
if [[ "$mode" == --apply ]]; then
  install -m 600 "$ROOT/apps/qwen3-tts-service/service.py" "$BASE/service.py"
  install -m 600 "$ROOT/apps/qwen3-tts-service/mlx_engine.py" "$BASE/mlx_engine.py"
  install -m 600 "$ROOT/apps/qwen3-tts-service/engine_contract.py" "$BASE/engine_contract.py"
  cp "$ROOT/apps/qwen3-tts-service/requirements.txt" "$BASE/requirements.txt"
fi
python3 - "$ROOT/infra/macos/com.amadeus.qwen3-tts.plist.example" "$PLIST" "$BASE" "$VOICE" "$LOG" <<'PY'
import sys
from pathlib import Path
source, target, base, voice, log = map(Path, sys.argv[1:])
replacements = {
    '__VENV_PYTHON__': str(base / 'venv/bin/python'),
    '__SERVICE_SCRIPT__': str(base / 'service.py'),
    '__TOKEN_FILE__': str(base / 'tts.token'),
    '__VOICE_DIR__': str(voice),
    '__LOG_DIR__': str(log),
    '__MODEL_CACHE__': str(base / 'model-cache'),
    '__MODEL_PATH__': str(base / 'model'),
}
text = source.read_text()
for old, new in replacements.items():
    text = text.replace(old, new)
target.write_text(text)
target.chmod(0o600)
PY
plutil -lint "$PLIST"
launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
# launchd may still report the old job as SIGTERMed immediately after bootout.
# Do not race bootstrap against the retiring job (observed error 5 on M204).
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if ! launchctl print "$TARGET/$LABEL" >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 10 ]]; then
    echo 'old LaunchAgent did not retire; use protected checkpoint to recover' >&2
    exit 1
  fi
  sleep 1
done
bootstrapped=0
for attempt in 1 2 3; do
  if launchctl bootstrap "$TARGET" "$PLIST"; then bootstrapped=1; break; fi
  [[ "$attempt" == 3 ]] && break
  sleep 1
done
[[ "$bootstrapped" == 1 ]] || { echo 'LaunchAgent bootstrap failed; use protected checkpoint to recover' >&2; exit 1; }
launchctl enable "$TARGET/$LABEL"
echo 'QWEN3_TTS=installed (health readiness may take model-download/warmup time)'
