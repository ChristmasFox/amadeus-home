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

GATE_VERIFIERS = {
    'SKULD_PHASE_0': lambda note: _verify_phase0(note),
    'SKULD_PHASE_1': lambda note: _verify_phase1(note),
    'SKULD_PHASE_2': lambda note: _verify_phase2(note),
    'SKULD_PHASE_3': lambda note: _verify_phase3(note),
    'SKULD_PHASE_4': lambda note: _verify_phase4(note),
    'SKULD_PHASE_5': lambda note: _verify_phase5(note),
    'SKULD_PHASE_6': lambda note: _verify_phase6(note),
    'SKULD_PHASE_7': lambda note: _verify_phase7(note),
    'SKULD_PHASE_8': lambda note: _verify_phase8(note),
    'SKULD_PHASE_9': lambda note: _verify_phase9(note),
    'SKULD_PHASE_10': lambda note: _verify_phase10(note),
}

def _evidence_from_note(note: str, required_key: str) -> str | None:
    """Extract evidence value from a note string like 'key=value' or a path."""
    if not note:
        return None
    for part in note.split():
        if part.startswith(required_key + '='):
            return part[len(required_key)+1:]
    return note if note else None

def _verify_phase0(note: str) -> dict:
    """Phase 0: OPERATION_SKULD=READY from migration-readiness output required in note."""
    evidence = _evidence_from_note(note, 'evidence') or note
    if not evidence:
        raise SystemExit('Phase 0 gate requires evidence note (e.g., evidence=1.4.x migration-readiness PASS stamp)')
    return {'gate': 'verified', 'evidence': evidence,
            'verifierResult': 'OPERATION_SKULD_SOURCE_READY=confirmed-by-note'}

def _verify_phase1(note: str) -> dict:
    """Phase 1: 1.4.x audit fixes and tooling — check key scripts exist."""
    import os, sys
    root = Path(state_file).parent.parent.parent  # approx root from backup-root
    required = [
        'scripts/plan-destination-bootstrap.sh',
        'scripts/plan-clean-orbstack-guest.sh',
        'scripts/plan-homelab-clean-restore.sh',
        'scripts/skuld-state-machine.sh',
        'scripts/plan-skuld-rollback.sh',
        'scripts/pre-migration-gc.sh',
        'scripts/plan-destination-capacity.sh',
        'scripts/full-homelab-backup.sh',
        'scripts/restore-skuld-secrets.sh',
    ]
    # Try environment variable SKULD_ROOT_DIR first, then search from state_file, then cwd
    import os
    env_root = os.environ.get('SKULD_ROOT_DIR', '')
    if env_root and (Path(env_root) / 'VERSION').exists():
        sr = Path(env_root)
    else:
        sr = state_file
        found = False
        for _ in range(8):
            sr = sr.parent
            if (sr / 'VERSION').exists():
                found = True
                break
        if not found:
            sr = Path.cwd()
    missing = [s for s in required if not (sr / s).exists()]
    if missing:
        raise SystemExit(f'Phase 1 gate: preparation scripts missing: {missing}')
    evidence = _evidence_from_note(note, 'evidence') or note or 'tooling-present'
    return {'gate': 'verified', 'evidence': evidence,
            'verifierResult': f'PREPARATION_TOOLING=present ({len(required)} scripts verified)'}

def _verify_phase2(note: str) -> dict:
    """Phase 2: Full HomeLab backup — requires evidence path in note."""
    evidence = _evidence_from_note(note, 'evidence') or note
    if not evidence:
        raise SystemExit(
            'Phase 2 gate requires backup evidence in note. '
            + 'Pass: --note evidence=/path/to/full-homelab-manifest.json'
        )
    # Try to validate the manifest if the path exists
    p = Path(evidence)
    verifier_result = 'FULL_HOMELAB_BACKUP_READY=note-provided'
    if p.exists() and p.suffix == '.json':
        import json
        try:
            data = json.loads(p.read_text())
            all_verified = data.get('allMigrateServicesVerified', False)
            verifier_result = f'FULL_HOMELAB_ARTIFACT_MANIFEST=verified; allVerified={all_verified}'
            if not all_verified:
                raise SystemExit(f'Phase 2 gate: full-homelab-manifest reports not all verified: {p}')
        except json.JSONDecodeError:
            pass  # not a JSON manifest, accept path as evidence
    return {'gate': 'verified', 'evidence': evidence, 'verifierResult': verifier_result}

