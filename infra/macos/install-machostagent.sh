#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
APPLY=0
LABEL='com.amadeus.machostagent'
PLIST_TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALL_DIR='/usr/local/libexec/amadeus'
TOKEN_TARGET='/Library/Application Support/Amadeus/machostagent.token'

usage() { printf '%s\n' "Usage: $0 [--dry-run] [--apply]"; }
while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
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
if ((APPLY == 0)); then exit 0; fi

[[ -s "$ROOT_DIR/infra/macos/machostagent.py" ]] || { printf '%s\n' 'collector source missing' >&2; exit 1; }
sudo /bin/mkdir -p "$INSTALL_DIR" "$(/usr/bin/dirname "$PLIST_TARGET")" '/Library/Application Support/Amadeus'
sudo /usr/bin/install -m 755 "$ROOT_DIR/infra/macos/machostagent.py" "$INSTALL_DIR/machostagent.py"
if [[ ! -s "$TOKEN_TARGET" ]]; then
  printf '%s\n' 'create a protected token at /Library/Application Support/Amadeus/machostagent.token before apply' >&2
  exit 1
fi
sudo /usr/sbin/chown root:wheel "$TOKEN_TARGET"
sudo /bin/chmod 600 "$TOKEN_TARGET"
/usr/bin/sed "s#/usr/local/libexec/amadeus/machostagent.py#$INSTALL_DIR/machostagent.py#; s#/Library/Application Support/Amadeus/machostagent.token#$TOKEN_TARGET#" "$ROOT_DIR/infra/macos/com.amadeus.machostagent.plist.example" | sudo /usr/bin/tee "$PLIST_TARGET" >/dev/null
/usr/bin/plutil -lint "$PLIST_TARGET"
/bin/launchctl bootout "gui/$(/usr/bin/id -u)/$LABEL" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$PLIST_TARGET"
/bin/launchctl enable "gui/$(/usr/bin/id -u)/$LABEL"
printf '%s\n' 'MAC_HOST_AGENT=installed'
