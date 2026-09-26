#!/usr/bin/env bash
# Single native TTS LaunchAgent; Git-declared engine is MLX, explicit MPS rollback only.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CONFIG="$ROOT/infra/macos/qwen3-tts-engine.json"
LABEL='com.amadeus.qwen3-tts'
BASE="$HOME/Library/Application Support/Amadeus/speech"
VOICE="$HOME/Library/Application Support/Amadeus/voices/kurisu-v1"
MLX_ROOT="$BASE/mlx-poc" # retained protected PoC path; no duplicate model/venv migration
LOG="$HOME/Library/Logs/Amadeus"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TARGET="gui/$(id -u)"
mode=--dry-run
engine="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["productionEngine"])' "$CONFIG")"
explicit_engine=0
while (($#)); do
  case "$1" in
    --dry-run|--prepare-apply|--apply|--apply-plist-only|--status|--uninstall) mode="$1" ;;
    --engine)
      (($# >= 2)) || { echo '--engine requires mps or mlx' >&2; exit 2; }
      engine="$2"; explicit_engine=1; shift ;;
    *) echo 'Usage: manage-qwen3-tts.sh [--dry-run|--prepare-apply|--apply|--apply-plist-only|--status|--uninstall] [--engine mlx|mps]' >&2; exit 2 ;;
  esac
  shift
done
[[ "$engine" == mlx || "$engine" == mps ]] || { echo 'unsupported TTS engine' >&2; exit 2; }
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 host required' >&2; exit 1; }
if [[ "$mode" == --status ]]; then
  ((explicit_engine == 0)) || { echo '--status does not select an engine' >&2; exit 2; }
  if [[ -f "$PLIST" ]]; then
    current="$(plutil -extract EnvironmentVariables.AMADEUS_TTS_ENGINE raw "$PLIST" 2>/dev/null || printf mps)"
    printf 'ENGINE=%s\n' "$current"
  fi
  launchctl print "$TARGET/$LABEL" 2>/dev/null | grep -E 'state =|pid =|last exit code =' || true
  /usr/bin/curl -s -o /dev/null -w 'HEALTH_HTTP=%{http_code}\n' --max-time 2 http://127.0.0.1:18792/healthz || true
  exit 0
fi
printf 'MODE=%s\nENGINE=%s\nSERVICE=%s\nPROFILE=%s\nPLIST=%s\n' "$mode" "$engine" "$BASE" "$VOICE" "$PLIST"
[[ "$mode" == --dry-run ]] && exit 0
if [[ "$mode" == --uninstall ]]; then
  ((explicit_engine == 0)) || { echo '--uninstall does not select an engine' >&2; exit 2; }
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  rm -f -- "$PLIST" # preserve protected voice, token, model and both venvs
  exit 0
fi
mkdir -p "$BASE" "$LOG" "$(dirname "$PLIST")"
if [[ "$mode" == --prepare-apply ]]; then
  if [[ "$engine" == mlx ]]; then
    "$ROOT/scripts/prepare-mlx-tts-poc.sh" --apply
  else
    [[ -x "$BASE/venv/bin/python" ]] || python3 -m venv "$BASE/venv"
    "$BASE/venv/bin/python" -m pip install -r "$ROOT/apps/qwen3-tts-service/requirements.txt"
    HF_HOME="$BASE/model-cache" "$BASE/venv/bin/python" - "$BASE/model" <<'PYMODEL'
from huggingface_hub import snapshot_download
import sys
snapshot_download(repo_id='Qwen/Qwen3-TTS-12Hz-1.7B-Base',
                  revision='fd4b254389122332181a7c3db7f27e918eec64e3', local_dir=sys.argv[1])
print('PINNED_MPS_MODEL=ready')
PYMODEL
  fi
  if [[ ! -s "$BASE/tts.token" ]]; then
    python3 - "$BASE/tts.token" <<'PYTOKEN'
from pathlib import Path
import secrets, sys
p=Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True)
with p.open('x',encoding='utf-8') as stream:stream.write(secrets.token_urlsafe(48)+'\n')
p.chmod(0o600)
print('TTS_TOKEN=created (value suppressed)')
PYTOKEN
  fi
  exit 0
fi
[[ -s "$VOICE/reference.wav" && -s "$VOICE/reference.txt" ]] || { echo 'operator-owned A profile missing' >&2; exit 1; }
[[ "$(stat -f %Lp "$VOICE/reference.wav")" == 600 && "$(stat -f %Lp "$VOICE/reference.txt")" == 600 ]] || { echo 'reference pair must have mode 600' >&2; exit 1; }
[[ -s "$BASE/tts.token" && "$(stat -f %Lp "$BASE/tts.token")" == 600 ]] || { echo 'protected TTS token missing' >&2; exit 1; }
python3 - "$BASE/tts.token" <<'PYTOKEN_CHECK'
from pathlib import Path
import sys
if len(Path(sys.argv[1]).read_text().strip()) < 32: raise SystemExit('protected TTS token length invalid')
PYTOKEN_CHECK
if [[ "$engine" == mlx ]]; then
  python3 "$ROOT/infra/macos/verify-qwen3-mlx-assets.py" --root "$MLX_ROOT" --config "$CONFIG"
  [[ -x "$MLX_ROOT/venv/bin/python" ]] || { echo 'prepared MLX venv missing' >&2; exit 1; }
else
  [[ -s "$BASE/model/config.json" && -x "$BASE/venv/bin/python" ]] || { echo 'prepared MPS model/venv missing' >&2; exit 1; }
fi
if [[ "$mode" == --apply ]]; then
  if [[ "$engine" == mps ]]; then
    "$BASE/venv/bin/python" -m pip install -r "$ROOT/apps/qwen3-tts-service/requirements.txt"
  fi
  install -m 600 "$ROOT/apps/qwen3-tts-service/service.py" "$BASE/service.py"
  install -m 600 "$ROOT/apps/qwen3-tts-service/mlx_engine.py" "$BASE/mlx_engine.py"
  install -m 600 "$ROOT/apps/qwen3-tts-service/engine_contract.py" "$BASE/engine_contract.py"
  install -m 600 "$ROOT/apps/qwen3-tts-service/requirements.txt" "$BASE/requirements.txt"
fi
[[ -s "$BASE/service.py" && -s "$BASE/mlx_engine.py" && -s "$BASE/engine_contract.py" ]] || { echo 'service source missing; use --apply' >&2; exit 1; }
temporary="$(mktemp "$PLIST.tmp.XXXXXX")"
trap 'rm -f "$temporary"' EXIT
python3 "$ROOT/infra/macos/render-qwen3-tts-plist.py" \
  --template "$ROOT/infra/macos/com.amadeus.qwen3-tts.plist.example" \
  --output "$temporary" --base "$BASE" --voice "$VOICE" --log "$LOG" \
  --mlx-root "$MLX_ROOT" --engine "$engine"
plutil -lint "$temporary"
install -m 600 "$temporary" "$PLIST"
trap - EXIT
rm -f "$temporary"
launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
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
echo 'QWEN3_TTS=installed (health readiness requires real model warmup)'
