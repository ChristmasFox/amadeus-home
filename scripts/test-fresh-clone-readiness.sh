#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
FULL=0
SOURCE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
while (($#)); do
  case "$1" in
    --full) FULL=1 ;;
    --source-commit) shift; SOURCE_COMMIT="${1:?--source-commit requires a commit}" ;;
    --help|-h) printf '%s\n' 'Usage: scripts/test-fresh-clone-readiness.sh [--full] [--source-commit COMMIT]'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

cd "$ROOT_DIR"
if [[ -n "$(git status --short --untracked-files=all)" && "${ALLOW_DIRTY_FRESH_CLONE:-0}" != 1 ]]; then
  printf '%s\n' 'Fresh clone rehearsal requires a clean worktree; commit tracked source first.' >&2
  exit 2
fi
git cat-file -e "$SOURCE_COMMIT^{commit}"

clone_root="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-fresh-clone.XXXXXX")"
cleanup() { rm -rf "$clone_root"; }
trap cleanup EXIT
clone="$clone_root/repo"
mkdir -p "$clone"
git archive --format=tar "$SOURCE_COMMIT" | tar -xf - -C "$clone"

required=(
  scripts/secrets-inventory.sh
  scripts/export-skuld-secrets.sh
  scripts/import-skuld-secrets.sh
  scripts/storage-health.sh
  scripts/storage-maintenance.sh
  scripts/backup.sh
  scripts/test-fresh-clone-readiness.sh
)
for path in "${required[@]}"; do
  [[ -f "$clone/$path" ]] || { printf 'FRESH_CLONE_MISSING=%s\n' "$path" >&2; exit 1; }
done
for forbidden in .env infra/host-profile.env node_modules .pnpm-store; do
  [[ ! -e "$clone/$forbidden" ]] || { printf 'FRESH_CLONE_FORBIDDEN_PATH=%s\n' "$forbidden" >&2; exit 1; }
done
if find "$clone" -type f \( -name '*.secret' -o -name '*.token' -o -name '*.pem' -o -name '*.sqlite' -o -name '*.db' \) -print -quit | grep -q .; then
  printf '%s\n' 'FRESH_CLONE_FORBIDDEN_RUNTIME_OR_SECRET_ARTIFACT=present' >&2
  exit 1
fi

export AMADEUS_FRESH_CLONE_REHEARSAL=1
export ARCHITECTURE_ROOT="$clone"
"$clone/scripts/run-check.sh" 'fresh-clone architecture' node "$clone/scripts/check-architecture.mjs"
for script in \
  scripts/secrets-inventory.sh scripts/export-skuld-secrets.sh scripts/import-skuld-secrets.sh \
  scripts/storage-health.sh scripts/storage-maintenance.sh scripts/backup.sh scripts/migration-readiness.sh; do
  bash -n "$clone/$script"
done
printf '%s\n' 'FRESH_CLONE_TRACKED_SOURCE=passed'
printf '%s\n' 'FRESH_CLONE_NON_RECURSIVE=passed'

if ((FULL)); then
  "$clone/scripts/run-check.sh" 'fresh-clone pnpm install' pnpm --dir "$clone" install --frozen-lockfile
  # Workspace package exports point at dist; build the fresh source tree before running tests.
  "$clone/scripts/run-check.sh" 'fresh-clone build' pnpm --dir "$clone" build
  "$clone/scripts/run-check.sh" 'fresh-clone test' pnpm --dir "$clone" test
  "$clone/scripts/run-check.sh" 'fresh-clone typecheck' pnpm --dir "$clone" typecheck
  "$clone/scripts/run-check.sh" 'fresh-clone secret scan' pnpm --dir "$clone" check:secrets
fi
printf '%s\n' "FRESH_CLONE_REHEARSAL=$([[ $FULL -eq 1 ]] && echo full-passed || echo fixture-passed)"
