#!/usr/bin/env bash
# Generate the local ASR bridge Bearer token outside Git; never print its value.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"
MODE=dry-run
while (($#)); do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --help|-h) echo 'Usage: scripts/prepare-9router-speech-secrets.sh [--dry-run|--apply]'; exit 0 ;;
    *) echo "Unexpected argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 required' >&2; exit 1; }
host_file="$HOME/Library/Application Support/Amadeus/speech/asr-bridge.token"
guest_file=/DATA/AppData/9router/secrets/asr-bridge-key
printf 'MODE=%s\nHOST_TOKEN_FILE=%s\nGUEST_TOKEN_FILE=%s\n' "$MODE" "$host_file" "$guest_file"
if [[ "$MODE" == dry-run ]]; then exit 0; fi
python3 - "$host_file" <<'PY'
from pathlib import Path
import secrets,sys
p=Path(sys.argv[1]); p.parent.mkdir(parents=True,exist_ok=True)
if not p.exists():
    with p.open('x') as f: f.write(secrets.token_urlsafe(48)+'\n')
    p.chmod(0o600)
if not p.is_file() or p.stat().st_mode & 0o077 or len(p.read_text().strip()) < 32:
    raise SystemExit('protected host token invalid')
print('HOST_TOKEN=ready (value suppressed)')
PY
# Only create the guest file if absent. If already present, reject drift rather
# than silently rotating a live 9Router connection's credential.
if orb -m "$ORBSTACK_MACHINE" -u root test -e "$guest_file"; then
  host_hash="$(shasum -a 256 "$host_file" | awk '{print $1}')"
  guest_hash="$(orb -m "$ORBSTACK_MACHINE" -u root sha256sum "$guest_file" | awk '{print $1}')"
  [[ "$host_hash" == "$guest_hash" ]] || { echo 'bridge token drift; no overwrite' >&2; exit 1; }
else
  orb -m "$ORBSTACK_MACHINE" -u root install -d -m 700 /DATA/AppData/9router/secrets
  orb -m "$ORBSTACK_MACHINE" -u root sh -c 'umask 077; cat > /DATA/AppData/9router/secrets/asr-bridge-key && chown 1000:1000 /DATA/AppData/9router/secrets/asr-bridge-key && chmod 600 /DATA/AppData/9router/secrets/asr-bridge-key' < "$host_file"
fi
orb -m "$ORBSTACK_MACHINE" -u root python3 - "$guest_file" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); st=p.stat()
if not p.is_file() or not st.st_size or st.st_uid!=1000 or st.st_mode & 0o077:
    raise SystemExit('guest bridge token ownership/mode invalid')
print('GUEST_TOKEN=ready (uid 1000, mode 0600; value suppressed)')
PY
