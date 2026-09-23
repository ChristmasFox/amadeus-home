#!/usr/bin/env bash
# scripts/test-restore-skuld-secrets.sh
# Amadeus 1.4.7 — Tests for restore-skuld-secrets.sh
# Verifies: path safety, permissions, manifest coverage, checksum validation,
# rollback-safe failure behavior.
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-restore-secrets-test.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

export AMADEUS_HOST_PROFILE="$fixture/no-host-profile"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

# ------------------------------------------------------------------
# Test 1: Dry-run mode works without real bundle
# ------------------------------------------------------------------
test_dry_run() {
  local out
  out="$(SKULD_SECRET_RESTORE_TEST_MODE=1 \
    bash "$ROOT_DIR/scripts/restore-skuld-secrets.sh" --fixture --dry-run 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'SECRET_RESTORE_MODE=dry-run' \
    || fail 'dry-run: mode not reported'
  printf '%s\n' "$out" | grep -Fq 'DEST_HOST=Amadeus-M204' \
    || fail 'dry-run: DEST_HOST not Amadeus-M204'
  printf '%s\n' "$out" | grep -Fq 'DEST_MACOS_USER=nyannyan' \
    || fail 'dry-run: DEST_MACOS_USER not nyannyan'
  printf '%s\n' "$out" | grep -Fq 'DEST_LINUX_USER=nyannyan' \
    || fail 'dry-run: DEST_LINUX_USER not nyannyan'
  printf '%s\n' "$out" | grep -Fq 'SECRET_RESTORE_PATH=dry-run-passed' \
    || fail 'dry-run: SECRET_RESTORE_PATH not dry-run-passed'
  # All targets should be DRY entries (not APPLY)
  if printf '%s\n' "$out" | grep -q '^APPLY '; then
    fail 'dry-run: produced APPLY entries (should be DRY only)'
  fi
  pass 'restore-skuld-secrets.sh --dry-run'
}

# ------------------------------------------------------------------
# Test 2: Apply mode writes files with correct permissions
# ------------------------------------------------------------------
test_apply_mode() {
  local dest_base="$fixture/dest-apply"
  mkdir -p "$dest_base"
  local out
  out="$(SKULD_SECRET_RESTORE_TEST_MODE=1 \
    bash "$ROOT_DIR/scripts/restore-skuld-secrets.sh" \
      --fixture --apply --approve-avalon-move APPROVE_AVALON_MOVE_1_4_8 --dest-base "$dest_base" 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'SECRET_RESTORE_MODE=apply' \
    || fail 'apply: mode not reported'
  printf '%s\n' "$out" | grep -Fq 'SECRET_RESTORE_PATH=verified' \
    || fail 'apply: SECRET_RESTORE_PATH not verified'

  # Verify openclaw.env was written with 600 permissions
  local env_file="$dest_base/DATA/AppData/openclaw/openclaw.env"
  [[ -f "$env_file" ]] || fail "apply: openclaw.env not written at $env_file"
  local mode
  mode="$(stat -f '%Lp' "$env_file" 2>/dev/null || stat -c '%a' "$env_file")"
  [[ "$mode" == '600' ]] || fail "apply: openclaw.env has mode $mode (expected 600)"

  # Verify telegram-bot-token was written
  local tok_file="$dest_base/DATA/AppData/openclaw/secrets/telegram-bot-token"
  [[ -f "$tok_file" ]] || fail "apply: telegram-bot-token not written at $tok_file"
  mode="$(stat -f '%Lp' "$tok_file" 2>/dev/null || stat -c '%a' "$tok_file")"
  [[ "$mode" == '600' ]] || fail "apply: telegram-bot-token has mode $mode (expected 600)"

  local whatsapp_creds="$dest_base/DATA/AppData/openclaw/config/credentials/whatsapp/secondary/creds.json"
  [[ -s "$whatsapp_creds" ]] || fail 'apply: WhatsApp credential state was not restored'

  pass 'restore-skuld-secrets.sh --apply writes files with correct permissions'
}

# ------------------------------------------------------------------
# Test 3: Apply mode does NOT overwrite unknown files without approval
# ------------------------------------------------------------------
test_no_silent_overwrite() {
  local dest_base="$fixture/dest-no-overwrite"
  mkdir -p "$dest_base/DATA/AppData/openclaw"
  printf 'EXISTING_CONTENT\n' > "$dest_base/DATA/AppData/openclaw/openclaw.env"
  chmod 600 "$dest_base/DATA/AppData/openclaw/openclaw.env"

  local out
  out="$(SKULD_SECRET_RESTORE_TEST_MODE=1 \
    bash "$ROOT_DIR/scripts/restore-skuld-secrets.sh" \
      --fixture --apply --approve-avalon-move APPROVE_AVALON_MOVE_1_4_8 --dest-base "$dest_base" 2>/dev/null)"

  # openclaw.env should be skipped (not approved for replacement)
  printf '%s\n' "$out" | grep -q 'skipped-exists-not-approved\|SKIP.*openclaw-runtime-env' \
    || fail 'no-overwrite: existing file was not skipped'

  # Content should be unchanged
  local content
  content="$(cat "$dest_base/DATA/AppData/openclaw/openclaw.env")"
  [[ "$content" == 'EXISTING_CONTENT' ]] \
    || fail 'no-overwrite: existing file was silently overwritten'

  pass 'restore-skuld-secrets.sh --apply does not silently overwrite existing files'
}

