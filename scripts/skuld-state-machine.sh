#!/usr/bin/env bash
# scripts/skuld-state-machine.sh
# Amadeus 1.4.6 — Operation Skuld phase state machine.
# Tracks source-side preparation phases (0-10) and validates gate transitions.
# Phases 11+ (destination side / cutover) are not authorized by this goal.
#
# Usage:
#   scripts/skuld-state-machine.sh --status
#   scripts/skuld-state-machine.sh --advance PHASE_N [--note "evidence note"]
#   scripts/skuld-state-machine.sh --reset
#   scripts/skuld-state-machine.sh --validate
#
# State file is external (not in Git): SKULD_STATE_MACHINE_FILE or
#   ${SKULD_BACKUP_ROOT}/skuld-phase-state.json
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

SKULD_STATE_MACHINE_FILE="${SKULD_STATE_MACHINE_FILE:-${SKULD_BACKUP_ROOT}/skuld-phase-state.json}"
MODE=''
ADVANCE_PHASE=''
NOTE=''

usage() {
  printf '%s\n' \
    'Usage: scripts/skuld-state-machine.sh --status' \
    '       scripts/skuld-state-machine.sh --advance PHASE_N [--note "evidence note"]' \
    '       scripts/skuld-state-machine.sh --reset' \
    '       scripts/skuld-state-machine.sh --validate'
}

while (($#)); do
  case "$1" in
    --status) MODE=status ;;
    --advance) shift; MODE=advance; ADVANCE_PHASE="${1:?--advance requires a phase name}" ;;
    --reset) MODE=reset ;;
    --validate) MODE=validate ;;
    --note) shift; NOTE="${1:?--note requires a value}" ;;
    --state-file) shift; SKULD_STATE_MACHINE_FILE="${1:?--state-file requires a path}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ -n "$MODE" ]] || { usage >&2; exit 2; }

python3 - "$SKULD_STATE_MACHINE_FILE" "$MODE" "$ADVANCE_PHASE" "$NOTE" << 'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

state_file, mode, advance_phase, note = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]

# Phase definitions — source-side only (0-10).
# Phases 11+ are destination-side (NOT authorized by 1.4.6 goal).
PHASES = {
    'SKULD_PHASE_0': {
        'description': 'Source-side preparation complete (1.4.5 readiness)',
        'requires': [],
        'gate': 'OPERATION_SKULD=READY from migration-readiness.sh (1.4.5)',
    },
    'SKULD_PHASE_1': {
        'description': '1.4.6 audit fixes and tooling complete',
        'requires': ['SKULD_PHASE_0'],
        'gate': 'VERSION=1.4.6 released; Immich checksum fix, storage telemetry fix, preparation tooling present',
    },
    'SKULD_PHASE_2': {
        'description': 'Full HomeLab backup rehearsal passed',
        'requires': ['SKULD_PHASE_1'],
        'gate': 'All MIGRATE services have backup artifacts; service-aware manifest updated',
    },
    'SKULD_PHASE_3': {
        'description': 'Sensitive-state bundle rehearsal passed',
        'requires': ['SKULD_PHASE_2'],
        'gate': 'All live service secrets have encrypted-bundle coverage; import rehearsal passed',
    },
    'SKULD_PHASE_4': {
        'description': 'Destination capacity plan passed',
        'requires': ['SKULD_PHASE_3'],
        'gate': 'plan-destination-capacity.sh reports fit or acknowledged-warning for 512 GB SSD',
    },
    'SKULD_PHASE_5': {
        'description': 'Destination bootstrap plan ready',
        'requires': ['SKULD_PHASE_4'],
        'gate': 'plan-destination-bootstrap.sh produces DESTINATION_BOOTSTRAP_PLAN=ready',
    },
    'SKULD_PHASE_6': {
        'description': 'Clean guest creation plan ready',
        'requires': ['SKULD_PHASE_5'],
        'gate': 'plan-clean-orbstack-guest.sh produces CLEAN_GUEST_CREATION_PLAN=ready',
    },
    'SKULD_PHASE_7': {
        'description': 'HomeLab clean-restore plan ready',
        'requires': ['SKULD_PHASE_6'],
        'gate': 'plan-homelab-clean-restore.sh produces HOMELAB_CLEAN_RESTORE_PLAN=ready',
    },
    'SKULD_PHASE_8': {
        'description': 'Rollback plan ready',
        'requires': ['SKULD_PHASE_7'],
        'gate': 'plan-skuld-rollback.sh produces ROLLBACK_PLAN=ready',
    },
    'SKULD_PHASE_9': {
        'description': 'Safe pre-migration GC executed',
        'requires': ['SKULD_PHASE_8'],
        'gate': 'scripts/pre-migration-gc.sh --apply completed; storage-maintenance evidence recorded',
    },
    'SKULD_PHASE_10': {
        'description': 'Source-side final readiness',
        'requires': ['SKULD_PHASE_9'],
        'gate': 'migration-readiness.sh OPERATION_SKULD=READY; all 1.4.6 gates pass',
    },
}
PHASE_ORDER = list(PHASES.keys())

