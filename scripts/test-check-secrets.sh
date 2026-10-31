#!/usr/bin/env bash
# Fixture test for scripts/check-secrets.sh runtime-memory and owner-number guards.
set -Eeuo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
base="$(mktemp -d)"
trap 'rm -rf "$base"' EXIT
work="$base/repo"

mkdir -p "$work/scripts"
cp "$REPO_ROOT/scripts/check-secrets.sh" "$work/scripts/check-secrets.sh"
cd "$work"
git init -q .
export LAB_OWNER_TARGET_FILE="$base/owner-target"
fake_digits="15550100999"
printf 'whatsapp:+%s\n' "$fake_digits" > "$LAB_OWNER_TARGET_FILE"

run() { bash scripts/check-secrets.sh >"$base/out" 2>"$base/err"; }
expect_pass() { run || { cat "$base/err" >&2; echo "FAIL: $1 should pass" >&2; exit 1; }; }
expect_fail() {
  if run; then echo "FAIL: $1 should fail" >&2; exit 1; fi
  grep -q -F -e "$2" "$base/err" || { cat "$base/err" >&2; echo "FAIL: $1 message missing '$2'" >&2; exit 1; }
}

mkdir -p integrations/openclaw/workspace-seed
printf 'seed\n' > integrations/openclaw/workspace-seed/MEMORY.seed.md
printf 'seed\n' > integrations/openclaw/workspace-seed/USER.seed.md
printf 'doc mentions MEMORY.md and memory/ but is a plain file\n' > README.md
expect_pass "seeds and docs"

for path in MEMORY.md workspace/USER.md workspace/DREAMS.md workspace/memory/2026-10-31-0400.md .dreams/state.json workspace/.amadeus-private/dm-digest.md \
  state/main.sqlite-wal state/main.sqlite-shm sessions/a.jsonl backups-20261031/x.txt openclaw.json.bak.1 openclaw.json.last-good; do
  mkdir -p "$(dirname "$path")"
  printf 'x\n' > "$path"
  expect_fail "$path" 'Lab runtime memory or session data'
  rm -f "$path"
  find . -mindepth 1 -type d -empty -not -path './.git/*' -not -path './scripts' -not -path './integrations*' -delete
done
expect_pass "after cleanup"

printf 'note +%s leaked\n' "$fake_digits" > notes.txt
expect_fail "owner number" 'Owner phone number found'
grep -q -F -e "$fake_digits" "$base/err" && { echo "FAIL: number must not be printed" >&2; exit 1; }
grep -q 'notes.txt' "$base/err" || { echo "FAIL: file name not printed" >&2; exit 1; }
rm notes.txt

printf 'note +%s leaked\n' "$fake_digits" > ignored.txt
printf 'ignored.txt\n' > .gitignore
expect_pass "ignored file containing the number"

LAB_OWNER_TARGET_FILE="$base/missing" bash scripts/check-secrets.sh >/dev/null 2>&1 || { echo "FAIL: missing owner file must be skipped" >&2; exit 1; }

echo "CHECK_SECRETS_TEST=passed runtime_memory=12 owner_number=3"
