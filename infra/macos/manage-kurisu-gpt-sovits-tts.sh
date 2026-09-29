#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"

MODE=dry-run
case "${1:---dry-run}" in
  --dry-run) ;;
  --apply) MODE=apply ;;
  --status) MODE=status ;;
  --uninstall) MODE=uninstall ;;
  *) echo 'Usage: manage-kurisu-gpt-sovits-tts.sh [--dry-run|--apply|--status|--uninstall]' >&2; exit 2 ;;
esac

[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 required' >&2; exit 1; }

TARGET="gui/$(id -u)"
LABEL_API=com.amadeus.kurisu-gpt-sovits-api
LABEL_TTS=com.amadeus.kurisu-gpt-sovits-tts
POC_ROOT="$HOME/Library/Application Support/Amadeus/kurisu-gpt-sovits-poc"
GPT_ROOT="$POC_ROOT/GPT-SoVITS"
PYTHON="$POC_ROOT/venv/bin/python"
API_SCRIPT="$GPT_ROOT/api_v2.py"
CONFIG="$POC_ROOT/config/tts-infer-mps.yaml"
NLTK_DATA="$POC_ROOT/venv/nltk_data"
REFERENCE_AUDIO="$POC_ROOT/models/TTS-KurisuMakise/WAV/crs_0695.WAV_0000000000_0000224000.wav"
ADAPTER_SCRIPT="$ROOT/scripts/kurisu-gpt-sovits-production-adapter.py"
TOKEN_DIR="$HOME/Library/Application Support/Amadeus/speech"
TOKEN_FILE="$TOKEN_DIR/gpt-sovits-tts.token"
LOG_DIR="$HOME/Library/Logs/Amadeus"
PLIST_DIR="$HOME/Library/LaunchAgents"
API_PLIST="$PLIST_DIR/$LABEL_API.plist"
TTS_PLIST="$PLIST_DIR/$LABEL_TTS.plist"
REMOTE_TOKEN="/DATA/AppData/9router/secrets/tts-local-key"

printf 'MODE=%s\nPOC_ROOT=%s\nAPI_PORT=19870\nADAPTER_PORT=19871\nTOKEN_FILE=%s\n' "$MODE" "$POC_ROOT" "$TOKEN_FILE"

launchd_loaded() { launchctl print "$TARGET/$1" >/dev/null 2>&1; }

stop_label() {
  local label="$1"
  launchctl bootout "$TARGET/$label" 2>/dev/null || true
  for _ in $(seq 1 30); do
    launchd_loaded "$label" || return 0
    sleep 1
  done
  echo "LaunchAgent did not stop: $label" >&2
  return 1
}

wait_http() {
  local url="$1" expected="$2"
  for _ in $(seq 1 60); do
    local code
    code="$(curl -sS --max-time 3 -o /tmp/kurisu-gpt-sovits-health.$$ -w '%{http_code}' "$url" || true)"
    if [[ "$code" == "$expected" ]]; then return 0; fi
    sleep 2
  done
  return 1
}

if [[ "$MODE" == status ]]; then
  for label in "$LABEL_API" "$LABEL_TTS"; do
    if launchd_loaded "$label"; then echo "$label=loaded"; else echo "$label=not_loaded"; fi
  done
  printf 'API_HEALTH_HTTP='; curl -sS --max-time 3 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:19870/openapi.json || true
  printf 'ADAPTER_HEALTH='; curl -sS --max-time 3 http://127.0.0.1:19871/healthz || true; printf '\n'
  exit 0
fi

if [[ "$MODE" == uninstall ]]; then
  stop_label "$LABEL_TTS"
  stop_label "$LABEL_API"
  echo 'KURISU_GPT_SOVITS=uninstalled (runtime, model and token retained)'
  exit 0
fi

[[ -x "$PYTHON" && -s "$API_SCRIPT" && -s "$CONFIG" && -s "$REFERENCE_AUDIO" && -s "$ADAPTER_SCRIPT" ]] || { echo 'GPT-SoVITS PoC runtime or adapter missing' >&2; exit 1; }
[[ -x /opt/homebrew/bin/ffmpeg ]] || { echo 'ffmpeg missing at /opt/homebrew/bin/ffmpeg' >&2; exit 1; }
[[ -e "$NLTK_DATA/corpora/cmudict" && -e "$NLTK_DATA/taggers/averaged_perceptron_tagger_eng" ]] || { echo 'GPT-SoVITS NLTK runtime data missing' >&2; exit 1; }

if [[ "$MODE" == dry-run ]]; then
  echo 'ACTION=install LaunchAgents for GPT-SoVITS API and authenticated adapter'
  echo 'ACTION=preserve existing MPS runtime and external model/reference assets'
  echo 'ACTION=fetch tts-local-key from protected 9Router secret only during --apply'
  exit 0
fi

umask 077
install -d -m 700 "$TOKEN_DIR" "$LOG_DIR" "$PLIST_DIR"
if [[ ! -s "$TOKEN_FILE" ]]; then
  tmp="$TOKEN_FILE.tmp.$$"
  orb -m "$ORBSTACK_MACHINE" -u root cat "$REMOTE_TOKEN" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$TOKEN_FILE"
fi
python3 - "$TOKEN_FILE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
st=p.stat()
if not st.st_size or st.st_mode & 0o077:
    raise SystemExit('local GPT-SoVITS token is missing or not private')
PY

render() {
  local template="$1" output="$2"
  python3 - "$template" "$output" "$PYTHON" "$API_SCRIPT" "$CONFIG" "$GPT_ROOT" "$POC_ROOT" "$TOKEN_FILE" "$REFERENCE_AUDIO" "$ADAPTER_SCRIPT" "$LOG_DIR" "$HOME/Library/Caches/huggingface" "/opt/homebrew/bin/ffmpeg" <<'PY'
from pathlib import Path
import sys
template, output, python, api, config, gpt_root, poc_root, token, reference, adapter, log_dir, model_cache, ffmpeg = map(Path, sys.argv[1:])
text=Path(template).read_text()
values={'__PYTHON__':python, '__API_SCRIPT__':api, '__CONFIG__':config, '__GPT_ROOT__':gpt_root,
        '__POC_ROOT__':poc_root, '__TOKEN_FILE__':token, '__REFERENCE_AUDIO__':reference,
        '__ADAPTER_SCRIPT__':adapter, '__LOG_DIR__':log_dir, '__MODEL_CACHE__':model_cache, '__FFMPEG__':ffmpeg}
for marker, value in values.items():
    text=text.replace(marker, str(value))
if '__' in text:
    raise SystemExit('unrendered plist marker')
Path(output).write_text(text)
PY
  chmod 600 "$output"
  plutil -lint "$output" >/dev/null
}

render "$ROOT/infra/macos/com.amadeus.kurisu-gpt-sovits-api.plist.example" "$API_PLIST"
render "$ROOT/infra/macos/com.amadeus.kurisu-gpt-sovits-tts.plist.example" "$TTS_PLIST"

# Adopt only the known PoC process; refuse to kill an unrelated listener.
api_pid="$(lsof -nP -t -iTCP:19870 -sTCP:LISTEN | head -1 || true)"
if [[ -n "$api_pid" ]] && ! launchd_loaded "$LABEL_API"; then
  command_line="$(ps -p "$api_pid" -o command= || true)"
  [[ "$command_line" == *"$POC_ROOT"* && "$command_line" == *"api_v2.py"* ]] || { echo 'unexpected listener on 19870; refusing takeover' >&2; exit 1; }
  kill "$api_pid"
  for _ in $(seq 1 30); do kill -0 "$api_pid" 2>/dev/null || break; sleep 1; done
  kill -0 "$api_pid" 2>/dev/null && { echo 'existing PoC API did not stop' >&2; exit 1; }
fi
stop_label "$LABEL_TTS"
stop_label "$LABEL_API"
launchctl bootstrap "$TARGET" "$API_PLIST"
launchctl enable "$TARGET/$LABEL_API"
wait_http http://127.0.0.1:19870/openapi.json 200 || { echo 'GPT-SoVITS API did not become healthy' >&2; exit 1; }
launchctl bootstrap "$TARGET" "$TTS_PLIST"
launchctl enable "$TARGET/$LABEL_TTS"
wait_http http://127.0.0.1:19871/healthz 200 || { echo 'GPT-SoVITS adapter did not become ready' >&2; exit 1; }
echo 'KURISU_GPT_SOVITS=ready (API 19870, adapter 19871; values suppressed)'
