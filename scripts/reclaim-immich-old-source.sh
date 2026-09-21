#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
STATE_FILE="${IMMICH_MIGRATION_STATE_DIR:-${SKULD_BACKUP_ROOT:-/Volumes/Avalon/backups/operation-skuld/immich-migration}}/state.json"
APPLY=0
APPROVAL=''

usage() {
  printf '%s\n' 'Usage: scripts/reclaim-immich-old-source.sh --plan [--state PATH]'
  printf '%s\n' '       scripts/reclaim-immich-old-source.sh --apply --approval-token RECLAIM_IMMICH_SOURCE_1_4_5 [--state PATH]'
}
while (($#)); do
  case "$1" in
    --plan) ;;
    --apply) APPLY=1 ;;
    --approval-token) shift; APPROVAL="${1:?--approval-token requires a value}" ;;
    --state) shift; STATE_FILE="${1:?--state requires a path}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
[[ -f "$STATE_FILE" ]] || { printf 'BLOCKER  migration state is missing: %s\n' "$STATE_FILE" >&2; exit 1; }

python3 - "$STATE_FILE" "$APPLY" "$APPROVAL" "$MACHINE" "$ROOT_DIR" <<'PY'
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

state_path, apply_flag, approval, machine, root = sys.argv[1:]
state_path = Path(state_path)
state = json.loads(state_path.read_text())
source = Path(str(state.get('source', '')).strip())
destination = Path(str(state.get('destination', '')).strip())
backup_root = Path(os.environ.get('SKULD_BACKUP_ROOT', str(state_path.parent.parent)))
if state.get('sourceReclaimPending') is not True or state.get('sourceRetained') is not True:
    raise SystemExit('source reclaim is already complete or not pending')
if not source or not destination or source == destination:
    raise SystemExit('source and destination are ambiguous')
if os.path.realpath(source) == os.path.realpath(destination) or os.path.realpath(destination).startswith(os.path.realpath(source) + os.sep):
    raise SystemExit('refusing to reclaim a path that contains the live destination')

# Read-only one-way equivalence: every source file must exist at destination with equal size/content.
def local_equivalence(src: Path, dst: Path) -> dict:
    checked = 0
    bytes_checked = 0
    for path in src.rglob('*'):
        if not path.is_file():
            continue
        relative = path.relative_to(src)
        target = dst / relative
        if not target.is_file():
            raise SystemExit(f'fresh equivalence missing destination file: {relative}')
        if path.stat().st_size != target.stat().st_size:
            raise SystemExit(f'fresh equivalence size mismatch: {relative}')
        left = hashlib.sha256(path.read_bytes()).digest()
        right = hashlib.sha256(target.read_bytes()).digest()
        if left != right:
            raise SystemExit(f'fresh equivalence checksum mismatch: {relative}')
        checked += 1
        bytes_checked += path.stat().st_size
    return {'files': checked, 'bytes': bytes_checked}

def remote_equivalence(src: str, dst: str) -> dict:
    # No --delete: destination-only files are explicitly allowed. rsync is only a dry-run verifier.
    command = ['orb', '-m', machine, '-u', 'root', 'rsync', '-a', '--checksum', '--dry-run', '--itemize-changes', src.rstrip('/') + '/', dst.rstrip('/') + '/']
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        raise SystemExit('fresh one-way rsync equivalence failed')
    files = 0
    for line in result.stdout.splitlines():
        if line and not line.startswith('sending ') and not line.startswith('sent ') and not line.startswith('total '): files += 1
    return {'filesReported': files, 'mode': 'rsync-checksum-dry-run-no-delete'}

if machine == 'fixture':
    if not source.is_dir() or source.is_symlink() or not destination.is_dir():
        raise SystemExit('fixture source/destination directories are invalid')
    equivalence = local_equivalence(source, destination)
