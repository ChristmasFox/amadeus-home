#!/usr/bin/env bash
# Inject an early user-group failure into the real rollback function, without
# ever connecting to the VPS, changing system users, or restarting services.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
python3 - "$ROOT/scripts/deploy-vps-accounting.sh" "$WORK/function.sh" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
a=s.find("\nrollback() {\n")
b=s.find("\ntrap 'rollback' ERR HUP INT TERM",a)
if a<0 or b<0 or s.find("groupadd --system \"$traverse_group\"",b)<b:
    raise SystemExit("rollback handler missing or registered after group changes")
Path(sys.argv[2]).write_text(s[a+1:b])
PY
cat > "$WORK/failure.sh" <<'SH'
set -Eeuo pipefail
WORK="$1"
store="$WORK/store"; service="$WORK/service"; probe="$WORK/probe"; unit="$WORK/unit"
private_map="$WORK/map/account-map.json"; probe_map="$WORK/map/account-map-probe.json"
map_dir="$WORK/map"; backup="$WORK/backup"
mkdir -p "$map_dir" "$backup"
map_dir_existed=0; parent_owner_group=''; parent_mode=''
runtime_touched=0
traverse_group=synthetic-group; traverse_group_existed=0
accounting_had_traverse=0; readonly_had_traverse=0
getent() { [[ "$1" == group && "$2" == synthetic-group ]]; }
gpasswd() { printf 'gpasswd %s\n' "$*" >> "$WORK/actions"; }
groupdel() { printf 'groupdel %s\n' "$*" >> "$WORK/actions"; }
systemctl() { printf 'BAD_SERVICE_TOUCH\n' >> "$WORK/actions"; return 99; }
source "$WORK/function.sh"
trap 'rollback' ERR HUP INT TERM
false
SH
set +e
bash "$WORK/failure.sh" "$WORK" >"$WORK/out" 2>"$WORK/err"
result=$?
set -e
[[ "$result" -eq 1 ]] || { echo "unexpected fault exit code: $result" >&2; exit 1; }
[[ ! -d "$WORK/map" ]] || { echo 'new map directory not removed by rollback' >&2; exit 1; }
grep -Fq 'gpasswd -d amadeus-accounting synthetic-group' "$WORK/actions"
grep -Fq 'gpasswd -d amadeus-vps-readonly synthetic-group' "$WORK/actions"
grep -Fq 'groupdel synthetic-group' "$WORK/actions"
! grep -Fq 'BAD_SERVICE_TOUCH' "$WORK/actions"
grep -Fq 'VPS_ACCOUNTING_ROLLBACK=attempted' "$WORK/err"
printf '%s\n' 'VPS_ACCOUNT_MAP_ROLLBACK_FAULT_INJECTION=passed'
