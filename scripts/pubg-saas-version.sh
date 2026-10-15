#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PACKAGE_FILE="$ROOT_DIR/apps/pubg-saas/package.json"
RELEASE_NOTES_FILE="$ROOT_DIR/apps/pubg-saas/RELEASE_NOTES.md"

fail() {
  printf '%s\n' "$*" >&2
  exit 2
}

read_version() {
  [[ -f "$PACKAGE_FILE" ]] || fail "Missing Gate package manifest: $PACKAGE_FILE"
  python3 - "$PACKAGE_FILE" <<'PY'
import json
import re
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
version = manifest.get("version")
if not isinstance(version, str) or not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version):
    raise SystemExit("Invalid Gate SemVer in apps/pubg-saas/package.json")
print(version)
PY
}

validate_release_notes() {
  local version="$1"
  [[ -f "$RELEASE_NOTES_FILE" ]] || fail "Missing Gate release notes: $RELEASE_NOTES_FILE"
  python3 - "$version" "$RELEASE_NOTES_FILE" <<'PY'
from pathlib import Path
import sys

version, filename = sys.argv[1:]
lines = Path(filename).read_text(encoding="utf-8").splitlines()
expected = f"# Gate {version}"
if not lines or lines[0].strip() != expected:
    raise SystemExit(f"Gate release notes must start with: {expected}")
if sum(line.startswith("# Gate ") for line in lines) != 1:
    raise SystemExit("Gate release notes must describe one version only")
if not "\n".join(lines[1:]).strip():
    raise SystemExit("Gate release notes body must not be empty")
PY
}

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/pubg-saas-version.sh show
  ./scripts/pubg-saas-version.sh check
  ./scripts/pubg-saas-version.sh notes
  ./scripts/pubg-saas-version.sh bump patch|minor|major

Version policy:
  Gate reads its product version from apps/pubg-saas/package.json and uses
  standard SemVer increments. Formal Gate tags use gate/vX.Y.Z. Git-SHA and
  image-digest candidates are not formal releases.
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
    printf 'GATE_VERSION=%s\nGATE_RELEASE_NOTES=valid\n' "$version"
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
    python3 - "$PACKAGE_FILE" "$next_version" <<'PY'
import json
import os
import stat
import sys
import tempfile
from pathlib import Path

target = Path(sys.argv[1])
next_version = sys.argv[2]
manifest = json.loads(target.read_text(encoding="utf-8"))
manifest["version"] = next_version
mode = stat.S_IMODE(target.stat().st_mode)
descriptor, temporary = tempfile.mkstemp(prefix=".gate-version-", dir=target.parent)
try:
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, mode)
    os.replace(temporary, target)
except BaseException:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    raise
PY
    printf 'GATE_VERSION=%s\n' "$next_version"
    printf '%s\n' 'NEXT=replace apps/pubg-saas/RELEASE_NOTES.md with this Gate release only, then run check.'
    ;;
  help|--help|-h|'')
    usage
    ;;
  *)
    fail "Unknown command: $command"
    ;;
esac
