#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE=''
MANIFEST=''
PASSPHRASE_FILE=''
EXPECTED_MANIFEST="$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json"

while (($#)); do
  case "$1" in
    --bundle) shift; BUNDLE="${1:?--bundle requires a path}" ;;
    --manifest) shift; MANIFEST="${1:?--manifest requires a path}" ;;
    --passphrase-file) shift; PASSPHRASE_FILE="${1:?--passphrase-file requires a path}" ;;
    --expected-manifest) shift; EXPECTED_MANIFEST="${1:?--expected-manifest requires a path}" ;;
    --help|-h)
      printf '%s\n' 'Usage: scripts/verify-skuld-secret-bundle.sh --bundle FILE --manifest FILE --passphrase-file FILE [--expected-manifest FILE]'
      exit 0
      ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

[[ -s "$BUNDLE" && -s "$MANIFEST" && -s "$PASSPHRASE_FILE" && -s "$EXPECTED_MANIFEST" ]] || {
  printf '%s\n' 'Bundle, manifest, passphrase, and expected migration manifest are required.' >&2
  exit 2
}

if ! bash "$ROOT_DIR/scripts/import-skuld-secrets.sh" \
  --bundle "$BUNDLE" --manifest "$MANIFEST" --passphrase-file "$PASSPHRASE_FILE" \
  --expected-manifest "$EXPECTED_MANIFEST" >/dev/null 2>&1; then
  printf '%s\n' 'SECRET_BUNDLE_IMPORT=blocked' >&2
  exit 1
fi

if ! bash "$ROOT_DIR/scripts/restore-skuld-secrets.sh" \
  --bundle "$BUNDLE" --manifest "$MANIFEST" --passphrase-file "$PASSPHRASE_FILE" \
  --dry-run >/dev/null 2>&1; then
  printf '%s\n' 'SECRET_BUNDLE_RESTORE_DRY_RUN=blocked' >&2
  exit 1
fi

printf '%s\n' 'SECRET_BUNDLE_IMPORT=passed' 'SECRET_BUNDLE_RESTORE_DRY_RUN=passed' 'SECRET_BUNDLE_VERIFICATION=passed'
