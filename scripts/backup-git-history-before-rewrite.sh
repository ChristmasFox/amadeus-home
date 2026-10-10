#!/usr/bin/env bash
# Safe local Git bundle backup; no checkout reset, force push, or service action.
set -Eeuo pipefail
if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo 'ERROR: run inside the local amadeus-home repository' >&2
  exit 2
fi
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'ERROR: working tree not clean. Save uncommitted changes before making a history bundle.' >&2
  exit 2
fi
origin="$(git remote get-url origin)"
if [[ "$origin" != *ChristmasFox/amadeus-home* ]]; then
  echo 'ERROR: origin is not the expected repository' >&2
  exit 2
fi
umask 077
OUT_DIR="${AMADEUS_HISTORY_BACKUP_DIR:-$HOME/Amadeus-private-backups/git-history-$(date +%Y%m%d-%H%M%S)}"
if [[ -e "$OUT_DIR" ]]; then
  echo 'ERROR: refusing to reuse an existing backup path' >&2
  exit 2
fi
mkdir -p -m 700 -- "$OUT_DIR"
echo 'Fetching remote refs (no force push, services unchanged)...'
git fetch --all --tags
BUNDLE="$OUT_DIR/amadeus-unredacted-before-rewrite.bundle"
git bundle create "$BUNDLE" --all
git bundle verify "$BUNDLE" >/dev/null
git show-ref > "$OUT_DIR/references-before-rewrite.txt"
chmod 600 "$BUNDLE" "$OUT_DIR/references-before-rewrite.txt"
echo 'PRIVATE_FULL_HISTORY_BUNDLE=VERIFIED'
echo "PRIVATE_BUNDLE_DIR=$OUT_DIR"
echo 'Contains unredacted history; do not commit or share.'
