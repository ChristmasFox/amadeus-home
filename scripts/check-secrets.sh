#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  printf '%s\n' 'Git repository is not initialized; secret scan skipped.'
  exit 0
fi

tracked_files="$(git ls-files -co --exclude-standard)"
if [ -z "$tracked_files" ]; then
  printf '%s\n' 'No non-ignored files to scan.'
  exit 0
fi

set +e
matches="$(
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    rg -l --no-messages -i \
      -e 'sk-[A-Za-z0-9]{20,}' \
      -e '[0-9]{8,}:AA[A-Za-z0-9_-]{16,}' \
      -e 'Bearer[[:space:]]+[A-Za-z0-9._-]{20,}' \
      -e 'github_pat_[A-Za-z0-9_]{20,}' \
      -e 'ghp_[A-Za-z0-9]{20,}' \
      -e 'xox[baprs]-[A-Za-z0-9-]{20,}' \
      -e '-----BEGIN[[:space:]]+(RSA|OPENSSH|EC)[[:space:]]+PRIVATE KEY-----' \
      -e '(^|[[:space:]])[A-Za-z_]*(api[_-]?key|access[_-]?token|app[_-]?secret|bot[_-]?token|password|jwt[_-]?secret|rpc[_-]?secret)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9+/=_-]{20,}' \
      -- "$file"
  done <<< "$tracked_files"
)"
set -e

if [ -n "$matches" ]; then
  printf '%s\n' 'Potential secret material found in:' >&2
  printf '%s\n' "$matches" | sort -u >&2
  printf '%s\n' 'Replace values with environment variables or placeholders before committing.' >&2
  exit 1
fi

forbidden=""
while IFS= read -r file; do
  case "$file" in
    .env.example|*/.env.example) ;;
    .env|*/.env|.env.*|*/.env.*|*/secrets/*|*.pem|*.key|*.p12|*.pfx|*.lbpkg|*.sqlite|*.sqlite3|*.db)
      forbidden+="$file"$'\n'
      ;;
  esac
done <<< "$tracked_files"

if [ -n "$forbidden" ]; then
  printf '%s\n' 'Forbidden secret or runtime-data files are visible to Git:' >&2
  printf '%s\n' "$forbidden" >&2
  exit 1
fi

# Lab runtime memory (MEMORY.md, USER.md, DREAMS.md, memory/, snapshots, state
# DB sidecars, backups) is private data: only code, templates and *.seed.md may
# be visible to Git.
runtime_memory=""
while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    integrations/openclaw/workspace-seed/*.seed.md) continue ;;
  esac
  case "/$file" in
    */MEMORY.md|*/USER.md|*/DREAMS.md|*/memory/*|*/.dreams/*|*.sqlite-wal|*.sqlite-shm|*.jsonl|*/backups-*/*|*/openclaw.json.bak*|*/openclaw.json.last-good)
      runtime_memory+="$file"$'\n'
      ;;
  esac
done <<< "$tracked_files"

if [ -n "$runtime_memory" ]; then
  printf '%s\n' 'Lab runtime memory or session data is visible to Git (never commit it):' >&2
  printf '%s\n' "$runtime_memory" >&2
  exit 1
fi

# The real owner number must never appear in a non-ignored file. It is read at
# runtime from a private file (never embedded here); skipped when unavailable.
owner_file="${LAB_OWNER_TARGET_FILE:-/DATA/AppData/openclaw/secrets/owner-whatsapp-target}"
if [ -r "$owner_file" ]; then
  owner_digits="$(LC_ALL=C tr -dc '0-9' < "$owner_file" 2>/dev/null || true)"
  if [ "${#owner_digits}" -ge 7 ]; then
    owner_hits="$(printf '%s\n' "$tracked_files" | while IFS= read -r file; do
      [ -f "$file" ] && grep -l -F -e "$owner_digits" -- "$file" 2>/dev/null || true
    done)"
    if [ -n "$owner_hits" ]; then
      printf '%s\n' 'Owner phone number found in (file names only):' >&2
      printf '%s\n' "$owner_hits" | sort -u >&2
      exit 1
    fi
  fi
fi

printf '%s\n' 'Secret scan passed: no credential-shaped values or forbidden tracked files found.'
