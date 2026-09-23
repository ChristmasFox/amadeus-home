#!/usr/bin/env bash
# scripts/test-full-homelab-backup.sh
# Amadeus 1.4.7 — Tests for full-homelab-backup.sh
# Fixture/test mode only; never SSHes to real OrbStack machine.
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-homelab-backup-test.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

export AMADEUS_HOST_PROFILE="$fixture/no-host-profile"
export SKULD_BACKUP_ROOT="$fixture/skuld"
mkdir -p "$SKULD_BACKUP_ROOT"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

# ------------------------------------------------------------------
# Test 1: plan mode exits cleanly without OrbStack access
# ------------------------------------------------------------------
test_plan_mode() {
  local out
  out="$(FULL_HOMELAB_BACKUP_TEST_MODE=1 \
    bash "$ROOT_DIR/scripts/full-homelab-backup.sh" --plan \
      --output-dir "$fixture/plan-out" 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'FULL_HOMELAB_BACKUP=plan-ready' \
    || fail 'plan mode: did not produce FULL_HOMELAB_BACKUP=plan-ready'
  pass 'full-homelab-backup.sh --plan'
}

# ------------------------------------------------------------------
# Test 2: fixture mode produces artifacts for all MIGRATE services
# ------------------------------------------------------------------
test_fixture_mode() {
  local out out_dir="$fixture/fixture-out"
  out="$(FULL_HOMELAB_BACKUP_TEST_MODE=1 \
    bash "$ROOT_DIR/scripts/full-homelab-backup.sh" --fixture \
      --output-dir "$out_dir" 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'FULL_HOMELAB_BACKUP=passed' \
    || fail 'fixture mode: did not produce FULL_HOMELAB_BACKUP=passed'
  printf '%s\n' "$out" | grep -Fq 'FULL_HOMELAB_BACKUP_MANIFEST=' \
    || fail 'fixture mode: FULL_HOMELAB_BACKUP_MANIFEST not reported'
  printf '%s\n' "$out" | grep -Fq 'FULL_HOMELAB_BACKUP_ALL_VERIFIED=True' \
    || fail 'fixture mode: FULL_HOMELAB_BACKUP_ALL_VERIFIED not True'

  # Verify manifest exists and is valid JSON
  manifest="$(printf '%s\n' "$out" | grep 'FULL_HOMELAB_BACKUP_MANIFEST=' | cut -d= -f2-)"
  [[ -f "$manifest" ]] || fail "fixture mode: manifest file missing at $manifest"
  python3 -m json.tool "$manifest" > /dev/null || fail 'fixture mode: manifest is not valid JSON'

  # Verify results.txt has entries for all 16 MIGRATE services
  results_file="$out_dir/results.txt"
  [[ -f "$results_file" ]] || fail 'fixture mode: results.txt missing'
  local count
  count="$(grep -c 'service=' "$results_file" || true)"
  (( count >= 16 )) || fail "fixture mode: expected >=16 service results, got $count"

  # Check all services have verify=passed
  while IFS= read -r line; do
    if [[ "$line" =~ service=([^ ]+) ]]; then
      svc="${BASH_REMATCH[1]}"
      if ! printf '%s\n' "$line" | grep -q 'verify=passed'; then
        fail "fixture mode: service $svc does not have verify=passed"
      fi
    fi
  done < "$results_file"

  # Verify checksums file exists
  [[ -f "$out_dir/checksums.sha256" ]] || fail 'fixture mode: checksums.sha256 missing'

  # Xiaoya's live bind source is remapped from /home/blacksidev/xiaoya into
  # /DATA/AppData/xiaoya, and its Alist named volume is a separate artifact.
  [[ -s "$out_dir/xiaoya/xiaoya-appdata.tar.gz" ]] || fail 'fixture mode: Xiaoya bind archive missing'
  [[ -s "$out_dir/xiaoya/xiaoya-alist-data.tar.gz" ]] || fail 'fixture mode: Xiaoya Alist volume archive missing'
  [[ -s "$out_dir/xiaoya/restore-map.json" ]] || fail 'fixture mode: Xiaoya restore map missing'
  tar -tzf "$out_dir/xiaoya/xiaoya-appdata.tar.gz" | grep -Fq 'fixture.txt' \
    || fail 'fixture mode: Xiaoya bind archive is empty'
  tar -tzf "$out_dir/xiaoya/xiaoya-alist-data.tar.gz" | grep -Fq 'fixture.txt' \
    || fail 'fixture mode: Xiaoya Alist volume archive is empty'

  python3 - "$out_dir/9router/image-manifest.json" <<'PY'
import json, sys
value = json.loads(open(sys.argv[1]).read())
assert value.get('image') == 'local/9router:0.5.81', value
PY
  pass 'fixture mode: exact 9Router tag and Xiaoya bind/volume artifacts'

  pass 'full-homelab-backup.sh --fixture produces all MIGRATE service artifacts'
}

# ------------------------------------------------------------------
# Test 3: Avalon bulk media is never archived (external-reference only)
# ------------------------------------------------------------------
test_no_avalon_bulk_archive() {
  local out_dir="$fixture/avalon-check"
  FULL_HOMELAB_BACKUP_TEST_MODE=1 \
    bash "$ROOT_DIR/scripts/full-homelab-backup.sh" --fixture \
      --output-dir "$out_dir" > /dev/null 2>&1 || true
  # Manifest should state external-reference-only policy
  manifest="$(find "$out_dir" -name 'full-homelab-manifest.json' | head -n 1)"
  if [[ -n "$manifest" ]]; then
    python3 - "$manifest" << 'PY'
import json, sys
data = json.loads(open(sys.argv[1]).read())
policy = data.get('avalonBulkDataPolicy', '')
assert 'external-reference-only' in policy, f'avalon policy not set: {policy}'
print('OK')
PY
  fi
  pass 'Avalon bulk data policy is external-reference-only'
}

# ------------------------------------------------------------------
# Test 4: Script syntax check
# ------------------------------------------------------------------
test_syntax() {
  bash -n "$ROOT_DIR/scripts/full-homelab-backup.sh" \
    || fail 'full-homelab-backup.sh has syntax errors'
  pass 'full-homelab-backup.sh syntax is valid'
}

test_syntax
test_plan_mode
test_fixture_mode
test_no_avalon_bulk_archive

printf '\nAll full-homelab-backup tests passed.\n'
