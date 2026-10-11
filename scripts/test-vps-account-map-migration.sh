#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
bash -n "$ROOT_DIR/scripts/deploy-vps-accounting.sh"
bash -n "$ROOT_DIR/scripts/test-vps-account-map-permissions.sh"
python3 "$ROOT_DIR/scripts/validate-vps-account-map.py" "$ROOT_DIR/infra/vps/account-map.example.json" >/dev/null
python3 "$ROOT_DIR/scripts/validate-vps-account-map.py" "$ROOT_DIR/infra/vps/account-map-probe.example.json" >/dev/null
malicious="$(mktemp)"
trap 'rm -f "$malicious"' EXIT
python3 - "$malicious" <<'PY'
import json, sys
value = json.load(open('infra/vps/account-map.example.json'))
value['subscriptionToken'] = 'must-never-reach-probe'
json.dump(value, open(sys.argv[1], 'w'))
PY
if python3 "$ROOT_DIR/scripts/validate-vps-account-map.py" "$malicious" >/dev/null 2>&1; then
  echo 'credential-shaped probe map unexpectedly validated' >&2
  exit 1
fi
grep -Fq 'VPS_ACCOUNT_PROBE_MAP_FILE' "$ROOT_DIR/infra/vps/amadeus-vps-readonly-probe.sh"
grep -Fq 'ACCOUNT_MAP_STATUS=' "$ROOT_DIR/infra/vps/amadeus-vps-readonly-probe.sh"
grep -Fq -- '--preflight' "$ROOT_DIR/scripts/deploy-vps-accounting.sh"
grep -Fq 'VPS_ACCOUNTING_ROLLBACK=attempted' "$ROOT_DIR/scripts/deploy-vps-accounting.sh"
grep -Fq 'VPS_ACCOUNT_CONTINUITY_PREFLIGHT=passed' "$ROOT_DIR/scripts/deploy-vps-accounting.sh"
grep -Fq 'amadeus-account-map-traverse' "$ROOT_DIR/scripts/deploy-vps-accounting.sh"
grep -Fq 'chmod 0710' "$ROOT_DIR/scripts/test-vps-account-map-permissions.sh"
grep -Fq 'expected_ids' "$ROOT_DIR/scripts/deploy-vps-accounting.sh"
printf '%s\n' 'VPS_ACCOUNT_MAP_MIGRATION_TEST=passed'
