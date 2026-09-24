#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
APPLY=0
ACCURATE_POWER=0
LABEL='com.amadeus.machostagent'
PLIST_TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALL_DIR="$HOME/Library/Application Support/Amadeus"
TOKEN_TARGET="$INSTALL_DIR/machostagent.token"
LOG_DIR="$HOME/Library/Logs/Amadeus"
POWER_LABEL='com.amadeus.machostagent.power'
POWER_HELPER_TARGET='/Library/Application Support/Amadeus/machostagent_power.py'
POWER_PLIST_TARGET="/Library/LaunchDaemons/$POWER_LABEL.plist"
POWER_FILE='/var/run/amadeus-machostagent-power.json'

usage() { printf '%s\n' "Usage: $0 [--dry-run] [--apply] [--accurate-power]"; }
while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --accurate-power) ACCURATE_POWER=1 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

[[ "$(/usr/sbin/scutil --get ComputerName 2>/dev/null || /bin/hostname -s)" == 'Amadeus-M204' ]] || { printf '%s\n' 'MAC_HOST_AGENT=blocked (host is not Amadeus-M204)' >&2; exit 1; }
printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'PLIST=%s\n' "$PLIST_TARGET"
printf 'INSTALL_DIR=%s\n' "$INSTALL_DIR"
printf 'TOKEN=%s\n' "$TOKEN_TARGET"
printf 'ACCURATE_POWER=%s\n' "$([[ $ACCURATE_POWER -eq 1 ]] && printf requested || printf not-requested)"
if ((APPLY == 0)); then exit 0; fi

[[ -s "$ROOT_DIR/infra/macos/machostagent.py" ]] || { printf '%s\n' 'collector source missing' >&2; exit 1; }
/bin/mkdir -p "$INSTALL_DIR" "$(/usr/bin/dirname "$PLIST_TARGET")" "$LOG_DIR"
/usr/bin/install -m 755 "$ROOT_DIR/infra/macos/machostagent.py" "$INSTALL_DIR/machostagent.py"
if [[ ! -s "$TOKEN_TARGET" ]]; then
  printf '%s\n' "create a protected token at $TOKEN_TARGET before apply" >&2
  exit 1
fi
/bin/chmod 600 "$TOKEN_TARGET"
/usr/bin/sed "s#/usr/local/libexec/amadeus/machostagent.py#$INSTALL_DIR/machostagent.py#; s#/Library/Application Support/Amadeus/machostagent.token#$TOKEN_TARGET#; s#/var/log/amadeus-mac-host-agent.log#$LOG_DIR/host-agent.log#; s#/var/log/amadeus-mac-host-agent.err.log#$LOG_DIR/host-agent.err.log#" "$ROOT_DIR/infra/macos/com.amadeus.machostagent.plist.example" > "$PLIST_TARGET"
/usr/bin/plutil -lint "$PLIST_TARGET"
/bin/launchctl bootout "gui/$(/usr/bin/id -u)/$LABEL" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$PLIST_TARGET"
/bin/launchctl enable "gui/$(/usr/bin/id -u)/$LABEL"
if ((ACCURATE_POWER == 1)); then
  /usr/bin/sudo -v
  /usr/bin/sudo /bin/mkdir -p "/Library/Application Support/Amadeus" /Library/LaunchDaemons
  /usr/bin/sudo /usr/bin/install -m 755 "$ROOT_DIR/infra/macos/machostagent_power.py" "$POWER_HELPER_TARGET"
  /usr/bin/sudo /usr/bin/install -m 644 "$ROOT_DIR/infra/macos/com.amadeus.machostagent.power.plist.example" "$POWER_PLIST_TARGET"
  /usr/bin/sudo /usr/sbin/chown root:wheel "$POWER_HELPER_TARGET" "$POWER_PLIST_TARGET"
  /usr/bin/sudo /usr/bin/plutil -lint "$POWER_PLIST_TARGET"
  /usr/bin/sudo /bin/launchctl bootout "system/$POWER_LABEL" 2>/dev/null || true
  /usr/bin/sudo /bin/launchctl bootstrap system "$POWER_PLIST_TARGET"
  /usr/bin/sudo /bin/launchctl enable "system/$POWER_LABEL"
  printf 'POWER_HELPER=%s\n' "$POWER_HELPER_TARGET"
  printf 'POWER_FILE=%s\n' "$POWER_FILE"
  printf 'POWER_DAEMON=installed\n'
fi
printf '%s\n' 'MAC_HOST_AGENT=installed'
