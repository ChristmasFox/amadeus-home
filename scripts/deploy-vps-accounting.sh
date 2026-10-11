#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
HOST_ALIAS="amadeus-gateway"
APPLY=0
PREFLIGHT=0

STORE_SOURCE="$ROOT_DIR/infra/vps/subscription/accounting_store.py"
SERVICE_SOURCE="$ROOT_DIR/infra/vps/subscription/accounting_service.py"
PROBE_SOURCE="$ROOT_DIR/infra/vps/amadeus-vps-readonly-probe.sh"
UNIT_SOURCE="$ROOT_DIR/infra/vps/systemd/amadeus-gateway-accounting.service.example"
ACCOUNT_MAP_SOURCE="$ROOT_DIR/infra/vps/account-map.example.json"
PROBE_MAP_SOURCE="$ROOT_DIR/infra/vps/account-map-probe.example.json"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy-vps-accounting.sh --dry-run
  ./scripts/deploy-vps-accounting.sh --preflight
  ./scripts/deploy-vps-accounting.sh --apply

Deploys the checked-in VPS accounting collector and fixed read-only probe to
the canonical amadeus-gateway SSH alias. The default is a dry-run. --preflight
is read-only and checks the existing private/probe map ownership contract.
Apply requires --account-map PATH and --probe-map PATH, creates a root-only
VPS checkpoint, installs files atomically, restarts only the accounting
service, and verifies schema-5 report-window fields plus account continuity.
USAGE
}

fail() { printf '%s\n' "$*" >&2; exit 2; }

