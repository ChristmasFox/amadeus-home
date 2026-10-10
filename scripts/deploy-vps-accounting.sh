#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
HOST_ALIAS="amadeus-gateway"
APPLY=0

STORE_SOURCE="$ROOT_DIR/infra/vps/subscription/accounting_store.py"
SERVICE_SOURCE="$ROOT_DIR/infra/vps/subscription/accounting_service.py"
PROBE_SOURCE="$ROOT_DIR/infra/vps/amadeus-vps-readonly-probe.sh"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy-vps-accounting.sh --dry-run
  ./scripts/deploy-vps-accounting.sh --apply

Deploys the checked-in VPS accounting collector and fixed read-only probe to
the canonical amadeus-gateway SSH alias. The default is a dry-run. Apply
creates a root-only VPS checkpoint, installs files atomically, restarts only
the accounting service, and verifies the schema-5 report-window fields.
USAGE
}

fail() { printf '%s\n' "$*" >&2; exit 2; }

while (($#)); do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --host) fail '--host is not supported; use the canonical amadeus-gateway SSH alias' ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

for source in "$STORE_SOURCE" "$SERVICE_SOURCE" "$PROBE_SOURCE"; do
  [[ -f "$source" ]] || fail "Missing checked-in source: $source"
done
python3 -m py_compile "$STORE_SOURCE" "$SERVICE_SOURCE"
bash -n "$PROBE_SOURCE"
STORE_SHA="$(shasum -a 256 "$STORE_SOURCE" | awk '{print $1}')"
SERVICE_SHA="$(shasum -a 256 "$SERVICE_SOURCE" | awk '{print $1}')"
PROBE_SHA="$(shasum -a 256 "$PROBE_SOURCE" | awk '{print $1}')"

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'HOST_ALIAS=%s\n' "$HOST_ALIAS"
printf 'ACCOUNTING_STORE_SHA256=%s\n' "$STORE_SHA"
printf 'ACCOUNTING_SERVICE_SHA256=%s\n' "$SERVICE_SHA"
printf 'VPS_PROBE_SHA256=%s\n' "$PROBE_SHA"

if ((APPLY == 0)); then
  printf '%s\n' 'PLAN=root-only remote checkpoint; atomic source/probe install; restart accounting service; verify schema 5 and reportWindow coverage.'
  exit 0
fi

git -C "$ROOT_DIR" diff --check
git -C "$ROOT_DIR" diff --quiet || fail 'Refusing apply with unstaged changes; commit reviewed source first.'
git -C "$ROOT_DIR" diff --cached --quiet || fail 'Refusing apply with staged-but-uncommitted changes.'

TRANSFER_ID="$(date -u +%Y%m%d%H%M%S)"
REMOTE_PAYLOAD="/tmp/amadeus-vps-accounting-${TRANSFER_ID}.tar"
tar -C "$ROOT_DIR" -cf - \
  infra/vps/subscription/accounting_store.py \
  infra/vps/subscription/accounting_service.py \
  infra/vps/amadeus-vps-readonly-probe.sh \
  | ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST_ALIAS" "cat > '$REMOTE_PAYLOAD'"

ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST_ALIAS" \
  "PAYLOAD='$REMOTE_PAYLOAD' EXPECTED_STORE_SHA='$STORE_SHA' EXPECTED_SERVICE_SHA='$SERVICE_SHA' EXPECTED_PROBE_SHA='$PROBE_SHA' bash -s" <<'REMOTE'
set -Eeuo pipefail

store='/usr/local/libexec/amadeus-gateway-accounting/accounting_store.py'
service='/usr/local/libexec/amadeus-gateway-accounting/accounting_service.py'
probe='/usr/local/sbin/amadeus-vps-readonly-probe'
unit='/etc/systemd/system/amadeus-gateway-accounting.service'
db='/var/lib/amadeus-accounting/subscription-accounts.sqlite'
snapshot='/var/lib/amadeus-accounting/subscription-usage-public.json'
stamp="$(date -u +%Y%m%d%H%M%S)"
backup="/root/amadeus-gateway-backups/vps-accounting-window-$stamp"
tmp="$(mktemp -d /tmp/amadeus-vps-accounting.XXXXXX)"
cleanup() { rm -rf -- "$tmp" "$PAYLOAD"; }
trap cleanup EXIT

tar -xf "$PAYLOAD" -C "$tmp"
store_source="$tmp/infra/vps/subscription/accounting_store.py"
service_source="$tmp/infra/vps/subscription/accounting_service.py"
probe_source="$tmp/infra/vps/amadeus-vps-readonly-probe.sh"

install -d -o root -g root -m 0700 "$backup"
for path in "$store" "$service" "$probe" "$unit"; do
  if [ -f "$path" ]; then
    name="$(basename -- "$path")"
    cp -p -- "$path" "$backup/$name"
  fi
done
if [ -f "$db" ]; then
  python3 - "$db" "$backup/subscription-accounts.sqlite" <<'PY'
import sqlite3, sys
source = sqlite3.connect(sys.argv[1])
target = sqlite3.connect(sys.argv[2])
try:
    source.backup(target)
finally:
    target.close()
    source.close()
PY
  chmod 0600 "$backup/subscription-accounts.sqlite"
fi
sha256sum "$backup"/* > "$backup/SHA256SUMS" 2>/dev/null || true
chmod 0600 "$backup"/*

python3 -m py_compile "$store_source" "$service_source"
install -o root -g root -m 0644 "$store_source" "$store.new"
install -o root -g root -m 0644 "$service_source" "$service.new"
install -o root -g root -m 0755 "$probe_source" "$probe.new"
mv -f "$store.new" "$store"
mv -f "$service.new" "$service"
mv -f "$probe.new" "$probe"
systemctl daemon-reload
systemctl restart amadeus-gateway-accounting.service
systemctl is-active --quiet amadeus-gateway-accounting.service

verified=0
for _ in $(seq 1 20); do
  if python3 - "$snapshot" "$EXPECTED_STORE_SHA" "$EXPECTED_SERVICE_SHA" "$EXPECTED_PROBE_SHA" <<'PY'
import hashlib, json, pathlib, sqlite3, sys
snapshot = pathlib.Path(sys.argv[1])
if not snapshot.exists():
    raise SystemExit(1)
payload = json.loads(snapshot.read_text(encoding='utf-8'))
window = payload.get('reportWindow')
if not isinstance(window, dict) or 'providerBytes' not in window or 'subscriptionBytes' not in window or 'otherServiceBytes' not in window:
    raise SystemExit(1)
schema = pathlib.Path('/var/lib/amadeus-accounting/subscription-accounts.sqlite')
with sqlite3.connect(schema) as db:
    version = db.execute("SELECT value FROM schema_meta WHERE key='schema_version'").fetchone()
if not version or version[0] != '5':
    raise SystemExit(1)
for path, expected in (
    ('/usr/local/libexec/amadeus-gateway-accounting/accounting_store.py', sys.argv[2]),
    ('/usr/local/libexec/amadeus-gateway-accounting/accounting_service.py', sys.argv[3]),
    ('/usr/local/sbin/amadeus-vps-readonly-probe', sys.argv[4]),
):
    digest = hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(1)
print('REPORT_WINDOW_PROVIDER_BYTES=' + str(window.get('providerBytes')))
print('REPORT_WINDOW_SUBSCRIPTION_BYTES=' + str(window.get('subscriptionBytes')))
print('REPORT_WINDOW_OTHER_SERVICE_BYTES=' + str(window.get('otherServiceBytes')))
print('REPORT_WINDOW_STATUS=' + str(window.get('otherServiceStatus')))
PY
  then
    verified=1
    break
  fi
  sleep 1
done
((verified == 1)) || { systemctl --no-pager --full status amadeus-gateway-accounting.service || true; exit 1; }
printf 'VPS_ACCOUNTING_CHECKPOINT=%s\n' "$backup"
printf '%s\n' 'VPS_ACCOUNTING_SERVICE=active'
printf '%s\n' 'VPS_ACCOUNTING_SCHEMA=5'
REMOTE

printf '%s\n' 'VPS_ACCOUNTING_DEPLOY=passed'
