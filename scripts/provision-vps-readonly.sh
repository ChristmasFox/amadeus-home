#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
HOST_ALIAS="amadeus-gateway"
REMOTE_USER="amadeus-vps-readonly"
PUBLIC_KEY_FILE=""
APPLY=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/provision-vps-readonly.sh --dry-run --public-key <public-key>
  ./scripts/provision-vps-readonly.sh --apply --public-key <public-key>

Installs the checked-in fixed probe and a dedicated forced-command SSH key on
the canonical amadeus-gateway host. The default is a dry-run. It never changes
sshd_config, firewall rules, the root key, or VPS services.
USAGE
}

fail() { printf '%s\n' "$*" >&2; exit 2; }

while (($#)); do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --public-key) (($# >= 2)) || fail '--public-key requires a path'; PUBLIC_KEY_FILE="$2"; shift ;;
    --host) fail '--host is not supported; use the canonical amadeus-gateway SSH alias' ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

[[ -n "$PUBLIC_KEY_FILE" && -f "$PUBLIC_KEY_FILE" ]] || fail 'A public key file is required.'
[[ -f "$ROOT_DIR/infra/vps/amadeus-vps-readonly-probe.sh" ]] || fail 'The checked-in VPS probe is missing.'
PUBLIC_KEY="$(tr -d '\r\n' < "$PUBLIC_KEY_FILE")"
[[ "$PUBLIC_KEY" =~ ^ssh-(ed25519|rsa|ecdsa)[[:space:]] ]] || fail 'The public key must be an OpenSSH public key.'
PROBE_SHA="$(shasum -a 256 "$ROOT_DIR/infra/vps/amadeus-vps-readonly-probe.sh" | awk '{print $1}')"
printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'HOST_ALIAS=%s\n' "$HOST_ALIAS"
printf 'REMOTE_USER=%s\n' "$REMOTE_USER"
printf 'PROBE_SHA256=%s\n' "$PROBE_SHA"

if ((APPLY == 0)); then
  printf '%s\n' 'PLAN=install fixed probe and append one forced-command key; preserve existing SSH/firewall/service state.'
  exit 0
fi

PUBKEY_B64="$(printf '%s' "$PUBLIC_KEY" | base64 | tr -d '\n')"
PROBE_B64="$(base64 < "$ROOT_DIR/infra/vps/amadeus-vps-readonly-probe.sh" | tr -d '\n')"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST_ALIAS" \
  "AMADEUS_USER='$REMOTE_USER' AMADEUS_PUBKEY_B64='$PUBKEY_B64' AMADEUS_PROBE_B64='$PROBE_B64' bash -s" <<'REMOTE'
set -Eeuo pipefail
user="$AMADEUS_USER"
probe='/usr/local/sbin/amadeus-vps-readonly-probe'
if ! id "$user" >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir "/var/lib/$user" --shell /bin/sh "$user"
fi
usermod --shell /bin/sh "$user"
install -d -o "$user" -g "$user" -m 0700 "/var/lib/$user/.ssh"
printf '%s' "$AMADEUS_PROBE_B64" | base64 -d | install -o root -g root -m 0755 /dev/stdin "$probe"
key_file="/var/lib/$user/.ssh/authorized_keys"
key_line="command=\"$probe\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc $(printf '%s' "$AMADEUS_PUBKEY_B64" | base64 -d)"
if ! grep -Fq -- "$key_line" "$key_file" 2>/dev/null; then
  temporary="$key_file.codex-tmp"
  if [ -f "$key_file" ]; then cat "$key_file" > "$temporary"; fi
  printf '%s\n' "$key_line" >> "$temporary"
  chown "$user:$user" "$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$key_file"
fi
chown -R "$user:$user" "/var/lib/$user/.ssh"
chmod 0700 "/var/lib/$user/.ssh"
chmod 0600 "$key_file"
printf 'VPS_READONLY_USER=installed\n'
printf 'VPS_READONLY_PROBE=installed\n'
REMOTE

printf '%s\n' 'VPS_READONLY_PROVISION=passed'
