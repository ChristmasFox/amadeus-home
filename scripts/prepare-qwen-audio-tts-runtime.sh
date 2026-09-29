#!/usr/bin/env bash
# Prepare the protected cloud-primary/local-fallback TTS secret set.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"
MODE=dry-run
REUSE_ASR_API_KEY=0
while (($#)); do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --reuse-asr-api-key) REUSE_ASR_API_KEY=1 ;;
    --help|-h) echo 'Usage: scripts/prepare-qwen-audio-tts-runtime.sh [--dry-run|--apply] [--reuse-asr-api-key]'; exit 0 ;;
    *) echo "Unexpected argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 required' >&2; exit 1; }
base="$HOME/Library/Application Support/Amadeus/speech"
bridge_host="$base/tts-bridge.token"
cloud_host="${AMADEUS_TTS_CLOUD_API_KEY_HOST_FILE:-$base/qwen-audio-tts.api-key}"
voice_host="${AMADEUS_TTS_CLOUD_VOICE_ID_HOST_FILE:-$base/qwen-audio-tts.voice-id}"
voice31_host="${AMADEUS_TTS_CLOUD_VOICE_ID_31_HOST_FILE:-$base/qwen-audio-tts-3.1.voice-id}"
local_host="${AMADEUS_TTS_LOCAL_KEY_HOST_FILE:-$base/tts.token}"
guest_base=/DATA/AppData/9router/secrets
printf 'MODE=%s\nCLOUD_KEY_HOST=%s\nVOICE_ID_31_HOST=%s\nVOICE_ID_30_HOST=%s\nLOCAL_KEY_HOST=%s\n' "$MODE" "$cloud_host" "$voice31_host" "$voice_host" "$local_host"
if [[ "$MODE" == dry-run ]]; then
  if [[ "$REUSE_ASR_API_KEY" == 1 ]]; then echo 'CLOUD_KEY_SOURCE=protected guest ASR upstream key'; fi
  echo 'PLAN=validate protected cloud key/voice id/local token; generate bridge key only when --apply; copy uid-1000 mode-0600 files without printing values'
  exit 0
fi
if [[ "$REUSE_ASR_API_KEY" == 1 ]]; then
  asr_guest=/DATA/AppData/9router/secrets/asr-upstream-api-key
  orb -m "$ORBSTACK_MACHINE" -u root python3 - "$asr_guest" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); st=p.lstat()
if p.is_symlink() or not p.is_file() or st.st_uid != 1000 or st.st_mode & 0o077 or not p.read_text().strip():
    raise SystemExit('protected guest ASR upstream key missing/unreadable')
print('GUEST_ASR_KEY_SOURCE=ready (value suppressed)')
PY
  mkdir -p -m 700 "$(dirname "$cloud_host")"
  if [[ -e "$cloud_host" ]]; then
    host_hash="$(shasum -a 256 "$cloud_host" | awk '{print $1}')"
    guest_hash="$(orb -m "$ORBSTACK_MACHINE" -u root sha256sum "$asr_guest" | awk '{print $1}')"
    [[ "$host_hash" == "$guest_hash" ]] || { echo 'host cloud key differs from protected guest ASR key' >&2; exit 1; }
  else
    temporary="$(mktemp "${cloud_host}.tmp.XXXXXX")"
    trap 'rm -f "$temporary"' EXIT
    orb -m "$ORBSTACK_MACHINE" -u root cat "$asr_guest" > "$temporary"
    chmod 600 "$temporary"
    mv "$temporary" "$cloud_host"
    trap - EXIT
  fi
fi
python3 - "$bridge_host" "$cloud_host" "$voice31_host" "$voice_host" "$local_host" <<'PY'
from pathlib import Path
import secrets,sys
bridge,cloud,voice31,voice30,local=map(Path,sys.argv[1:])
bridge.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
for name,p in (("cloud_api_key",cloud),("cloud_voice_id_31",voice31),("cloud_voice_id_30",voice30),("local_tts_key",local)):
    if not p.is_file() or p.is_symlink() or p.stat().st_mode & 0o077 or not p.read_text().strip():
        raise SystemExit(f'protected host {name} missing/unreadable')
if not bridge.exists():
    bridge.write_text(secrets.token_urlsafe(48)+'\n'); bridge.chmod(0o600)
if bridge.is_symlink() or not bridge.is_file() or bridge.stat().st_mode & 0o077 or not bridge.read_text().strip():
    raise SystemExit('protected host bridge missing/unreadable')
if len(bridge.read_text().strip()) < 32 or len(cloud.read_text().strip()) < 20 or len(voice31.read_text().strip()) < 8 or len(voice30.read_text().strip()) < 8 or len(local.read_text().strip()) < 32:
    raise SystemExit('protected host TTS secret length invalid')
print('HOST_TTS_SECRETS=ready (values suppressed)')
PY
orb -m "$ORBSTACK_MACHINE" -u root install -d -m 700 "$guest_base"
for pair in \
  "$bridge_host:$guest_base/tts-bridge-key" \
  "$cloud_host:$guest_base/tts-cloud-api-key" \
  "$voice31_host:$guest_base/tts-cloud-voice-id-31" \
  "$voice_host:$guest_base/tts-cloud-voice-id" \
  "$local_host:$guest_base/tts-local-key"; do
  host_file="${pair%%:*}"; guest_file="${pair#*:}"
  if orb -m "$ORBSTACK_MACHINE" -u root test -L "$guest_file"; then
    echo "TTS secret symlink refused: $guest_file" >&2
    exit 1
  fi
  if orb -m "$ORBSTACK_MACHINE" -u root test -e "$guest_file"; then
    host_hash="$(shasum -a 256 "$host_file" | awk '{print $1}')"
    guest_hash="$(orb -m "$ORBSTACK_MACHINE" -u root sha256sum "$guest_file" | awk '{print $1}')"
    [[ "$host_hash" == "$guest_hash" ]] || { echo "TTS secret drift; no overwrite: $guest_file" >&2; exit 1; }
  else
    orb -m "$ORBSTACK_MACHINE" -u root sh -c 'umask 077; cat > "$1" && chown 1000:1000 "$1" && chmod 600 "$1"' -- "$guest_file" < "$host_file"
  fi
done
orb -m "$ORBSTACK_MACHINE" -u root python3 - "$guest_base" <<'PY'
from pathlib import Path
import sys
base=Path(sys.argv[1])
for name in ('tts-bridge-key','tts-cloud-api-key','tts-cloud-voice-id-31','tts-cloud-voice-id','tts-local-key'):
    p=base/name; st=p.stat()
    if p.is_symlink() or not p.is_file() or st.st_uid != 1000 or st.st_mode & 0o077 or not st.st_size:
        raise SystemExit('guest TTS secret ownership/mode invalid: '+name)
print('GUEST_TTS_SECRETS=ready (uid 1000, mode 0600; values suppressed)')
PY
