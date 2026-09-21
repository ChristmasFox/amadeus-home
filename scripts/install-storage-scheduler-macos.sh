#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MODE='check'
LAUNCH_DIR="$HOME/Library/LaunchAgents"
HEALTH_LABEL='com.amadeus.storage-health'
MAINTENANCE_LABEL='com.amadeus.storage-maintenance'

while (($#)); do
  case "$1" in
    --check|--apply|--uninstall) MODE="${1#--}" ;;
    --help|-h) printf '%s\n' 'Usage: scripts/install-storage-scheduler-macos.sh --check|--apply|--uninstall'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

health_plist="$LAUNCH_DIR/$HEALTH_LABEL.plist"
maintenance_plist="$LAUNCH_DIR/$MAINTENANCE_LABEL.plist"
uid="$(id -u)"

write_plist() {
  local path="$1" label="$2" script="$3" interval="$4" extra_arg="${5:-}"
  python3 - "$path" "$label" "$script" "$interval" "$extra_arg" <<'PY'
import plistlib
import sys
from pathlib import Path

path, label, script, interval, extra_arg = sys.argv[1:]
arguments = ['/bin/bash', script]
if extra_arg:
    arguments.append(extra_arg)
value = {
    'Label': label,
    'ProgramArguments': arguments,
    'StartInterval': int(interval),
    'RunAtLoad': True,
    'ProcessType': 'Utility',
    # Scheduler output is intentionally not persisted: the scripts emit
    # structured evidence to the external checkpoint/outbox paths, while this
    # avoids an unbounded second log stream outside Docker's rotation policy.
    'StandardOutPath': '/dev/null',
    'StandardErrorPath': '/dev/null',
}
Path(path).write_bytes(plistlib.dumps(value, fmt=plistlib.FMT_XML, sort_keys=False))
Path(path).chmod(0o600)
PY
}

case "$MODE" in
  check)
    for path in "$health_plist" "$maintenance_plist"; do
      [[ -f "$path" ]] || { printf 'MISSING  %s\n' "$path"; exit 1; }
      plutil -lint "$path" >/dev/null
    done
    launchctl print "gui/$uid/$HEALTH_LABEL" >/dev/null 2>&1 && printf '%s\n' 'PASS  storage health LaunchAgent loaded' || printf '%s\n' 'WARN  storage health LaunchAgent is not loaded'
    launchctl print "gui/$uid/$MAINTENANCE_LABEL" >/dev/null 2>&1 && printf '%s\n' 'PASS  storage maintenance LaunchAgent loaded' || printf '%s\n' 'WARN  storage maintenance LaunchAgent is not loaded'
    ;;
  apply)
    mkdir -p "$LAUNCH_DIR"
    write_plist "$health_plist" "$HEALTH_LABEL" "$ROOT_DIR/scripts/storage-health.sh" 86400
    write_plist "$maintenance_plist" "$MAINTENANCE_LABEL" "$ROOT_DIR/scripts/storage-maintenance.sh" 604800 --scheduled
    launchctl bootout "gui/$uid/$HEALTH_LABEL" >/dev/null 2>&1 || true
    launchctl bootout "gui/$uid/$MAINTENANCE_LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$uid" "$health_plist"
    launchctl bootstrap "gui/$uid" "$maintenance_plist"
    printf '%s\n' 'STORAGE_SCHEDULER=installed'
    ;;
  uninstall)
    launchctl bootout "gui/$uid/$HEALTH_LABEL" >/dev/null 2>&1 || true
    launchctl bootout "gui/$uid/$MAINTENANCE_LABEL" >/dev/null 2>&1 || true
    rm -f "$health_plist" "$maintenance_plist"
    printf '%s\n' 'STORAGE_SCHEDULER=uninstalled'
    ;;
esac
