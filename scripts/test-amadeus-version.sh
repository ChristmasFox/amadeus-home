#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
VERSION_TOOL="$ROOT_DIR/scripts/amadeus-version.sh"

version="$(bash "$VERSION_TOOL" show)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
bash "$VERSION_TOOL" check >/dev/null
bash -n "$VERSION_TOOL"
printf '%s\n' 'AMADEUS_VERSION_TEST=passed'
