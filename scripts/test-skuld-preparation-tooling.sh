#!/usr/bin/env bash
# scripts/test-skuld-preparation-tooling.sh
# Amadeus 1.4.6 — Tests for all Operation Skuld preparation tooling.
# Uses fixture/fake targets only; never SSHes to real destination.
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-skuld-prep.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

# Keep the fixture independent from a developer's ignored real host profile.
export AMADEUS_HOST_PROFILE="$fixture/no-host-profile"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

# ------------------------------------------------------------------
# 1. plan-destination-bootstrap.sh
# ------------------------------------------------------------------
test_bootstrap_plan() {
  local out
  out="$(EXTERNAL_STORAGE_ROOT="$fixture/ext" \
    FASHION_SIGLIP_PORT=18400 \
    bash "$ROOT_DIR/scripts/plan-destination-bootstrap.sh" --fixture 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'HOST_IDENTITY=Amadeus-M204' || fail 'bootstrap: HOST_IDENTITY not found'
  printf '%s\n' "$out" | grep -Fq 'DESTINATION_MACOS_USER=nyannyan' || fail 'bootstrap: MACOS_USER not nyannyan'
  printf '%s\n' "$out" | grep -Fq 'DESTINATION_ORBSTACK_MACHINE=nyannyan' || fail 'bootstrap: ORBSTACK_MACHINE not nyannyan'
  printf '%s\n' "$out" | grep -Fq 'DESTINATION_LINUX_USER=nyannyan' || fail 'bootstrap: LINUX_USER not nyannyan'
  printf '%s\n' "$out" | grep -Fq 'DESTINATION_BOOTSTRAP_PLAN=ready' || fail 'bootstrap: PLAN not ready'
  # Must NOT contain blacksidev as an active destination path (allowed in prohibition/note context)
  if printf '%s\n' "$out" | grep 'blacksidev' | grep -qEv '(No |not |never |legacy|old |note|prohibited|does not|never become|must not|denied)'; then
    fail 'bootstrap: output contains active blacksidev dependency (not in prohibition context)'
  fi
  pass 'plan-destination-bootstrap.sh'
}

# ------------------------------------------------------------------
# 2. plan-clean-orbstack-guest.sh
# ------------------------------------------------------------------
test_clean_guest_plan() {
  local out
  out="$(bash "$ROOT_DIR/scripts/plan-clean-orbstack-guest.sh" --fixture 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'GUEST_PLAN_STRATEGY=clean-ubuntu-24.04' || fail 'clean-guest: STRATEGY not found'
  printf '%s\n' "$out" | grep -Fq 'DESTINATION_MACHINE=nyannyan' || fail 'clean-guest: MACHINE not nyannyan'
  printf '%s\n' "$out" | grep -Fq 'CLEAN_GUEST_CREATION_PLAN=ready' || fail 'clean-guest: PLAN not ready'
  printf '%s\n' "$out" | grep -Fq 'SOURCE_FROZEN=NO' || fail 'clean-guest: SOURCE_FROZEN not NO'
  # Must NOT recommend importing/exporting source machine
  if printf '%s\n' "$out" | grep -i 'orb import\|orb clone' | grep -v 'NEVER\|NOT\|not\|never'; then
    fail 'clean-guest: output suggests importing source machine without prohibition'
  fi
  pass 'plan-clean-orbstack-guest.sh'
}

# ------------------------------------------------------------------
# 3. plan-homelab-clean-restore.sh
# ------------------------------------------------------------------
test_homelab_restore_plan() {
  local out
  out="$(bash "$ROOT_DIR/scripts/plan-homelab-clean-restore.sh" --fixture 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'HOMELAB_CLEAN_RESTORE_PLAN=ready' || fail 'homelab-restore: PLAN not ready'
  printf '%s\n' "$out" | grep -Fq 'CLEAN_RESTORE_INDEPENDENT_OF_GUEST_SNAPSHOT=yes' || fail 'homelab-restore: independence not confirmed'
  printf '%s\n' "$out" | grep -Fq 'DESTINATION_MACHINE=nyannyan' || fail 'homelab-restore: MACHINE not nyannyan'
  # Must NOT reference blacksidev as active destination (allowed in prohibition/note/legacy context)
  if printf '%s\n' "$out" | grep 'blacksidev' | grep -qEv '(not blacksidev|nyannyan|legacy|old Mac|source|was |never|NOT |note|prohibited)'; then
    fail 'homelab-restore: active blacksidev destination path in output'
  fi
  pass 'plan-homelab-clean-restore.sh'
}

