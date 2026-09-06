#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_FILE="$ROOT_DIR/integrations/langbot/plugins/macos-nas-control/nas-control.sh"
TARGET_FILE="${NAS_CONTROL_TARGET:-$HOME/.local/bin/nas-control}"
BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-nas-control.sh [--dry-run] [--apply] [--target PATH]

Install the Git-owned macOS NAS forced-command script. The default is a
non-mutating dry-run. --apply creates a timestamped .codex-backup next to an
existing target, installs the script with mode 0700, validates zsh syntax, and
runs the allowlisted nas.status smoke test.
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --target)
      (($# >= 2)) || { echo '--target requires a path.' >&2; exit 2; }
      TARGET_FILE="$2"
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ -f "$SOURCE_FILE" ]] || { echo "Source script missing: $SOURCE_FILE" >&2; exit 1; }
printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'SOURCE=%s\n' "$SOURCE_FILE"
printf 'TARGET=%s\n' "$TARGET_FILE"
printf '%s\n' 'PLAN=install Git-owned nas-control, preserve a timestamped rollback backup, syntax-check, and run SSH_ORIGINAL_COMMAND=nas.status smoke.'

if ((APPLY == 0)); then
  exit 0
fi

mkdir -p "$(dirname "$TARGET_FILE")"
if [[ -e "$TARGET_FILE" || -L "$TARGET_FILE" ]]; then
  backup_file="${TARGET_FILE}.codex-backup.${BACKUP_STAMP}"
  cp -p "$TARGET_FILE" "$backup_file"
  printf 'ROLLBACK_BACKUP=%s\n' "$backup_file"
fi
install -m 700 "$SOURCE_FILE" "$TARGET_FILE"
zsh -n "$TARGET_FILE"
status_output="$(SSH_ORIGINAL_COMMAND=nas.status "$TARGET_FILE")"
printf '%s\n' "$status_output" | grep -F 'NAS_STATUS_VERSION=2' >/dev/null
printf '%s\n' "$status_output" | grep -F 'DISK_ROOT=' >/dev/null
printf '%s\n' "$status_output" | grep -F 'DISK_AVALON=' >/dev/null
cmp -s "$SOURCE_FILE" "$TARGET_FILE"
printf '%s\n' 'macOS NAS control deployment and nas.status smoke test passed.'
