#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"
MODE=dry-run
case "${1:---dry-run}" in --dry-run) ;; --apply) MODE=apply ;; *) echo 'Usage: backup-qwen3-tts-profile.sh [--dry-run|--apply]' >&2; exit 2;; esac
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 required' >&2; exit 1; }
PROFILE="$HOME/Library/Application Support/Amadeus/voices/kurisu-v1"
TOKEN="$HOME/Library/Application Support/Amadeus/speech/tts.token"
ROOT_BACKUP="${SKULD_BACKUP_ROOT:-/Volumes/Avalon/backups/operation-skuld}/voice-1.5.3"
printf 'MODE=%s\nPROFILE=%s\nBACKUP_ROOT=%s\n' "$MODE" "$PROFILE" "$ROOT_BACKUP"
if [[ "$MODE" == dry-run ]]; then exit 0; fi
python3 - "$PROFILE" "$TOKEN" "$ROOT_BACKUP" "$(git -C "$ROOT" rev-parse HEAD)" <<'PY'
from datetime import datetime,timezone
from pathlib import Path
import hashlib,json,shutil,sys
profile,token,root=map(Path,sys.argv[1:4]); commit=sys.argv[4]
files=[profile/'reference.wav',profile/'reference.txt',token]
for f in files:
    if not f.is_file() or f.is_symlink() or not f.stat().st_size or f.stat().st_mode & 0o077:
        raise SystemExit('protected profile/token preflight failed: '+f.name)
root.mkdir(parents=True,exist_ok=True,mode=0o700)
if root.stat().st_mode & 0o077: raise SystemExit('backup root is not private')
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
out=root/('profile-'+stamp)
out.mkdir(mode=0o700,exist_ok=False)
for f in files:
    dest=out/f.name; shutil.copyfile(f,dest); dest.chmod(0o600)
manifest={'repoCommit':commit,'model':'Qwen/Qwen3-TTS-12Hz-1.7B-Base','launchdBefore':'present' if (Path.home()/'Library/LaunchAgents/com.amadeus.qwen3-tts.plist').exists() else 'absent',
          'files':{f.name:{'bytes':(out/f.name).stat().st_size,'sha256':hashlib.sha256((out/f.name).read_bytes()).hexdigest()} for f in files}}
m=out/'manifest.json';m.write_text(json.dumps(manifest,indent=2)+'\n');m.chmod(0o600)
print('PRIVATE_VOICE_BACKUP='+str(out))
print('BACKUP_FILES=reference.wav,reference.txt,tts.token (values suppressed)')
PY
