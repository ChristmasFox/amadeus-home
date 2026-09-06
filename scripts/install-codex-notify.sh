#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
SOURCE_FILE="$ROOT_DIR/integrations/codex/codex-notify.sh"
INSTALL_DIR="${CODEX_NOTIFY_INSTALL_DIR:-$CODEX_HOME_DIR/bin}"
TARGET_FILE="$INSTALL_DIR/codex-notify.sh"
CONFIG_FILE="${CODEX_CONFIG_FILE:-$CODEX_HOME_DIR/config.toml}"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/install-codex-notify.sh [--dry-run] [--apply]

Install the Git-owned Codex completion script into the global CODEX_HOME/bin
folder and update only the global CODEX_HOME/config.toml notify entry. It never
writes a project-level config and never writes a secret. Default is dry-run.
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --codex-home)
      (($# >= 2)) || { echo '--codex-home requires a path.' >&2; exit 2; }
      CODEX_HOME_DIR="$2"
      INSTALL_DIR="${CODEX_NOTIFY_INSTALL_DIR:-$CODEX_HOME_DIR/bin}"
      CONFIG_FILE="${CODEX_CONFIG_FILE:-$CODEX_HOME_DIR/config.toml}"
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ -f "$SOURCE_FILE" ]] || { echo "Source script missing: $SOURCE_FILE" >&2; exit 1; }
printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'CODEX_CONFIG=%s\n' "$CONFIG_FILE"
printf 'NOTIFY_SCRIPT=%s\n' "$TARGET_FILE"
printf '%s\n' 'PLAN=copy global script and set the global notify command; no secret is written.'

if ((APPLY == 0)); then
  exit 0
fi

mkdir -p "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR"
install -m 700 "$SOURCE_FILE" "$TARGET_FILE"

python3 - "$CONFIG_FILE" "$TARGET_FILE" <<'PY'
from pathlib import Path
import json
import os
import re
import sys

config = Path(sys.argv[1])
target = Path(sys.argv[2])
config.parent.mkdir(parents=True, exist_ok=True)
text = config.read_text() if config.exists() else ''
lines = text.splitlines()
notify_line = 'notify = ["zsh", ' + json.dumps(str(target)) + ']'
found = False
for index, line in enumerate(lines):
    if re.match(r'^notify\s*=', line):
        lines[index] = notify_line
        found = True
        break
if not found:
    insertion = next((index for index, line in enumerate(lines) if line.startswith('[')), len(lines))
    lines.insert(insertion, notify_line)
config.write_text('\n'.join(lines).rstrip() + '\n')
os.chmod(config, 0o600)
PY

cmp -s "$SOURCE_FILE" "$TARGET_FILE"
grep -F "notify = [\"zsh\", \"$TARGET_FILE\"]" "$CONFIG_FILE" >/dev/null
printf '%s\n' 'Global Codex notify installation passed; config and script paths updated, no secret written.'