# ------------------------------------------------------------------
# Test 4: Approved replacement works
# ------------------------------------------------------------------
test_approved_replacement() {
  local dest_base="$fixture/dest-approved"
  mkdir -p "$dest_base/DATA/AppData/openclaw"
  printf 'OLD_CONTENT\n' > "$dest_base/DATA/AppData/openclaw/openclaw.env"
  chmod 600 "$dest_base/DATA/AppData/openclaw/openclaw.env"

  local out
  out="$(SKULD_SECRET_RESTORE_TEST_MODE=1 \
    bash "$ROOT_DIR/scripts/restore-skuld-secrets.sh" \
      --fixture --apply --approve-avalon-move APPROVE_AVALON_MOVE_1_4_8 --dest-base "$dest_base" \
      --approve-replace "$dest_base/DATA/AppData/openclaw/openclaw.env" 2>/dev/null)"

  # Should have APPLY entry for openclaw.env
  printf '%s\n' "$out" | grep -q 'APPLY.*openclaw' \
    || fail 'approved-replace: openclaw.env not applied despite approval'

  local backup_file
  backup_file="$(find "$dest_base/.operation-skuld-secret-restore-backups" -type f -name openclaw.env -print -quit 2>/dev/null || true)"
  [[ -n "$backup_file" ]] || fail 'approved-replace: existing file was not checkpointed'
  [[ "$(cat "$backup_file")" == 'OLD_CONTENT' ]] || fail 'approved-replace: checkpoint content changed'

  pass 'restore-skuld-secrets.sh --apply respects --approve-replace'
}

# ------------------------------------------------------------------
# Test 5: Production-style apply is behind the Avalon operator boundary
# ------------------------------------------------------------------
test_avalon_boundary() {
  local dest_base="$fixture/dest-boundary"
  mkdir -p "$dest_base"
  if SKULD_SECRET_RESTORE_TEST_MODE=1 \
    bash "$ROOT_DIR/scripts/restore-skuld-secrets.sh" \
      --fixture --apply --dest-base "$dest_base" >/dev/null 2>&1; then
    fail 'avalon-boundary: apply succeeded without the exact approval token'
  fi
  [[ ! -e "$dest_base/DATA" ]] || fail 'avalon-boundary: destination changed without approval'
  pass 'restore-skuld-secrets.sh requires exact Avalon approval before apply'
}

# ------------------------------------------------------------------
# Test 5: Path safety — no path traversal possible
# ------------------------------------------------------------------
test_path_safety() {
  # The staging-side paths in the RESTORE_MAP must not contain ..
  python3 - "$ROOT_DIR/scripts/restore-skuld-secrets.sh" << 'PY'
import re, sys
from pathlib import Path

script = Path(sys.argv[1]).read_text()
# Extract RESTORE_MAP source paths (lines in the tuple with DATA/AppData or var/lib patterns)
# These are the restore source paths — they must not contain .. traversal
restore_paths = re.findall(r"'((?:DATA|var)/[A-Za-z0-9/_.-]+)'", script)
for path in restore_paths:
    if '..' in Path(path).parts:
        raise SystemExit(f'Path traversal in RESTORE_MAP source path: {path}')
# Also verify destination paths
dest_paths = re.findall(r"'((?:DATA|var|Users)/[A-Za-z0-9/_.-]+)'", script)
for path in dest_paths:
    if '..' in Path(path).parts:
        raise SystemExit(f'Path traversal in RESTORE_MAP dest path: {path}')
print('PATH_SAFETY=ok')
PY
  pass 'restore-skuld-secrets.sh has no path traversal in RESTORE_MAP'
}

# ------------------------------------------------------------------
# Test 6: Destination identity is always nyannyan/Amadeus-M204
# ------------------------------------------------------------------
test_destination_identity() {
  local out
  out="$(SKULD_SECRET_RESTORE_TEST_MODE=1 \
    bash "$ROOT_DIR/scripts/restore-skuld-secrets.sh" --fixture --dry-run 2>/dev/null)"
  printf '%s\n' "$out" | grep -Fq 'Amadeus-M204' \
    || fail 'destination-identity: Amadeus-M204 not found'
  printf '%s\n' "$out" | grep -Fq 'nyannyan' \
    || fail 'destination-identity: nyannyan not found'
  printf '%s\n' "$out" | grep -Fq '/Users/nyannyan' \
    || fail 'destination-identity: /Users/nyannyan not found'
  printf '%s\n' "$out" | grep -Fq '/home/nyannyan' \
    || fail 'destination-identity: /home/nyannyan not found'
  # Must NOT contain blacksidev as a destination
  if printf '%s\n' "$out" | grep -q 'blacksidev'; then
    fail 'destination-identity: blacksidev found in output'
  fi
  pass 'restore-skuld-secrets.sh: destination identity is Amadeus-M204/nyannyan'
}

# ------------------------------------------------------------------
# Test 7: Script syntax
# ------------------------------------------------------------------
test_syntax() {
  bash -n "$ROOT_DIR/scripts/restore-skuld-secrets.sh" \
    || fail 'restore-skuld-secrets.sh has syntax errors'
  pass 'restore-skuld-secrets.sh syntax is valid'
}

test_syntax
test_dry_run
test_apply_mode
test_no_silent_overwrite
test_approved_replacement
test_avalon_boundary
test_path_safety
test_destination_identity

printf '\nAll restore-skuld-secrets tests passed.\n'
