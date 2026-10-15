#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"
RELEASE_NOTES_FILE="$ROOT_DIR/RELEASE_NOTES.md"

fail() {
  printf '%s\n' "$*" >&2
  exit 2
}

read_version() {
  [[ -f "$VERSION_FILE" ]] || fail "Missing version file: $VERSION_FILE"
  local value
  value="$(tr -d '[:space:]' < "$VERSION_FILE")"
  [[ "$value" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail "Invalid Lab SemVer: $value"
  printf '%s\n' "$value"
}

validate_release_notes() {
  local version="$1"
  [[ -f "$RELEASE_NOTES_FILE" ]] || fail "Missing release notes: $RELEASE_NOTES_FILE"
  python3 - "$version" "$RELEASE_NOTES_FILE" <<'PY'
from pathlib import Path
import sys

version, filename = sys.argv[1:]
text = Path(filename).read_text(encoding="utf-8")
lines = text.splitlines()
expected = f"# Amadeus {version}"
if not lines or lines[0].strip() != expected:
    raise SystemExit(f"Release notes must start with: {expected}")
headings = [line for line in lines if line.startswith("# Amadeus ")]
if len(headings) != 1:
    raise SystemExit("Release notes must describe one release only; do not append prior release entries")
body = "\n".join(lines[1:]).strip()
if not body:
    raise SystemExit("Release notes body must not be empty")
if not any("\u4e00" <= char <= "\u9fff" for char in body):
    raise SystemExit("Release notes must include Chinese user-facing update content")
if "openclaw" in body.lower():
    raise SystemExit("Release notes must not mention OpenClaw")
PY
}

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/amadeus-version.sh show
  ./scripts/amadeus-version.sh check
  ./scripts/amadeus-version.sh notes
  ./scripts/amadeus-version.sh bump patch
  ./scripts/amadeus-version.sh bump minor
  ./scripts/amadeus-version.sh bump major

Version policy:
  VERSION is the Lab product version. It follows standard SemVer increments:
  patch increments the patch component; minor increments minor and resets
  patch; major increments major and resets minor and patch.

After bumping, replace the first line and body of RELEASE_NOTES.md before a
formal Lab release. The body is one release summary in Chinese; do not append
prior release notes or repeat unchanged capabilities. Historical vX.Y.Z tags
remain intact; new formal Lab tags use lab/vX.Y.Z.
USAGE
}

version="$(read_version)"
command="${1:-}"

case "$command" in
  show)
    printf '%s\n' "$version"
    ;;
  check)
    validate_release_notes "$version"
    printf 'VERSION=%s\nRELEASE_NOTES=valid\n' "$version"
    ;;
  notes)
    validate_release_notes "$version"
    python3 - "$RELEASE_NOTES_FILE" <<'PY'
from pathlib import Path
import sys

lines = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
print("\n".join(lines[1:]).strip())
PY
  ;;
  bump)
    [[ $# -eq 2 ]] || fail 'bump requires exactly one kind: patch, minor, or major'
    kind="$2"
    [[ "$kind" == patch || "$kind" == minor || "$kind" == major ]] || fail "Unsupported SemVer bump kind (received: $kind)"
    IFS=. read -r major minor patch <<< "$version"
    if [[ "$kind" == major ]]; then
      major=$((major + 1))
      minor=0
      patch=0
    elif [[ "$kind" == minor ]]; then
      minor=$((minor + 1))
      patch=0
    else
      patch=$((patch + 1))
    fi
    next_version="$major.$minor.$patch"
    temporary="$(mktemp "$ROOT_DIR/.amadeus-version.XXXXXX")"
    trap 'rm -f "$temporary"' EXIT
    printf '%s\n' "$next_version" > "$temporary"
    chmod 0644 "$temporary"
    mv "$temporary" "$VERSION_FILE"
    trap - EXIT
    printf 'VERSION=%s\n' "$next_version"
    printf '%s\n' 'NEXT=replace RELEASE_NOTES.md with this Lab release only, then run check.'
    ;;
  help|--help|-h|'')
    usage
    ;;
  *)
    fail "Unknown command: $command"
    ;;
esac