# ------------------------------------------------------------------
# 4. skuld-state-machine.sh (fixture state file)
# ------------------------------------------------------------------
test_skuld_state_machine() {
  local state_file="$fixture/skuld-phase-state.json"
  export SKULD_BACKUP_ROOT="$fixture/skuld-backup"
  mkdir -p "$fixture/skuld-backup"

  # Status on fresh state
  local out
  out="$(SKULD_STATE_MACHINE_FILE="$state_file" \
    bash "$ROOT_DIR/scripts/skuld-state-machine.sh" --status 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'SKULD_CURRENT_PHASE=none' || fail 'state-machine: fresh phase not none'
  printf '%s\n' "$out" | grep -Fq 'SKULD_DESTINATION_HOST=Amadeus-M204' || fail 'state-machine: destination host mismatch'

  # Advance PHASE_0 (no prerequisites)
  SKULD_STATE_MACHINE_FILE="$state_file" \
    bash "$ROOT_DIR/scripts/skuld-state-machine.sh" --advance SKULD_PHASE_0 --note "fixture test" >/dev/null
  out="$(SKULD_STATE_MACHINE_FILE="$state_file" \
    bash "$ROOT_DIR/scripts/skuld-state-machine.sh" --status 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'SKULD_CURRENT_PHASE=SKULD_PHASE_0' || fail 'state-machine: PHASE_0 not recorded'

  # Attempt to advance PHASE_2 before PHASE_1 (should fail)
  if SKULD_STATE_MACHINE_FILE="$state_file" \
    bash "$ROOT_DIR/scripts/skuld-state-machine.sh" --advance SKULD_PHASE_2 2>/dev/null; then
    fail 'state-machine: advanced PHASE_2 before PHASE_1 (prerequisite not enforced)'
  fi

  # Advance PHASE_1
  SKULD_STATE_MACHINE_FILE="$state_file" \
    bash "$ROOT_DIR/scripts/skuld-state-machine.sh" --advance SKULD_PHASE_1 >/dev/null

  # Attempt cutover phase (should fail — not authorized)
  if SKULD_STATE_MACHINE_FILE="$state_file" \
    bash "$ROOT_DIR/scripts/skuld-state-machine.sh" --advance SKULD_PHASE_11 2>/dev/null; then
    fail 'state-machine: cutover phase PHASE_11 accepted without authorization'
  fi

  # Validate
  out="$(SKULD_STATE_MACHINE_FILE="$state_file" \
    bash "$ROOT_DIR/scripts/skuld-state-machine.sh" --validate 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'SKULD_VALIDATE_FAILURES=0' || fail 'state-machine: validate reports failures'

  pass 'skuld-state-machine.sh'
}

# ------------------------------------------------------------------
# 5. plan-skuld-rollback.sh
# ------------------------------------------------------------------
test_rollback_plan() {
  local out
  out="$(bash "$ROOT_DIR/scripts/plan-skuld-rollback.sh" --fixture 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'ROLLBACK_PLAN=ready' || fail 'rollback: PLAN not ready'
  printf '%s\n' "$out" | grep -Fq 'SOURCE_FROZEN=NO' || fail 'rollback: SOURCE_FROZEN not NO'
  printf '%s\n' "$out" | grep -Fq 'DESTINATION_MUTATED=NO' || fail 'rollback: DESTINATION_MUTATED not NO'
  printf '%s\n' "$out" | grep -Fq 'MAC_MINI_CUTOVER=NOT_EXECUTED' || fail 'rollback: MAC_MINI_CUTOVER not NOT_EXECUTED'
  pass 'plan-skuld-rollback.sh'
}

