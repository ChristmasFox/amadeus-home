#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/openclaw-secret-state-test.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

source_dir="$fixture/source"
credential_file="$source_dir/DATA/AppData/openclaw/config/credentials/whatsapp/secondary/session-private-recipient.json"
mkdir -p "$(dirname -- "$credential_file")"
printf '%s\n' 'fixture credential state; never a production credential' > "$credential_file"
chmod 600 "$credential_file"
passphrase_file="$fixture/passphrase"
printf '%s\n' 'temporary-fixture-passphrase-only' > "$passphrase_file"
chmod 600 "$passphrase_file"

output="$(SKULD_SECRET_TEST_MODE=1 SKULD_SECRET_SOURCE_DIR="$source_dir" \
  bash "$ROOT_DIR/scripts/export-skuld-secrets.sh" --apply \
    --passphrase-file "$passphrase_file" --output-dir "$fixture/bundles")"
bundle_dir="$(printf '%s\n' "$output" | sed -n 's/^SECRET_BUNDLE_PLAN=//p')"
bundle="$(printf '%s\n' "$output" | sed -n 's/^SECRET_BUNDLE=//p')"
manifest="$(printf '%s\n' "$output" | sed -n 's/^SECRET_MANIFEST=//p')"
[[ -s "$bundle" && -s "$manifest" ]] || { printf '%s\n' 'bundle artifacts missing' >&2; exit 1; }

python3 - "$manifest" <<'PY'
import json, sys
from pathlib import Path
manifest = json.loads(Path(sys.argv[1]).read_text())
assert 'whatsapp-runtime-state' in manifest['logicalIds']
assert 'openclaw-runtime-credentials' in manifest['logicalIds']
assert manifest['plaintextTemporaryFiles'] is True
assert manifest['plaintextTemporaryFilesRemovedOnExit'] is True
assert manifest['temporaryStagingPermissions'] == '0700'
entries = [item for item in manifest['files'] if item.get('pathScope') == 'openclaw-runtime-credentials']
assert len(entries) == 1, entries
assert len(entries[0].get('pathSha256', '')) == 64
assert 'path' not in entries[0]
serialized = Path(sys.argv[1]).read_text()
assert 'session-private-recipient' not in serialized
assert 'fixture credential state' not in serialized
PY

tampered_bundle="$fixture/tampered.secrets.tar.enc"
cp "$bundle" "$tampered_bundle"
printf 'tamper' >> "$tampered_bundle"
if python3 "$ROOT_DIR/scripts/skuld_secret_bundle_auth.py" verify \
  --artifact "$tampered_bundle" --manifest "$manifest" --passphrase-file "$passphrase_file" >/dev/null 2>&1; then
  printf '%s\n' 'tampered encrypted bundle passed authentication' >&2
  exit 1
fi
tampered_manifest="$fixture/tampered.manifest.json"
python3 - "$manifest" "$tampered_manifest" <<'PY'
import json, sys
from pathlib import Path
value = json.loads(Path(sys.argv[1]).read_text())
value['logicalIds'].append('unapproved-change')
Path(sys.argv[2]).write_text(json.dumps(value))
PY
if python3 "$ROOT_DIR/scripts/skuld_secret_bundle_auth.py" verify \
  --artifact "$bundle" --manifest "$tampered_manifest" --passphrase-file "$passphrase_file" >/dev/null 2>&1; then
  printf '%s\n' 'tampered secret manifest passed authentication' >&2
  exit 1
fi

bash "$ROOT_DIR/scripts/import-skuld-secrets.sh" \
  --bundle "$bundle" --manifest "$manifest" --passphrase-file "$passphrase_file" \
  --expected-manifest "$ROOT_DIR/docs/OPERATION_SKULD_MIGRATION_MANIFEST.json" \
  | grep -Fxq 'SECRET_RESTORE_REHEARSAL=passed'

restore_output="$(bash "$ROOT_DIR/scripts/restore-skuld-secrets.sh" \
  --bundle "$bundle" --manifest "$manifest" --passphrase-file "$passphrase_file" --dry-run)"
printf '%s\n' "$restore_output" | grep -Fxq 'SECRET_RESTORE_PATH=dry-run-passed'

missing_source="$fixture/missing-source"
mkdir -p "$missing_source"
if SKULD_SECRET_TEST_MODE=1 SKULD_SECRET_SOURCE_DIR="$missing_source" \
  bash "$ROOT_DIR/scripts/export-skuld-secrets.sh" --apply \
    --passphrase-file "$passphrase_file" --output-dir "$fixture/missing-bundle" >/dev/null 2>&1; then
  printf '%s\n' 'missing WhatsApp runtime state must fail closed' >&2
  exit 1
fi

printf '%s\n' 'OPENCLAW_SECRET_BUNDLE_CREDENTIALS_TEST=passed'
