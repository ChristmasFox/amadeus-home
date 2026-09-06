#!/usr/bin/env bash
set -euo pipefail

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
CONTAINER="${HOMEHUB_RUNTIME_CONTAINER:-pubg-query-engine-v3}"
BASE_URL="${HOMEHUB_RUNTIME_URL:-http://127.0.0.1:5310}"

usage() {
  cat <<'USAGE'
Usage: scripts/smoke-homehub-docker.sh [--machine NAME] [--container NAME] [--url URL]

Read-only smoke test for the deployed HomeHub runtime. It verifies the Docker
socket, the restricted in-process Docker API client, and GET /status. It never
restarts or mutates a service.
USAGE
}

while (($#)); do
  case "$1" in
    --machine)
      (($# >= 2)) || { echo '--machine requires a value.' >&2; exit 2; }
      MACHINE="$2"
      shift
      ;;
    --container)
      (($# >= 2)) || { echo '--container requires a value.' >&2; exit 2; }
      CONTAINER="$2"
      shift
      ;;
    --url)
      (($# >= 2)) || { echo '--url requires a value.' >&2; exit 2; }
      BASE_URL="$2"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

command -v orb >/dev/null 2>&1 || { echo 'orb is required.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'node is required.' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo 'curl is required.' >&2; exit 1; }

orb -m "$MACHINE" -u root docker exec "$CONTAINER" sh -c 'test -S /var/run/docker.sock'
printf '%s\n' "Docker socket present in $CONTAINER."

orb -m "$MACHINE" -u root docker exec "$CONTAINER" node --input-type=module -e '
import { DockerApiCommandExecutor } from "@agent/homehub-domain";
const executor = new DockerApiCommandExecutor();
const result = await executor.execute({ command: "docker", args: ["ps", "-a", "--format", "{{.Names}}"] });
if (!result.ok) {
  console.error(result.error || result.stderr || "Docker API observation failed");
  process.exit(1);
}
const names = result.stdout.trim().split(/\n+/u).filter(Boolean);
if (!names.includes("langbot") || !names.includes("pubg-query-engine-v3")) {
  console.error(`Expected allowlisted services missing from Docker API output: ${names.join(",")}`);
  process.exit(1);
}
console.log(`Restricted Docker API listed ${names.length} allowlisted service(s): ${names.join(", ")}`);
'

status_json="$(curl --fail --silent --show-error --max-time 30 "$BASE_URL/status")"
printf '%s\n' "$status_json" | node --input-type=module -e '
import fs from "node:fs";
const body = JSON.parse(fs.readFileSync(0, "utf8"));
if (body.status !== "ok" || !body.health || !Array.isArray(body.health.services)) {
  console.error("/status did not return a HomeHub health payload");
  process.exit(1);
}
const names = new Set(body.health.services.map((service) => service.serviceId));
for (const required of ["langbot", "mastra-pubg-runtime", "n8n"]) {
  if (!names.has(required)) {
    console.error(`/status missing registered service: ${required}`);
    process.exit(1);
  }
}
if (body.health.summary.unknown === body.health.summary.totalServices) {
  console.error("/status still reports every service as UNKNOWN");
  process.exit(1);
}
if (body.health.host.status !== "unknown" || !String(body.health.host.unknownReason || "").includes("macOS")) {
  console.error("Host metrics were not explicitly marked as unavailable from the container");
  process.exit(1);
}
console.log(`HomeHub /status passed: ${body.health.summary.healthy} healthy, ${body.health.summary.down} down, ${body.health.summary.unknown} unknown; host metrics explicitly unavailable.`);
'