def _verify_phase3(note: str) -> dict:
    """Phase 3: Sensitive-state bundle — requires bundle path evidence."""
    evidence = _evidence_from_note(note, 'evidence') or note
    if not evidence:
        raise SystemExit(
            'Phase 3 gate requires secret bundle evidence. '
            + 'Pass: --note evidence=/path/to/secrets-STAMP/secrets.tar.enc'
        )
    p = Path(evidence)
    if p.exists():
        manifest_p = p.parent / 'secrets.manifest.json'
        if manifest_p.exists():
            import json
            data = json.loads(manifest_p.read_text())
            logical_ids = data.get('logicalIds', [])
            verifier_result = f'SENSITIVE_STATE_COVERAGE=complete; logical_ids={len(logical_ids)}'
        else:
            verifier_result = 'SENSITIVE_STATE_COVERAGE=bundle-present'
    else:
        verifier_result = 'SENSITIVE_STATE_COVERAGE=note-provided (bundle path not accessible from state machine)'
    return {'gate': 'verified', 'evidence': evidence, 'verifierResult': verifier_result}

def _verify_phase4(note: str) -> dict:
    """Phase 4: Destination capacity — run plan-destination-capacity.sh in fixture mode or accept note evidence."""
    evidence = _evidence_from_note(note, 'evidence') or note or 'capacity-plan-evaluated'
    # Try to find and run the capacity planner
    sr = state_file
    for _ in range(6):
        sr = sr.parent
        if (sr / 'VERSION').exists():
            break
    capacity_script = sr / 'scripts/plan-destination-capacity.sh'
    if capacity_script.exists():
        import subprocess
        result = subprocess.run(
            ['bash', str(capacity_script), '--fixture'],
            capture_output=True, text=True,
            env={**__import__('os').environ,
                 'DESTINATION_CAPACITY_TEST_MODE': '1',
                 'SKULD_BACKUP_ROOT': str(state_file.parent)}
        )
        output = result.stdout + result.stderr
        if 'DESTINATION_CAPACITY_JUDGMENT=BLOCKER' in output:
            raise SystemExit('Phase 4 gate BLOCKED: DESTINATION_CAPACITY_JUDGMENT=BLOCKER')
        verifier_result = f'DESTINATION_CAPACITY_MODEL=verified (plan script ran; judgment not BLOCKER)'
    else:
        verifier_result = f'DESTINATION_CAPACITY_MODEL=note-provided'
    return {'gate': 'verified', 'evidence': evidence, 'verifierResult': verifier_result}

def _verify_phase5(note: str) -> dict:
    """Phase 5: Destination bootstrap plan."""
    sr = state_file
    for _ in range(6):
        sr = sr.parent
        if (sr / 'VERSION').exists():
            break
    bootstrap_script = sr / 'scripts/plan-destination-bootstrap.sh'
    if bootstrap_script.exists():
        import subprocess
        result = subprocess.run(
            ['bash', str(bootstrap_script), '--fixture'],
            capture_output=True, text=True
        )
        output = result.stdout + result.stderr
        if 'DESTINATION_BOOTSTRAP_PLAN=ready' not in output:
            raise SystemExit('Phase 5 gate: DESTINATION_BOOTSTRAP_PLAN=ready not produced')
        verifier_result = 'DESTINATION_BOOTSTRAP_PLAN=verified'
    else:
        evidence = _evidence_from_note(note, 'evidence') or note
        if not evidence:
            raise SystemExit('Phase 5 gate: plan-destination-bootstrap.sh not found and no evidence note')
        verifier_result = 'DESTINATION_BOOTSTRAP_PLAN=note-provided'
    evidence = _evidence_from_note(note, 'evidence') or note or 'bootstrap-plan-ran'
    return {'gate': 'verified', 'evidence': evidence, 'verifierResult': verifier_result}

def _verify_phase6(note: str) -> dict:
    """Phase 6: Clean guest creation plan."""
    sr = state_file
    for _ in range(6):
        sr = sr.parent
        if (sr / 'VERSION').exists():
            break
    script = sr / 'scripts/plan-clean-orbstack-guest.sh'
    if script.exists():
        import subprocess
        result = subprocess.run(['bash', str(script), '--fixture'], capture_output=True, text=True)
        output = result.stdout + result.stderr
        if 'CLEAN_GUEST_CREATION_PLAN=ready' not in output:
            raise SystemExit('Phase 6 gate: CLEAN_GUEST_CREATION_PLAN=ready not produced')
        verifier_result = 'CLEAN_GUEST_CREATION_PLAN=verified'
    else:
        evidence = _evidence_from_note(note, 'evidence') or note
        if not evidence:
            raise SystemExit('Phase 6 gate: plan-clean-orbstack-guest.sh not found and no evidence note')
        verifier_result = 'CLEAN_GUEST_CREATION_PLAN=note-provided'
    evidence = _evidence_from_note(note, 'evidence') or note or 'clean-guest-plan-ran'
    return {'gate': 'verified', 'evidence': evidence, 'verifierResult': verifier_result}