while (($#)); do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --preflight) PREFLIGHT=1; APPLY=0 ;;
    --account-map) (($# >= 2)) || fail '--account-map requires a path'; ACCOUNT_MAP_SOURCE="$2"; shift ;;
    --probe-map) (($# >= 2)) || fail '--probe-map requires a path'; PROBE_MAP_SOURCE="$2"; shift ;;
    --host) fail '--host is not supported; use the canonical amadeus-gateway SSH alias' ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

for source in "$STORE_SOURCE" "$SERVICE_SOURCE" "$PROBE_SOURCE" "$UNIT_SOURCE" "$ACCOUNT_MAP_SOURCE" "$PROBE_MAP_SOURCE"; do
  [[ -f "$source" ]] || fail "Missing checked-in source: $source"
done
python3 -m py_compile "$STORE_SOURCE" "$SERVICE_SOURCE"
bash -n "$PROBE_SOURCE"
grep -Fqx 'Environment=VPS_ACCOUNT_MAP_FILE=/etc/amadeus-gateway/account-map.json' "$UNIT_SOURCE" \
  || fail 'Accounting unit must declare VPS_ACCOUNT_MAP_FILE explicitly.'
python3 "$ROOT_DIR/scripts/validate-vps-account-map.py" "$ACCOUNT_MAP_SOURCE" >/dev/null
python3 "$ROOT_DIR/scripts/validate-vps-account-map.py" "$PROBE_MAP_SOURCE" >/dev/null
if ! cmp -s <(python3 "$ROOT_DIR/scripts/validate-vps-account-map.py" "$ACCOUNT_MAP_SOURCE") <(python3 "$ROOT_DIR/scripts/validate-vps-account-map.py" "$PROBE_MAP_SOURCE"); then
  fail 'Private and redacted probe account maps must describe the same account IDs.'
fi
STORE_SHA="$(shasum -a 256 "$STORE_SOURCE" | awk '{print $1}')"
SERVICE_SHA="$(shasum -a 256 "$SERVICE_SOURCE" | awk '{print $1}')"
PROBE_SHA="$(shasum -a 256 "$PROBE_SOURCE" | awk '{print $1}')"
UNIT_SHA="$(shasum -a 256 "$UNIT_SOURCE" | awk '{print $1}')"

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'HOST_ALIAS=%s\n' "$HOST_ALIAS"
printf 'ACCOUNTING_STORE_SHA256=%s\n' "$STORE_SHA"
printf 'ACCOUNTING_SERVICE_SHA256=%s\n' "$SERVICE_SHA"
printf 'VPS_PROBE_SHA256=%s\n' "$PROBE_SHA"
printf 'ACCOUNTING_UNIT_SHA256=%s\n' "$UNIT_SHA"
printf 'ACCOUNT_MAP_SOURCE=%s\n' "$ACCOUNT_MAP_SOURCE"
printf 'PROBE_MAP_SOURCE=%s\n' "$PROBE_MAP_SOURCE"

if ((PREFLIGHT == 1)); then
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST_ALIAS" 'bash -s' <<'REMOTE_PREFLIGHT'
set -Eeuo pipefail
private=/etc/amadeus-gateway/account-map.json
probe=/etc/amadeus-gateway/account-map-probe.json
unit=/etc/systemd/system/amadeus-gateway-accounting.service
id -u amadeus-accounting >/dev/null
id -u amadeus-vps-readonly >/dev/null
getent group amadeus-accounting >/dev/null
getent group amadeus-vps-readonly >/dev/null
test -f "$private" && test ! -L "$private"
test -f "$probe" && test ! -L "$probe"
test "$(stat -c '%a' "$private")" = 640
test "$(stat -c '%U:%G' "$private")" = 'root:amadeus-accounting'
test "$(stat -c '%a' "$probe")" = 640
test "$(stat -c '%U:%G' "$probe")" = 'root:amadeus-vps-readonly'
runuser -u amadeus-accounting -- test -r "$private"
runuser -u amadeus-vps-readonly -- test -r "$probe"
! runuser -u amadeus-vps-readonly -- test -r "$private"
python3 - "$private" "$probe" <<'PY'
import json, pathlib, re, sys
expected = {'activeAccountIds', 'dedicatedAccountId', 'legacyAccountId'}
maps = []
for name in sys.argv[1:]:
    value = json.loads(pathlib.Path(name).read_text(encoding='utf-8'))
    if set(value) != expected or not isinstance(value['activeAccountIds'], list) or len(value['activeAccountIds']) != 5:
        raise SystemExit('account map schema is not ID-only')
    ids = [*value['activeAccountIds'], value['dedicatedAccountId'], value['legacyAccountId']]
    if any(not isinstance(item, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', item) for item in ids) or len(set(ids)) != 7:
        raise SystemExit('account map IDs are invalid')
    maps.append(value)
if maps[0] != maps[1]:
    raise SystemExit('private/probe maps do not describe the same identities')
PY
grep -Fqx 'Environment=VPS_ACCOUNT_MAP_FILE=/etc/amadeus-gateway/account-map.json' "$unit"
grep -Fqx 'ReadOnlyPaths=/etc/amadeus-accounting/kiwivm-credentials.json /etc/amadeus-accounting/hysteria-stats-secret /etc/amadeus-gateway/account-map.json' "$unit"
printf '%s\n' 'VPS_ACCOUNT_MAP_PREFLIGHT=passed'
REMOTE_PREFLIGHT
  exit 0
fi

if ((APPLY == 0)); then
  printf '%s\n' 'PLAN=root-only remote checkpoint; atomic source/probe install; restart accounting service; verify schema 5 and reportWindow coverage.'
  exit 0
fi

[[ "$ACCOUNT_MAP_SOURCE" != "$ROOT_DIR/infra/vps/account-map.example.json" ]] \
  || fail 'Apply requires an operator-provided private --account-map path.'
[[ "$PROBE_MAP_SOURCE" != "$ROOT_DIR/infra/vps/account-map-probe.example.json" ]] \
  || fail 'Apply requires an operator-provided redacted --probe-map path.'
[[ "$(stat -f %Lp "$ACCOUNT_MAP_SOURCE")" == 600 ]] || fail 'Private account map must be mode 0600 before apply.'

git -C "$ROOT_DIR" diff --check
git -C "$ROOT_DIR" diff --quiet || fail 'Refusing apply with unstaged changes; commit reviewed source first.'
git -C "$ROOT_DIR" diff --cached --quiet || fail 'Refusing apply with staged-but-uncommitted changes.'

TRANSFER_ID="$(date -u +%Y%m%d%H%M%S)"
REMOTE_PAYLOAD="/tmp/amadeus-vps-accounting-${TRANSFER_ID}.tar"
TRANSFER_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TRANSFER_DIR"' EXIT
cp "$ACCOUNT_MAP_SOURCE" "$TRANSFER_DIR/account-map.json"
cp "$PROBE_MAP_SOURCE" "$TRANSFER_DIR/account-map-probe.json"
tar -C "$ROOT_DIR" -cf - \
  infra/vps/subscription/accounting_store.py \
  infra/vps/subscription/accounting_service.py \
  infra/vps/amadeus-vps-readonly-probe.sh \
  infra/vps/systemd/amadeus-gateway-accounting.service.example \
  -C "$TRANSFER_DIR" account-map.json account-map-probe.json \
  | ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST_ALIAS" "cat > '$REMOTE_PAYLOAD'"

ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST_ALIAS" \
  "PAYLOAD='$REMOTE_PAYLOAD' EXPECTED_STORE_SHA='$STORE_SHA' EXPECTED_SERVICE_SHA='$SERVICE_SHA' EXPECTED_PROBE_SHA='$PROBE_SHA' EXPECTED_UNIT_SHA='$UNIT_SHA' bash -s" <<'REMOTE'
set -Eeuo pipefail

store='/usr/local/libexec/amadeus-gateway-accounting/accounting_store.py'
service='/usr/local/libexec/amadeus-gateway-accounting/accounting_service.py'
probe='/usr/local/sbin/amadeus-vps-readonly-probe'
unit='/etc/systemd/system/amadeus-gateway-accounting.service'
private_map='/etc/amadeus-gateway/account-map.json'
probe_map='/etc/amadeus-gateway/account-map-probe.json'
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
unit_source="$tmp/infra/vps/systemd/amadeus-gateway-accounting.service.example"
private_map_source="$tmp/account-map.json"
probe_map_source="$tmp/account-map-probe.json"

python3 - "$private_map_source" "$probe_map_source" <<'PY'
import json, pathlib, re, sys
expected = {'activeAccountIds', 'dedicatedAccountId', 'legacyAccountId'}
maps = []
for name in sys.argv[1:]:
    value = json.loads(pathlib.Path(name).read_text())
    if set(value) != expected or not isinstance(value['activeAccountIds'], list) or len(value['activeAccountIds']) != 5:
        raise SystemExit('invalid account map schema')
    ids = [*value['activeAccountIds'], value['dedicatedAccountId'], value['legacyAccountId']]
    if any(not isinstance(item, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', item) for item in ids) or len(set(ids)) != 7:
        raise SystemExit('invalid account map IDs')
    maps.append(value)
if maps[0] != maps[1]:
    raise SystemExit('private/probe account map continuity mismatch')
PY
grep -Fqx 'Environment=VPS_ACCOUNT_MAP_FILE=/etc/amadeus-gateway/account-map.json' "$unit_source"

install -d -o root -g root -m 0700 "$backup"
for path in "$store" "$service" "$probe" "$unit" "$private_map" "$probe_map"; do
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

rollback() {
  systemctl stop amadeus-gateway-accounting.service 2>/dev/null || true
  for path in "$store" "$service" "$probe" "$unit" "$private_map" "$probe_map"; do
    name="$(basename -- "$path")"
    if [ -f "$backup/$name" ]; then
      cp -p -- "$backup/$name" "$path"
    else
      rm -f -- "$path"
    fi
  done
  [ ! -f "$private_map" ] || { chown root:amadeus-accounting "$private_map"; chmod 0640 "$private_map"; }
  [ ! -f "$probe_map" ] || { chown root:amadeus-vps-readonly "$probe_map"; chmod 0640 "$probe_map"; }
  [ ! -f "$probe" ] || chmod 0755 "$probe"
  systemctl daemon-reload
  systemctl start amadeus-gateway-accounting.service 2>/dev/null || true
  printf '%s\n' 'VPS_ACCOUNTING_ROLLBACK=attempted' >&2
}
rollback_on_error() { rollback; }
trap rollback_on_error ERR

python3 -m py_compile "$store_source" "$service_source"
install -o root -g root -m 0644 "$store_source" "$store.new"
install -o root -g root -m 0644 "$service_source" "$service.new"
install -o root -g root -m 0755 "$probe_source" "$probe.new"
install -d -o root -g root -m 0750 /etc/amadeus-gateway
install -o root -g amadeus-accounting -m 0640 "$private_map_source" "$private_map.new"
install -o root -g amadeus-vps-readonly -m 0640 "$probe_map_source" "$probe_map.new"
install -o root -g root -m 0644 "$unit_source" "$unit.new"
mv -f "$store.new" "$store"
mv -f "$service.new" "$service"
mv -f "$probe.new" "$probe"
mv -f "$private_map.new" "$private_map"
mv -f "$probe_map.new" "$probe_map"
mv -f "$unit.new" "$unit"
runuser -u amadeus-accounting -- test -r "$private_map"
runuser -u amadeus-vps-readonly -- test -r "$probe_map"
if runuser -u amadeus-vps-readonly -- test -r "$private_map"; then
  echo 'probe account unexpectedly reads private map' >&2
  exit 1
fi
python3 - "$db" "$snapshot" "$private_map" <<'PY'
import json, pathlib, sqlite3, sys
db_path, snapshot_path, map_path = map(pathlib.Path, sys.argv[1:])
mapping = json.loads(map_path.read_text(encoding='utf-8'))
expected = set(mapping['activeAccountIds']) | {mapping['dedicatedAccountId'], mapping['legacyAccountId']}
if not db_path.exists() or not snapshot_path.exists():
    raise SystemExit('existing DB and public snapshot are required for continuity preflight')
with sqlite3.connect(db_path) as db:
    actual_db = {row[0] for row in db.execute('SELECT account_id FROM accounts')}
payload = json.loads(snapshot_path.read_text(encoding='utf-8'))
actual_snapshot = {row.get('accountId') for row in payload.get('accounts', []) if isinstance(row, dict)}
actual_snapshot.add((payload.get('legacy') or {}).get('accountId'))
if actual_db != expected or actual_snapshot != expected:
    raise SystemExit('existing account IDs do not match the incoming map')
print('VPS_ACCOUNT_CONTINUITY_PREFLIGHT=passed')
PY
systemctl daemon-reload

if ! systemctl restart amadeus-gateway-accounting.service || ! systemctl is-active --quiet amadeus-gateway-accounting.service; then
  rollback
  exit 1
fi

verified=0
for _ in $(seq 1 20); do
  if python3 - "$snapshot" "$EXPECTED_STORE_SHA" "$EXPECTED_SERVICE_SHA" "$EXPECTED_PROBE_SHA" "$EXPECTED_UNIT_SHA" <<'PY'
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
mapping = json.loads(pathlib.Path('/etc/amadeus-gateway/account-map.json').read_text(encoding='utf-8'))
expected_ids = set(mapping['activeAccountIds']) | {mapping['dedicatedAccountId'], mapping['legacyAccountId']}
with sqlite3.connect(schema) as db:
    db_ids = {row[0] for row in db.execute('SELECT account_id FROM accounts')}
if db_ids != expected_ids:
    raise SystemExit(1)
snapshot_ids = {row.get('accountId') for row in payload.get('accounts', []) if isinstance(row, dict)}
snapshot_ids.add((payload.get('legacy') or {}).get('accountId'))
if snapshot_ids != expected_ids:
    raise SystemExit(1)
for path, expected in (
    ('/usr/local/libexec/amadeus-gateway-accounting/accounting_store.py', sys.argv[2]),
    ('/usr/local/libexec/amadeus-gateway-accounting/accounting_service.py', sys.argv[3]),
    ('/usr/local/sbin/amadeus-vps-readonly-probe', sys.argv[4]),
    ('/etc/systemd/system/amadeus-gateway-accounting.service', sys.argv[5]),
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
if ((verified != 1)); then
  systemctl --no-pager --full status amadeus-gateway-accounting.service || true
  rollback
  exit 1
fi
printf 'VPS_ACCOUNTING_CHECKPOINT=%s\n' "$backup"
printf '%s\n' 'VPS_ACCOUNTING_SERVICE=active'
printf '%s\n' 'VPS_ACCOUNTING_SCHEMA=5'
REMOTE

printf '%s\n' 'VPS_ACCOUNTING_DEPLOY=passed'
