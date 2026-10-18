#!/usr/bin/env bash
# Manual "fetch the latest matches now" for the PUBG Intelligence Lab page button.
#
# Runs the existing hourly Lab job once (the same read-only-to-us PUBG prefetch the cron does at :05), then refreshes the
# page snapshot and restarts the page when data changed. Progress is written to refresh-request.json so the page can poll.
#
#   refresh-intelligence-now.sh <request-file>
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/host-profile.sh
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"

REQUEST="${1:?request file path required}"
JOB_NAME=amadeus-pubg-telemetry-hourly
CONTAINER="${OPENCLAW_CONTAINER:-openclaw}"

write_request() {
  python3 - "$REQUEST" "$1" <<'PY'
import json, sys
path, fetch = sys.argv[1], sys.argv[2]
data = json.load(open(path))
data['fetch'] = fetch
json.dump(data, open(path + '.tmp', 'w'))
import os; os.replace(path + '.tmp', path)
PY
}

fetch=ok
job_id="$(orb -m "$ORBSTACK_MACHINE" -u root docker exec "$CONTAINER" openclaw cron list --json 2>/dev/null | python3 -c '
import json, sys
data = json.load(sys.stdin)
jobs = data.get("jobs", data) if isinstance(data, dict) else data
print(next((job["id"] for job in jobs if job.get("name") == sys.argv[1]), ""))' "$JOB_NAME" 2>/dev/null)"
if [[ -z "$job_id" ]]; then
  fetch=job_not_found
elif ! orb -m "$ORBSTACK_MACHINE" -u root docker exec "$CONTAINER" openclaw cron run "$job_id" --wait --wait-timeout 4m >/dev/null 2>&1; then
  fetch=failed
fi
write_request "$fetch"

# The snapshot refresh restarts the page itself when the data changed.
"$ROOT/scripts/refresh-intelligence-snapshot.sh" --apply --restart
