#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
VERSION_TOOL="$ROOT_DIR/scripts/amadeus-version.sh"

version="$(bash "$VERSION_TOOL" show)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
bash "$VERSION_TOOL" check >/dev/null
bash -n "$VERSION_TOOL"

test_root="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-version-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/scripts"
cp "$VERSION_TOOL" "$test_root/scripts/amadeus-version.sh"

write_fixture() {
  local fixture_version="$1"
  printf '%s\n' "$fixture_version" > "$test_root/VERSION"
  printf '# Amadeus %s\n修复内容\n' "$fixture_version" > "$test_root/RELEASE_NOTES.md"
}

write_fixture '0.0.8'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '0.0.9' ]]

write_fixture '0.0.9'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '0.1.0' ]]

write_fixture '0.1.9'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '0.2.0' ]]

write_fixture '0.9.9'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '0.10.0' ]]

write_fixture '0.10.9'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '0.11.0' ]]

write_fixture '0.98.9'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '0.99.0' ]]

write_fixture '0.99.9'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '1.0.0' ]]

write_fixture '1.4.0'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '1.4.1' ]]

write_fixture '1.4.9'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '1.5.0' ]]

write_fixture '1.99.9'
(cd "$test_root" && bash scripts/amadeus-version.sh bump patch >/dev/null)
[[ "$(<"$test_root/VERSION")" == '2.0.0' ]]

write_fixture '1.4.0'
printf '# Amadeus 1.4.0\nEnglish-only update.\n' > "$test_root/RELEASE_NOTES.md"
if (cd "$test_root" && bash scripts/amadeus-version.sh check >"$test_root/english.out" 2>"$test_root/english.err"); then
  printf '%s\n' 'English-only release notes unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'must include Chinese user-facing update content' "$test_root/english.err"

write_fixture '1.4.0'
if (cd "$test_root" && bash scripts/amadeus-version.sh bump minor >"$test_root/minor.out" 2>"$test_root/minor.err"); then
  printf '%s\n' 'bump minor unexpectedly succeeded' >&2
  exit 1
fi
minor_error="$(<"$test_root/minor.err")"
[[ "$minor_error" == *'Only bump patch is supported'* ]]

if (cd "$test_root" && bash scripts/amadeus-version.sh bump major >"$test_root/major.out" 2>"$test_root/major.err"); then
  printf '%s\n' 'bump major unexpectedly succeeded' >&2
  exit 1
fi
major_error="$(<"$test_root/major.err")"
[[ "$major_error" == *'Only bump patch is supported'* ]]

printf '%s\n' 'AMADEUS_VERSION_TEST=passed'