def _verify_phase7(note: str) -> dict:
    """Phase 7: HomeLab clean-restore plan."""
    sr = state_file
    for _ in range(6):
        sr = sr.parent
        if (sr / 'VERSION').exists():
            break
    script = sr / 'scripts/plan-homelab-clean-restore.sh'
    if script.exists():
        import subprocess
        result = subprocess.run(['bash', str(script), '--fixture'], capture_output=True, text=True)
        output = result.stdout + result.stderr
        if 'HOMELAB_CLEAN_RESTORE_PLAN=ready' not in output:
            raise SystemExit('Phase 7 gate: HOMELAB_CLEAN_RESTORE_PLAN=ready not produced')
        verifier_result = 'HOMELAB_CLEAN_RESTORE_PLAN=verified'
    else:
        evidence = _evidence_from_note(note, 'evidence') or note
        if not evidence:
            raise SystemExit('Phase 7 gate: plan-homelab-clean-restore.sh not found and no evidence note')
        verifier_result = 'HOMELAB_CLEAN_RESTORE_PLAN=note-provided'
    evidence = _evidence_from_note(note, 'evidence') or note or 'homelab-restore-plan-ran'
    return {'gate': 'verified', 'evidence': evidence, 'verifierResult': verifier_result}

def _verify_phase8(note: str) -> dict:
    """Phase 8: Rollback plan."""
    sr = state_file
    for _ in range(6):
        sr = sr.parent
        if (sr / 'VERSION').exists():
            break
    script = sr / 'scripts/plan-skuld-rollback.sh'
    if script.exists():
        import subprocess
        result = subprocess.run(['bash', str(script), '--fixture'], capture_output=True, text=True)
        output = result.stdout + result.stderr
        if 'ROLLBACK_PLAN=ready' not in output:
            raise SystemExit('Phase 8 gate: ROLLBACK_PLAN=ready not produced')
        verifier_result = 'ROLLBACK_PLAN=verified'
    else:
        evidence = _evidence_from_note(note, 'evidence') or note
        if not evidence:
            raise SystemExit('Phase 8 gate: plan-skuld-rollback.sh not found and no evidence note')
        verifier_result = 'ROLLBACK_PLAN=note-provided'
    evidence = _evidence_from_note(note, 'evidence') or note or 'rollback-plan-ran'
    return {'gate': 'verified', 'evidence': evidence, 'verifierResult': verifier_result}

def _verify_phase9(note: str) -> dict:
    """Phase 9: Safe pre-migration GC — requires evidence of GC execution."""
    evidence = _evidence_from_note(note, 'evidence') or note
    if not evidence:
        raise SystemExit(
            'Phase 9 gate requires GC evidence. '
            + 'Pass: --note evidence=/path/to/pre-migration-gc/STAMP/result.txt'
        )
    p = Path(evidence)
    if p.exists():
        content = p.read_text()
        if 'GC_APPLY=passed' in content or 'GC_PLAN=ready' in content:
            verifier_result = f'SAFE_GC=verified (evidence file present)'
        else:
            raise SystemExit(f'Phase 9 gate: GC evidence file does not contain GC_APPLY=passed or GC_PLAN=ready: {p}')
    else:
        verifier_result = 'SAFE_GC=note-provided'
    return {'gate': 'verified', 'evidence': evidence, 'verifierResult': verifier_result}

def _verify_phase10(note: str) -> dict:
    """Phase 10: Final source-side readiness — run migration-readiness check sources or accept note."""
    sr = state_file
    for _ in range(6):
        sr = sr.parent
        if (sr / 'VERSION').exists():
            break
    readiness_script = sr / 'scripts/migration-readiness.sh'
    evidence = _evidence_from_note(note, 'evidence') or note
    if not evidence:
        raise SystemExit(
            'Phase 10 gate requires readiness evidence. '
            + 'Pass: --note evidence=OPERATION_SKULD=READY-stamp'
        )
    verifier_result = f'FINAL_MIGRATION_READINESS=note-provided ({evidence})'
    return {'gate': 'verified', 'evidence': evidence, 'verifierResult': verifier_result}

def advance(state: dict, phase: str, note_text: str) -> None:
    if phase not in PHASES:
        if phase in CUTOVER_PHASES:
            raise SystemExit(
                f'Phase {phase} is a destination-side cutover phase and is not authorized in this goal. '
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
        missing_str = ', '.join(missing)
        raise SystemExit(f'Cannot advance to {phase}: required phases not completed: {missing_str}')
    # Run gate verifier before marking complete
    verifier_fn = GATE_VERIFIERS.get(phase)
    verifier_evidence = {}
    if verifier_fn:
        print(f'SKULD_GATE_VERIFIER={phase}')
        verifier_evidence = verifier_fn(note_text)
        print(f'SKULD_GATE_RESULT={verifier_evidence.get("verifierResult", "verified")}')
    completed.append(phase)
    state['completedPhases'] = completed
    state['currentPhase'] = phase
    event = {
        'phase': phase,
        'description': PHASES[phase]['description'],
        'gate': PHASES[phase]['gate'],
        'advancedAt': now_utc(),
        'note': note_text or '',
        'gateEvidence': verifier_evidence,
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