else:
    probe = subprocess.run(['orb', '-m', machine, '-u', 'root', 'bash', '-lc', 'test -d "$1" && test ! -L "$1"', '--', str(source)], check=False)
    if probe.returncode != 0:
        raise SystemExit('old source is not a regular guest directory')
    live_mount = subprocess.check_output(['orb', '-m', machine, '-u', 'root', 'docker', 'inspect', '--format', '{{range .Mounts}}{{if eq .Destination "/usr/src/app/upload"}}{{.Source}}{{end}}{{end}}', 'immich-server'], text=True).strip()
    if os.path.realpath(live_mount) != os.path.realpath(str(destination)):
        raise SystemExit('live Immich mount is not the configured destination')
    health = subprocess.run(['orb', '-m', machine, '-u', 'root', 'curl', '--fail', '--silent', '--max-time', '10', 'http://127.0.0.1:2283/api/server/ping'], check=False)
    if health.returncode != 0:
        raise SystemExit('Immich health check failed before reclaim gate')
    equivalence = remote_equivalence(str(source), str(destination))

# A fresh logical database backup is mandatory immediately before any future apply.
gate_dir = backup_root / 'immich-migration' / ('reclaim-gate-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
gate_dir.mkdir(parents=True, exist_ok=True)
db_dump = gate_dir / 'immich-postgres.dump'
if machine == 'fixture':
    prior = Path(str(state.get('dbBackupPath', '')))
    if not prior.is_file():
        raise SystemExit('fixture fresh database backup is not present')
    shutil.copy2(prior, db_dump)
else:
    with db_dump.open('wb') as handle:
        command = ['orb', '-m', machine, '-u', 'root', 'docker', 'exec', 'immich-postgres', 'sh', '-lc', 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
        result = subprocess.run(command, stdout=handle, stderr=subprocess.PIPE, check=False)
        if result.returncode != 0:
            raise SystemExit('fresh Immich pg_dump failed')
subprocess.run(['pg_restore', '--list', str(db_dump)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
checksum = hashlib.sha256(db_dump.read_bytes()).hexdigest()
(db_dump.with_suffix('.dump.sha256')).write_text(f'{checksum}  {db_dump}\n')

evidence = gate_dir / 'fresh-reclaim-gate.json'
evidence.write_text(json.dumps({
    'schemaVersion': 1,
    'verifiedAt': datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
    'source': str(source),
    'destination': str(destination),
    'oneWayEquivalence': equivalence,
    'destinationOnlyFilesAllowed': True,
    'syncMode': 'checksum-dry-run-no-delete',
    'dbBackupPath': str(db_dump),
    'dbBackupSha256': checksum,
    'sourceRetained': True,
}, indent=2) + '\n')
evidence.chmod(0o600)
state['freshEquivalenceStatus'] = 'passed'
state['freshEquivalenceVerifiedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
state['freshReclaimEvidencePath'] = str(evidence)
state['freshDbBackupPath'] = str(db_dump)
state['dbBackupPath'] = str(db_dump)
state['sourceReclaimState'] = 'SOURCE_RECLAIM_READY'
state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
state_path.chmod(0o600)
print(f'SOURCE_RECLAIM_CANDIDATE={source}')
print('FRESH_ONE_WAY_EQUIVALENCE=passed')
print(f'FRESH_IMMICH_PG_DUMP={db_dump}')
print('SOURCE_RECLAIM_STATE=SOURCE_RECLAIM_READY')
if apply_flag != '1':
    print('SOURCE_RECLAIM_PENDING=yes')
    raise SystemExit(0)
if approval != 'RECLAIM_IMMICH_SOURCE_1_4_5':
    raise SystemExit('explicit source-reclaim approval token is required')
if machine == 'fixture':
    shutil.rmtree(source)
else:
    subprocess.run(['orb', '-m', machine, '-u', 'root', 'test', '-r', str(destination)], check=True)
    subprocess.run(['orb', '-m', machine, '-u', 'root', 'rm', '-r', '--', str(source)], check=True)
state['sourceReclaimPending'] = False
state['sourceRetained'] = False
state['sourceReclaimState'] = 'SOURCE_RECLAIMED'
state['phase'] = 'source-reclaimed'
state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
print('SOURCE_RECLAIM=completed')
PY
