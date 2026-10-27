#!/usr/bin/env bash
# Keeps a checkout's installed dependencies in step with its pnpm-lock.yaml / package.json files.
#
# Whatever runs out of a checkout (the Intelligence Lab LaunchAgent from the main worktree, the release worktree's
# build/test step) needs node_modules that match the lockfile of the commit that is checked out. A dependency change
# that nobody installed shows up as ERR_MODULE_NOT_FOUND and the service answers 502. This script installs exactly
# when something changed: it fingerprints pnpm-lock.yaml, pnpm-workspace.yaml and every tracked package.json, compares
# with the fingerprint of the last successful install (node_modules/.amadeus-deps-stamp) and, only when they differ
# (or node_modules is missing), runs `pnpm install --frozen-lockfile`.
#
#   scripts/sync-main-deps.sh [--restart LAUNCHAGENT_LABEL]... [ROOT]
#
# Prints DEPS_SYNC=up_to_date | installed; exits non-zero when the install fails (the stamp is then left alone, so
# the next call tries again). With --restart, each given LaunchAgent is kickstarted after a successful install.
set -euo pipefail

PNPM_BIN="${PNPM_BIN:-pnpm}"
LAUNCHCTL_BIN="${LAUNCHCTL_BIN:-launchctl}"
export PATH="$HOME/Library/pnpm:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

restart_labels=()
root=""
while (($#)); do
  case "$1" in
    --restart) restart_labels+=("${2:?--restart needs a LaunchAgent label}"); shift 2 ;;
    -*) echo "unknown option: $1" >&2; exit 64 ;;
    *) root="$1"; shift ;;
  esac
done
root="${root:-$(cd "$(dirname "$0")/.." && pwd)}"
[[ -f "$root/pnpm-lock.yaml" ]] || { echo "DEPS_SYNC=skipped (no pnpm-lock.yaml in $root)"; exit 0; }

stamp="$root/node_modules/.amadeus-deps-stamp"
fingerprint() {
  (
    cd "$root"
    { git ls-files -z -- pnpm-lock.yaml pnpm-workspace.yaml '*package.json' 2>/dev/null || true; } \
      | xargs -0 shasum -a 256 2>/dev/null | shasum -a 256 | cut -d' ' -f1
  )
}

lock_dir="$root/node_modules/.amadeus-deps-lock"
mkdir -p "$root/node_modules"
waited=0
until mkdir "$lock_dir" 2>/dev/null; do
  # A lock older than 30 minutes belongs to a run that died.
  if [[ -n "$(find "$lock_dir" -maxdepth 0 -mmin +30 2>/dev/null)" ]]; then rmdir "$lock_dir" 2>/dev/null || true; continue; fi
  ((waited >= 600)) && { echo "DEPS_SYNC=error (another install holds the lock)" >&2; exit 75; }
  sleep 2; waited=$((waited + 2))
done
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

want="$(fingerprint)"
have="$(cat "$stamp" 2>/dev/null || true)"
if [[ -n "$have" && "$want" == "$have" && -d "$root/node_modules/.pnpm" ]]; then
  echo "DEPS_SYNC=up_to_date root=$root"
  exit 0
fi

echo "DEPS_SYNC=installing root=$root"
(cd "$root" && "$PNPM_BIN" install --frozen-lockfile)
printf '%s\n' "$want" > "$stamp"
echo "DEPS_SYNC=installed root=$root"
for label in "${restart_labels[@]:-}"; do
  [[ -n "$label" ]] || continue
  "$LAUNCHCTL_BIN" kickstart -k "gui/$(id -u)/$label" >/dev/null 2>&1 \
    && echo "DEPS_SYNC_RESTARTED=$label" || echo "DEPS_SYNC_RESTART_FAILED=$label" >&2
done
