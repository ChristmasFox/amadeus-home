#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  exec bash "$ROOT_DIR/scripts/release-cli.sh" lab plan --help
fi
exec bash "$ROOT_DIR/scripts/release-cli.sh" lab "$@"
