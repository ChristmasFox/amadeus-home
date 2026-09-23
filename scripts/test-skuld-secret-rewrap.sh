#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/skuld-secret-rewrap-test.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
source_dir="$fixture/source"
credential_rel='DATA/AppData/openclaw/config/credentials/whatsapp/secondary/session-private-recipient.json'
mkdir -p "$source_dir/$(dirname -- "$credential_rel")"
printf 'fixture-only credential state\n' > "$source_dir/$credential_rel"
chmod 600 "$source_dir/$credential_rel"
passphrase="$fixture/passphrase"
printf 'fixture-only-passphrase\n' > "$passphrase"
chmod 600 "$passphrase"

export_output="$(SKULD_SECRET_TEST_MODE=1 SKULD_SECRET_SOURCE_DIR="$source_dir" \
  bash "$ROOT_DIR/scripts/export-skuld-secrets.sh" --apply \
    --passphrase-file "$passphrase" --output-dir "$fixture/initial")"
current_bundle="$(printf '%s\n' "$export_output" | sed -n 's/^SECRET_BUNDLE=//p')"
current_manifest="$(printf '%s\n' "$export_output" | sed -n 's/^SECRET_MANIFEST=//p')"
legacy_dir="$fixture/legacy"
mkdir -m 700 "$legacy_dir"
legacy_bundle="$legacy_dir/secrets.tar.enc"
legacy_manifest="$legacy_dir/secrets.manifest.json"
cp "$current_bundle" "$legacy_bundle"
python3 - "$current_manifest" "$legacy_manifest" "$credential_rel" <<'PY'
import json, sys
from pathlib import Path
source, target = map(Path, sys.argv[1:3])
credential_path = sys.argv[3]
value = json.loads(source.read_text())
for entry in value['files']:
    if entry.get('pathScope') == 'openclaw-runtime-credentials':
        entry.pop('pathSha256', None)
        entry.pop('pathScope', None)
        entry['path'] = credential_path
value['plaintextTemporaryFiles'] = False
value.pop('plaintextTemporaryFilesRemovedOnExit', None)
value.pop('temporaryStagingPermissions', None)
value.pop('restorePolicy', None)
value.pop('createdAtUtc', None)
value.pop('authentication', None)
value.pop('manifestAuthentication', None)
value.pop('artifactSha256', None)
target.write_text(json.dumps(value, indent=2) + '\n')
PY
chmod 600 "$legacy_manifest"
shasum -a 256 "$legacy_bundle" | awk '{print $1 "  secrets.tar.enc"}' > "$legacy_bundle.sha256"
chmod 600 "$legacy_bundle.sha256"

legacy_bundle_sha="$(shasum -a 256 "$legacy_bundle" | awk '{print $1}')"
legacy_manifest_sha="$(shasum -a 256 "$legacy_manifest" | awk '{print $1}')"
if bash "$ROOT_DIR/scripts/verify-skuld-secret-bundle.sh" \
  --bundle "$legacy_bundle" --manifest "$legacy_manifest" --passphrase-file "$passphrase" >/dev/null 2>&1; then
  printf '%s\n' 'legacy bundle unexpectedly passed current verification' >&2
  exit 1
fi

plan_output="$(python3 "$ROOT_DIR/scripts/rewrap-skuld-secrets.py" \
  --bundle "$legacy_bundle" --manifest "$legacy_manifest" --passphrase-file "$passphrase" \
  --output-dir "$legacy_dir/planned")"
grep -Fq 'SECRET_REWRAP_MODE=plan' <<< "$plan_output"
[[ ! -e "$legacy_dir/planned" ]]

rewrap_output="$(python3 "$ROOT_DIR/scripts/rewrap-skuld-secrets.py" \
  --bundle "$legacy_bundle" --manifest "$legacy_manifest" --passphrase-file "$passphrase" \
  --output-dir "$legacy_dir/rewrapped" --apply)"
rewrapped_bundle="$(printf '%s\n' "$rewrap_output" | sed -n 's/^SECRET_BUNDLE=//p')"
rewrapped_manifest="$(printf '%s\n' "$rewrap_output" | sed -n 's/^SECRET_MANIFEST=//p')"
[[ -s "$rewrapped_bundle" && -s "$rewrapped_manifest" ]]
verify_output="$(bash "$ROOT_DIR/scripts/verify-skuld-secret-bundle.sh" \
  --bundle "$rewrapped_bundle" --manifest "$rewrapped_manifest" --passphrase-file "$passphrase")"
grep -Fxq 'SECRET_BUNDLE_VERIFICATION=passed' <<< "$verify_output"
[[ "$legacy_bundle_sha" == "$(shasum -a 256 "$legacy_bundle" | awk '{print $1}')" ]]
[[ "$legacy_manifest_sha" == "$(shasum -a 256 "$legacy_manifest" | awk '{print $1}')" ]]
grep -Fq 'LEGACY_SOURCE_PRESERVED=yes' <<< "$rewrap_output"

tampered="$legacy_dir/tampered.tar.enc"
cp "$legacy_bundle" "$tampered"
printf 'tamper' >> "$tampered"
cp "$legacy_manifest" "$legacy_dir/tampered.manifest.json"
cp "$legacy_bundle.sha256" "$tampered.sha256"
if python3 "$ROOT_DIR/scripts/rewrap-skuld-secrets.py" \
  --bundle "$tampered" --manifest "$legacy_dir/tampered.manifest.json" \
  --passphrase-file "$passphrase" --output-dir "$legacy_dir/tampered-output" --apply >/dev/null 2>&1; then
  printf '%s\n' 'tampered legacy bundle was accepted' >&2
  exit 1
fi
[[ ! -e "$legacy_dir/tampered-output" ]]

printf '%s\n' 'SKULD_SECRET_REWRAP_TEST=passed'
