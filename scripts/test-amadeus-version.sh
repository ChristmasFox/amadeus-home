#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
VERSION_TOOL="$ROOT_DIR/scripts/amadeus-version.sh"

version="$(bash "$VERSION_TOOL" show)"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
bash "$VERSION_TOOL" check >/dev/null
bash -n "$VERSION_TOOL"

test_root="$(mktemp -d "${TMPDIR:-/tmp}/lab-version-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/scripts"
cp "$VERSION_TOOL" "$test_root/scripts/amadeus-version.sh"

write_fixture() {
  local fixture_version="$1"
  printf '%s\n' "$fixture_version" > "$test_root/VERSION"
  printf '# Amadeus %s\n修复内容\n' "$fixture_version" > "$test_root/RELEASE_NOTES.md"
}

expect_bump() {
  local current="$1" kind="$2" expected="$3"
  write_fixture "$current"
  (cd "$test_root" && bash scripts/amadeus-version.sh bump "$kind" >/dev/null)
  [[ "$(<"$test_root/VERSION")" == "$expected" ]]
  local mode
  mode="$(python3 -c 'import os,stat,sys; print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))' "$test_root/VERSION")"
  [[ "$mode" == '0o644' ]]
}

expect_bump '0.0.8' patch '0.0.9'
# The patch digit carries at ten: .9 -> next minor .0, and legacy patches above 9 normalise the same way.
expect_bump '0.0.9' patch '0.1.0'
expect_bump '1.10.9' patch '1.11.0'
expect_bump '1.10.11' patch '1.11.0'
expect_bump '0.99.99' patch '0.100.0'
expect_bump '1.11.0' patch '1.11.1'
expect_bump '1.10.4' patch '1.10.5'
expect_bump '1.10.4' minor '1.11.0'
expect_bump '1.10.4' major '2.0.0'
expect_bump '0.99.99' minor '0.100.0'
expect_bump '0.99.99' major '1.0.0'

write_fixture '1.4.0'
printf '# Amadeus 1.4.0\nEnglish-only update.\n' > "$test_root/RELEASE_NOTES.md"
if (cd "$test_root" && bash scripts/amadeus-version.sh check >"$test_root/english.out" 2>"$test_root/english.err"); then
  printf '%s\n' 'English-only release notes unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'must include Chinese user-facing update content' "$test_root/english.err"

write_fixture '01.4.0'
if (cd "$test_root" && bash scripts/amadeus-version.sh check >"$test_root/invalid.out" 2>"$test_root/invalid.err"); then
  printf '%s\n' 'SemVer with a leading zero unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'Invalid Lab SemVer' "$test_root/invalid.err"

write_fixture '1.4.0'
if (cd "$test_root" && bash scripts/amadeus-version.sh bump prerelease >"$test_root/invalid-kind.out" 2>"$test_root/invalid-kind.err"); then
  printf '%s\n' 'Unsupported SemVer bump unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'Unsupported SemVer bump kind' "$test_root/invalid-kind.err"

printf '%s\n' 'LAB_VERSION_TEST=passed patch=4 minor=2 major=2 malformed=1'
