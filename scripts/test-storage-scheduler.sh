#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/storage-scheduler.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
fake_bin="$fixture/bin"; mkdir -p "$fake_bin" "$fixture/home/Library/LaunchAgents"
cat >"$fake_bin/launchctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in print) exit 0;; bootout|bootstrap) exit 0;; *) exit 0;; esac
SH
cat >"$fake_bin/plutil" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == -lint ]]
SH
chmod 755 "$fake_bin/launchctl" "$fake_bin/plutil"
export PATH="$fake_bin:$PATH" HOME="$fixture/home" AMADEUS_HOST_PROFILE="$fixture/profile"
printf '%s\n' 'ORBSTACK_MACHINE=fixture' 'OPENCLAW_DATA_DIR='"$fixture"'/openclaw' 'SKULD_BACKUP_ROOT='"$fixture"'/backup' >"$AMADEUS_HOST_PROFILE"
mkdir -p "$fixture/openclaw/data" "$fixture/backup"
bash "$ROOT_DIR/scripts/install-storage-scheduler-macos.sh" --apply >/dev/null
health_plist="$HOME/Library/LaunchAgents/com.amadeus.storage-health.plist"
maintenance_plist="$HOME/Library/LaunchAgents/com.amadeus.storage-maintenance.plist"
grep -Fq -- '--scheduled' "$maintenance_plist"
grep -Fq 'storage-health.sh' "$health_plist"
health_target="$fixture/targets.json"
printf '%s\n' '[{"id":"mac_internal_root","totalBytes":100,"freeBytes":60,"usedBytes":40,"freePercent":60,"usedPercent":40},{"id":"external_storage","totalBytes":100,"freeBytes":60,"usedBytes":40,"freePercent":60,"usedPercent":40},{"id":"guest_root","totalBytes":100,"freeBytes":60,"usedBytes":40,"freePercent":60,"usedPercent":40},{"id":"guest_data","totalBytes":100,"freeBytes":60,"usedBytes":40,"freePercent":60,"usedPercent":40}]' >"$health_target"
STORAGE_HEALTH_TEST_MODE=1 STORAGE_HEALTH_TARGETS_FILE="$health_target" STORAGE_HEALTH_STATE_FILE="$fixture/openclaw/data/storage-health-state.json" STORAGE_GROWTH_HISTORY_FILE="$fixture/openclaw/data/storage-growth-history.jsonl" bash "$ROOT_DIR/scripts/storage-health.sh" >/dev/null
[[ -s "$fixture/openclaw/data/storage-health-state.json" ]]
printf '%s\n' 'fixture-running-current|current|running|running' >"$fixture/images.txt"
STORAGE_MAINTENANCE_TEST_MODE=1 STORAGE_IMAGE_INVENTORY_FILE="$fixture/images.txt" bash "$ROOT_DIR/scripts/storage-maintenance.sh" --scheduled >"$fixture/maintenance.out"
grep -Fq 'PROTECTED_IMAGE_SET=' "$fixture/maintenance.out"
bash "$ROOT_DIR/scripts/install-storage-scheduler-macos.sh" --check >/dev/null
printf '%s\n' 'STORAGE_SCHEDULER_FIXTURE=passed'
