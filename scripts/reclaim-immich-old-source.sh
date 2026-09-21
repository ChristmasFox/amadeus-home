#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
STATE_FILE="${IMMICH_MIGRATION_STATE_DIR:-${SKULD_BACKUP_ROOT:-/Volumes/Avalon/backups/operation-skuld/immich-migration}}/state.json"
APPLY=0
APPROVAL=''

usage() {
  printf '%s\n' 'Usage: scripts/reclaim-immich-old-source.sh --plan [--state PATH]'
  printf '%s\n' '       scripts/reclaim-immich-old-source.sh --apply --approval-token RECLAIM_IMMICH_SOURCE_1_4_4 [--state PATH]'
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
python3 - "$STATE_FILE" "$APPLY" "$APPROVAL" "$MACHINE" <<'PY'
import json
import os
import subprocess
import sys
from pathlib import Path

state_path, apply_flag, approval, machine = sys.argv[1:]
state = json.loads(Path(state_path).read_text())
source = str(state.get('source', '')).strip()
destination = str(state.get('destination', '')).strip()
if state.get('equivalenceStatus') != 'passed' or state.get('sourceRetained') is not True:
    raise SystemExit('reclaim requires a passed retained-source equivalence checkpoint')
if state.get('sourceReclaimPending') is not True:
    raise SystemExit('source reclaim is already complete or not pending')
if not source or not destination or source == destination:
    raise SystemExit('source and destination are ambiguous')
if os.path.realpath(source) == os.path.realpath(destination) or os.path.realpath(destination).startswith(os.path.realpath(source) + os.sep):
    raise SystemExit('refusing to reclaim a path that contains the live destination')
if machine == 'fixture':
    if not os.path.isdir(source) or os.path.islink(source):
        raise SystemExit('old source is not a regular directory')
else:
    probe = subprocess.run(['orb', '-m', machine, '-u', 'root', 'bash', '-lc', 'test -d "$1" && test ! -L "$1"', '--', source], check=False)
    if probe.returncode != 0:
        raise SystemExit('old source is not a regular guest directory')
if not Path(state.get('dbBackupPath', '')).is_file():
    raise SystemExit('fresh database backup is not present')
print(f'SOURCE_RECLAIM_CANDIDATE={source}')
print(f'RECLAIMABLE_BYTES={state.get("reclaimableBytes", 0)}')
if apply_flag != '1':
    print('SOURCE_RECLAIM_PENDING=yes')
    raise SystemExit(0)
if approval != 'RECLAIM_IMMICH_SOURCE_1_4_4':
    raise SystemExit('explicit source-reclaim approval token is required')
if machine != 'fixture':
    inspect = subprocess.check_output(['orb', '-m', machine, '-u', 'root', 'docker', 'inspect', '--format', '{{range .Mounts}}{{if eq .Destination "/usr/src/app/upload"}}{{.Source}}{{end}}{{end}}', 'immich-server'], text=True).strip()
    if inspect == source:
        raise SystemExit('old source is still the live Immich mount')
    subprocess.run(['orb', '-m', machine, '-u', 'root', 'test', '-r', destination], check=True)
    subprocess.run(['orb', '-m', machine, '-u', 'root', 'rm', '-r', '--', source], check=True)
else:
    if machine == 'fixture':
        import shutil
        shutil.rmtree(source)
    else:
        subprocess.run(['orb', '-m', machine, '-u', 'root', 'rm', '-r', '--', source], check=True)
state['sourceReclaimPending'] = False
state['sourceRetained'] = False
state['phase'] = 'source-reclaimed'
Path(state_path).write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
print('SOURCE_RECLAIM=completed')
PY
