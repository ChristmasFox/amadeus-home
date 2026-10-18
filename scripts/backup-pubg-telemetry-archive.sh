#!/usr/bin/env bash
# Append-only backup of the raw PUBG telemetry archive. PUBG deletes telemetry about 14 days after a match, so this
# archive cannot be rebuilt once the Mac copy is lost; this copies it to a second disk.
#
#   backup-pubg-telemetry-archive.sh            dry run: shows what would be copied
#   backup-pubg-telemetry-archive.sh --apply    copies new files and verifies the result
#
# Nothing is ever deleted or overwritten on the target: payload files are content-addressed and copied only when
# absent, and manifests (which only grow) are refreshed when they change. The result is recorded in a small status
# file that the Intelligence Lab page shows, so a stalled backup does not go unnoticed.
set -euo pipefail

SOURCE="${PUBG_TELEMETRY_ARCHIVE_DIR:-$HOME/.local/share/amadeus/pubg-telemetry-archive}"
TARGET="${PUBG_TELEMETRY_ARCHIVE_BACKUP_DIR:-/Volumes/Avalon/backups/pubg-telemetry-archive}"
STATE_DIR="${PUBG_INTELLIGENCE_STATE_DIR:-$HOME/.local/share/amadeus/pubg-intelligence-lab}"
STATUS="$STATE_DIR/archive-backup.json"
APPLY=0
for argument in "$@"; do
  case "$argument" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    *) echo "unknown argument: $argument" >&2; exit 2 ;;
  esac
done

write_status() { # ok|skipped|failed, detail
  mkdir -p "$STATE_DIR"
  printf '{"ok":%s,"result":"%s","detail":"%s","at":"%s","matches":%s,"files":%s}\n' \
    "$([[ "$1" == ok ]] && echo true || echo false)" "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SOURCE_COUNT:-0}" "${SOURCE_FILES:-0}" > "$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}

[[ -d "$SOURCE" ]] || { echo "PUBG_ARCHIVE_BACKUP=failed reason=source_missing dir=$SOURCE" >&2; exit 1; }
SOURCE_COUNT="$(find "$SOURCE" -mindepth 1 -maxdepth 1 -type d ! -name .locks | wc -l | tr -d ' ')"
SOURCE_FILES="$(find "$SOURCE" -type f \( -name manifest.json -o -name '*.json.gz' \) | wc -l | tr -d ' ')"
echo "PUBG_ARCHIVE_SOURCE=$SOURCE matches=$SOURCE_COUNT files=$SOURCE_FILES size=$(du -sh "$SOURCE" | cut -f1)"
echo "PUBG_ARCHIVE_TARGET=$TARGET"

PARENT="$(dirname "$TARGET")"
if [[ ! -d "$PARENT" || ! -w "$PARENT" ]]; then
  echo "PUBG_ARCHIVE_BACKUP=skipped reason=target_unavailable (is the backup disk mounted?)"
  (( APPLY == 1 )) && write_status skipped target_unavailable
  exit 0
fi

# Payloads: copy only what is absent. Manifests: refresh when changed. No --delete anywhere.
RSYNC=(rsync -a --exclude=.locks)
PAYLOAD_RULES=(--include='*/' --include='*.json.gz' --exclude='*')
MANIFEST_RULES=(--include='*/' --include='manifest.json' --exclude='*')
if (( APPLY == 0 )); then
  NEW="$("${RSYNC[@]}" --dry-run --ignore-existing --itemize-changes "${PAYLOAD_RULES[@]}" "$SOURCE/" "$TARGET/" 2>/dev/null | grep -c '^>f' || true)"
  CHANGED="$("${RSYNC[@]}" --dry-run --itemize-changes "${MANIFEST_RULES[@]}" "$SOURCE/" "$TARGET/" 2>/dev/null | grep -c '^>f' || true)"
  echo "PUBG_ARCHIVE_BACKUP=dry_run payloads_to_copy=$NEW manifests_to_update=$CHANGED"
  echo 'Dry run only. Pass --apply to copy.'
  exit 0
fi

mkdir -p "$TARGET"
"${RSYNC[@]}" --ignore-existing "${PAYLOAD_RULES[@]}" "$SOURCE/" "$TARGET/"
"${RSYNC[@]}" "${MANIFEST_RULES[@]}" "$SOURCE/" "$TARGET/"

# Verify: every source file exists on the target with the same size.
MISSING=0
while IFS= read -r file; do
  relative="${file#"$SOURCE"/}"
  if [[ ! -f "$TARGET/$relative" ]] || [[ "$(stat -f %z "$file")" != "$(stat -f %z "$TARGET/$relative")" ]]; then
    echo "PUBG_ARCHIVE_BACKUP_MISMATCH=$relative" >&2
    MISSING=$((MISSING + 1))
  fi
done < <(find "$SOURCE" -type f \( -name manifest.json -o -name '*.json.gz' \))
if (( MISSING > 0 )); then
  write_status failed "mismatch_$MISSING"
  echo "PUBG_ARCHIVE_BACKUP=failed mismatches=$MISSING" >&2
  exit 1
fi
write_status ok verified
echo "PUBG_ARCHIVE_BACKUP=verified matches=$SOURCE_COUNT files=$SOURCE_FILES"