CUTOVER_PHASES = {
    'SKULD_PHASE_11': 'Destination bootstrap executed',
    'SKULD_PHASE_12': 'Destination data restore completed',
    'SKULD_PHASE_13': 'Destination preflight passed',
    'SKULD_PHASE_14': 'Cutover window active',
    'SKULD_PHASE_15': 'Cutover validated and complete',
}

def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def load_state() -> dict:
    if not state_file.exists():
        return {
            'schemaVersion': 1,
            'operation': 'operation-skuld',
            'currentPhase': None,
            'completedPhases': [],
            'history': [],
            'cutoverAuthorizationRequired': True,
            'destinationIdentity': {
                'hostname': 'Amadeus-M204',
                'macosUser': 'nyannyan',
                'orbstackMachine': 'nyannyan',
                'linuxUser': 'nyannyan',
            },
        }
    return json.loads(state_file.read_text())

def save_state(state: dict) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state, indent=2, ensure_ascii=False) + '\n')
    state_file.chmod(0o600)

def print_status(state: dict) -> None:
    current = state.get('currentPhase')
    completed = state.get('completedPhases', [])
    print(f'SKULD_CURRENT_PHASE={current or "none"}')
    if current and current in PHASES:
        print(f'SKULD_PHASE_DESCRIPTION={PHASES[current]["description"]}')
    print(f'SKULD_COMPLETED_PHASES={",".join(completed) if completed else "none"}')
    next_phase = None
    for ph in PHASE_ORDER:
        if ph not in completed:
            next_phase = ph
            break
    if next_phase:
        print(f'SKULD_NEXT_PHASE={next_phase}')
        print(f'SKULD_NEXT_DESCRIPTION={PHASES[next_phase]["description"]}')
        print(f'SKULD_NEXT_GATE={PHASES[next_phase]["gate"]}')
    else:
        print('SKULD_NEXT_PHASE=none (all source-side phases complete)')
    cutover_locked = state.get('cutoverAuthorizationRequired', True)
    print(f'SKULD_CUTOVER_LOCKED={cutover_locked}')
    dest = state.get('destinationIdentity', {})
    print(f'SKULD_DESTINATION_HOST={dest.get("hostname","unknown")}')
    print(f'SKULD_DESTINATION_MACHINE={dest.get("orbstackMachine","unknown")}')

def advance(state: dict, phase: str, note_text: str) -> None:
    if phase not in PHASES:
        if phase in CUTOVER_PHASES:
            raise SystemExit(
                f'Phase {phase} is a destination-side cutover phase and is not authorized in this goal.\n'
                f'MAC_MINI_CUTOVER=NOT_EXECUTED; DESTINATION_MUTATED=NO'
            )
        raise SystemExit(f'Unknown phase: {phase}')
    completed = state.get('completedPhases', [])
    if phase in completed:
        print(f'SKULD_PHASE={phase} (already completed)')
        return
    requirements = PHASES[phase]['requires']
    missing = [r for r in requirements if r not in completed]
    if missing:
        raise SystemExit(f'Cannot advance to {phase}: required phases not completed: {", ".join(missing)}')
    completed.append(phase)
    state['completedPhases'] = completed
    state['currentPhase'] = phase
    event = {
        'phase': phase,
        'description': PHASES[phase]['description'],
        'gate': PHASES[phase]['gate'],
        'advancedAt': now_utc(),
        'note': note_text or '',
    }
    state.setdefault('history', []).append(event)
    save_state(state)
    print(f'SKULD_PHASE={phase}')
    print(f'SKULD_PHASE_DESCRIPTION={PHASES[phase]["description"]}')
    print(f'SKULD_ADVANCED_AT={event["advancedAt"]}')

def do_reset(state: dict) -> None:
    state['currentPhase'] = None
    state['completedPhases'] = []
    state.setdefault('history', []).append({'reset': True, 'resetAt': now_utc()})
    save_state(state)
    print('SKULD_PHASE=none (reset)')

def do_validate(state: dict) -> None:
    completed = set(state.get('completedPhases', []))
    failures = 0
    for phase, info in PHASES.items():
        completed_flag = phase in completed
        reqs_met = all(r in completed for r in info['requires'])
        if completed_flag and not reqs_met:
            print(f'INVALID  {phase}: marked complete but prerequisites not met')
            failures += 1
        else:
            status = 'DONE' if completed_flag else 'PENDING'
            print(f'{status}    {phase}: {info["description"]}')
    current = state.get('currentPhase')
    print(f'SKULD_VALIDATE_FAILURES={failures}')
    if failures == 0:
        print('SKULD_STATE=valid')
    else:
        raise SystemExit(f'State validation failed with {failures} error(s)')

state = load_state()
if mode == 'status':
    print_status(state)
elif mode == 'advance':
    advance(state, advance_phase, note)
elif mode == 'reset':
    do_reset(state)
elif mode == 'validate':
    do_validate(state)
PY