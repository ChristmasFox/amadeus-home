#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
VERSION_TOOL="$ROOT_DIR/scripts/pubg-saas-version.sh"
version="$(bash "$VERSION_TOOL" show)"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
bash "$VERSION_TOOL" check >/dev/null
bash -n "$VERSION_TOOL"

test_root="$(mktemp -d "${TMPDIR:-/tmp}/gate-version-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/scripts" "$test_root/apps/pubg-saas"
cp "$VERSION_TOOL" "$test_root/scripts/pubg-saas-version.sh"
cp "$ROOT_DIR/apps/pubg-saas/package.json" "$test_root/apps/pubg-saas/package.json"

write_fixture() {
  local fixture_version="$1"
  python3 - "$test_root/apps/pubg-saas/package.json" "$fixture_version" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
manifest = json.loads(path.read_text())
manifest["version"] = sys.argv[2]
path.write_text(json.dumps(manifest, indent=2) + "\n")
PY
  printf '# Gate %s\n版本行为符合独立 SemVer。\n' "$fixture_version" > "$test_root/apps/pubg-saas/RELEASE_NOTES.md"
}

expect_bump() {
  local current="$1" kind="$2" expected="$3"
  write_fixture "$current"
  (cd "$test_root" && bash scripts/pubg-saas-version.sh bump "$kind" >/dev/null)
  local actual mode
  actual="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$test_root/apps/pubg-saas/package.json")"
  [[ "$actual" == "$expected" ]]
  mode="$(python3 -c 'import os,stat,sys; print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))' "$test_root/apps/pubg-saas/package.json")"
  [[ "$mode" == '0o644' ]]
}

expect_bump '0.0.9' patch '0.0.10'
expect_bump '0.1.0' patch '0.1.1'
expect_bump '0.1.9' minor '0.2.0'
expect_bump '0.99.99' minor '0.100.0'
expect_bump '0.99.99' major '1.0.0'

write_fixture '01.0.0'
if (cd "$test_root" && bash scripts/pubg-saas-version.sh show >"$test_root/invalid.out" 2>"$test_root/invalid.err"); then
  printf '%s\n' 'Gate SemVer with a leading zero unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'Invalid Gate SemVer' "$test_root/invalid.err"

write_fixture '0.1.0'
printf '# Gate 0.1.0\n第一节\n\n# Gate 0.0.9\n旧版本\n' > "$test_root/apps/pubg-saas/RELEASE_NOTES.md"
if (cd "$test_root" && bash scripts/pubg-saas-version.sh check >"$test_root/duplicate.out" 2>"$test_root/duplicate.err"); then
  printf '%s\n' 'Multiple Gate release headings unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'must describe one version only' "$test_root/duplicate.err"

printf '%s\n' 'GATE_VERSION_TEST=passed patch=2 minor=2 major=1 malformed=1 notes=1'
