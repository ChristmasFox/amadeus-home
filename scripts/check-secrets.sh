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

printf '%s\n' 'Secret scan passed: no credential-shaped values or forbidden tracked files found.'
