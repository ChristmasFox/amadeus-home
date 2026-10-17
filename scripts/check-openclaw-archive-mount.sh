#!/usr/bin/env bash
# Read-only check that the running OpenClaw container archives PUBG telemetry into the configured host directory.
#
# A container recreated without PUBG_TELEMETRY_ARCHIVE_HOST_DIR silently falls back to an empty, root-owned directory
# inside the OrbStack machine; every hourly prefetch then fails the archive's own owner check
# (telemetry_archive_owner_invalid) while the cron job still reports "ok". This script fails loudly instead.
#
#   check-openclaw-archive-mount.sh [--machine NAME] [--expect HOST_DIR]
#
# Passes only when all of these hold:
#   1. the container's bind source for /var/lib/amadeus/pubg-telemetry-archive equals the configured host directory and is writable
#   2. the node user owns the mount root (the same uid check RawTelemetryArchive.ensureRoot makes) and can read and write every entry
#   3. the container sees as many archive entries as the host directory holds
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/host-profile.sh
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

MACHINE="$ORBSTACK_MACHINE"
EXPECT="$PUBG_TELEMETRY_ARCHIVE_HOST_DIR"
TARGET=/var/lib/amadeus/pubg-telemetry-archive

while (($#)); do
  case "$1" in
    --machine) MACHINE="${2:?--machine needs a name}"; shift 2 ;;
    --expect) EXPECT="${2:?--expect needs a directory}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

fail() { printf 'PUBG_TELEMETRY_ARCHIVE_MOUNT=failed reason=%s\n' "$1" >&2; exit 1; }

mount_info="$(orb -m "$MACHINE" -u root docker inspect openclaw \
  --format "{{range .Mounts}}{{if eq .Destination \"$TARGET\"}}{{.Source}}|{{.RW}}{{end}}{{end}}" 2>/dev/null || true)"
[[ -n "$mount_info" ]] || fail "openclaw has no mount at $TARGET"
[[ "$mount_info" == "$EXPECT|true" ]] \
  || fail "mount_source_mismatch actual=${mount_info%%|*} rw=${mount_info##*|} expected=$EXPECT"

container_report="$(orb -m "$MACHINE" -u root docker exec --user node openclaw node -e '
const fs = require("node:fs"), path = require("node:path"), root = "/var/lib/amadeus/pubg-telemetry-archive";
const info = fs.lstatSync(root);
if (!info.isDirectory() || info.isSymbolicLink()) { console.error("root_not_a_directory"); process.exit(3); }
if (info.uid !== process.getuid()) { console.error("owner_invalid root_uid=" + info.uid + " node_uid=" + process.getuid()); process.exit(4); }
function walk(dir) {
  fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  for (const name of fs.readdirSync(dir)) {
    const child = path.join(dir, name), stat = fs.lstatSync(child);
    if (stat.isSymbolicLink()) throw Error("archive_symlink");
    if (stat.isDirectory()) walk(child); else fs.accessSync(child, fs.constants.R_OK);
  }
}
walk(root);
console.log(fs.readdirSync(root).filter((name) => !name.startsWith(".")).length);
' 2>&1)" || fail "container_check $container_report"
container_entries="$(printf '%s' "$container_report" | tail -n1)"

host_entries="$(orb -m "$MACHINE" -u root sh -c 'ls -A "$1" | grep -v "^\\." | wc -l' _ "$EXPECT" | tr -d '[:space:]')"
[[ "$container_entries" == "$host_entries" ]] \
  || fail "entry_count_mismatch container=$container_entries host=$host_entries"

printf 'PUBG_TELEMETRY_ARCHIVE_MOUNT=passed source=%s entries=%s\n' "$EXPECT" "$container_entries"
