#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT=''
MANIFEST=''
PASSPHRASE_FILE=''
SECRET_ARTIFACT=''
SECRET_MANIFEST=''
usage() {
  printf '%s\n' 'Usage: scripts/verify-openclaw-cold-snapshot.sh --artifact FILE --manifest FILE --passphrase-file FILE --secret-artifact FILE --secret-manifest FILE'
}
while (($#)); do
  case "$1" in
    --artifact) shift; ARTIFACT="${1:?--artifact requires a file}" ;;
    --manifest) shift; MANIFEST="${1:?--manifest requires a file}" ;;
    --passphrase-file) shift; PASSPHRASE_FILE="${1:?--passphrase-file requires a file}" ;;
    --secret-artifact) shift; SECRET_ARTIFACT="${1:?--secret-artifact requires a file}" ;;
    --secret-manifest) shift; SECRET_MANIFEST="${1:?--secret-manifest requires a file}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
for file in "$ARTIFACT" "$MANIFEST" "$PASSPHRASE_FILE" "$SECRET_ARTIFACT" "$SECRET_MANIFEST"; do
  [[ -n "$file" && -f "$file" && ! -L "$file" ]] || { printf '%s\n' 'Snapshot verification input is missing or symlinked.' >&2; exit 2; }
done
python3 "$ROOT_DIR/scripts/openclaw_continuity.py" verify-snapshot \
  --artifact "$ARTIFACT" --manifest "$MANIFEST" --passphrase-file "$PASSPHRASE_FILE" \
  --secret-artifact "$SECRET_ARTIFACT" --secret-manifest "$SECRET_MANIFEST"