# ------------------------------------------------------------------
# 6. pre-migration-gc.sh (test mode)
# ------------------------------------------------------------------
test_pre_migration_gc() {
  local out
  out="$(PRE_MIGRATION_GC_TEST_MODE=1 \
    SKULD_BACKUP_ROOT="$fixture/skuld-backup" \
    bash "$ROOT_DIR/scripts/pre-migration-gc.sh" --plan 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'PRE_MIGRATION_GC=passed (test-mode)' || fail 'pre-migration-gc: test-mode plan failed'
  printf '%s\n' "$out" | grep -Fq 'GC_VOLUMES_PRUNED=0 (never)' || fail 'pre-migration-gc: volume prune guard missing'
  printf '%s\n' "$out" | grep -Fq 'GC_SYSTEM_PRUNE=never' || fail 'pre-migration-gc: system prune guard missing'
  pass 'pre-migration-gc.sh (test mode)'
}

# ------------------------------------------------------------------
# 7. plan-destination-capacity.sh (fixture mode)
# ------------------------------------------------------------------
test_capacity_plan() {
  local out
  out="$(DESTINATION_CAPACITY_TEST_MODE=1 \
    FIXTURE_DOCKER_BYTES=32212254720 \
    FIXTURE_APPDATA_BYTES=5368709120 \
    FIXTURE_PNPM_BYTES=2147483648 \
    FIXTURE_MACOS_APPS_BYTES=1073741824 \
    SKULD_BACKUP_ROOT="$fixture/skuld-backup" \
    bash "$ROOT_DIR/scripts/plan-destination-capacity.sh" --fixture 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'DESTINATION_CAPACITY_PLAN=ready' || fail 'capacity: PLAN not ready'
  printf '%s\n' "$out" | grep -Fq 'DESTINATION_CAPACITY_JUDGMENT=' || fail 'capacity: JUDGMENT not found'
  # Verify Avalon is explicitly excluded from SSD calculation
  printf '%s\n' "$out" | grep -qi 'avalon' || fail 'capacity: Avalon not mentioned'
  pass 'plan-destination-capacity.sh (fixture mode)'
}

# ------------------------------------------------------------------
# 8. Destination identity invariants
# ------------------------------------------------------------------
test_destination_identity() {
  # Verify no active /Users/blacksidev in planning scripts
  local scripts=(
    scripts/plan-destination-bootstrap.sh
    scripts/plan-clean-orbstack-guest.sh
    scripts/plan-homelab-clean-restore.sh
    scripts/skuld-state-machine.sh
    scripts/plan-skuld-rollback.sh
    scripts/plan-destination-capacity.sh
    scripts/pre-migration-gc.sh
  )
  for script in "${scripts[@]}"; do
    # Active production destination paths (not legacy annotations or prohibition notes)
    # Allowed: comments (#), legacy mentions, prohibition text like 'No /Users/blacksidev'
    if grep -n 'blacksidev' "$ROOT_DIR/$script" 2>/dev/null \
       | grep -Ev '(#|legacy|old Mac|was |source|comment|note|description|No /Users/blacksidev|No /home/blacksidev|not.*blacksidev)'; then
      fail "destination identity: $script contains active blacksidev dependency"
    fi
  done
  pass 'destination identity: no active blacksidev in preparation scripts'

  # Verify destination identity constants
  for script in scripts/plan-destination-bootstrap.sh scripts/plan-clean-orbstack-guest.sh scripts/skuld-state-machine.sh; do
    grep -q 'nyannyan' "$ROOT_DIR/$script" || fail "destination identity: nyannyan not found in $script"
    grep -q 'Amadeus-M204' "$ROOT_DIR/$script" || fail "destination identity: Amadeus-M204 not found in $script"
  done
  pass 'destination identity: nyannyan and Amadeus-M204 in all planning scripts'
}

# ------------------------------------------------------------------
# Run all tests
# ------------------------------------------------------------------
test_bootstrap_plan
test_clean_guest_plan
test_homelab_restore_plan
test_skuld_state_machine
test_rollback_plan
test_pre_migration_gc
test_capacity_plan
test_destination_identity

printf '\nAll preparation tooling tests passed.\n'
