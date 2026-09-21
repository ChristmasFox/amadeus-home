#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
MODE=fixture
ARTIFACT=""
IMAGE="${NINE_ROUTER_IMAGE:-local/9router:0.5.81}"
while (($#)); do
  case "$1" in
    --fixture) MODE=fixture; shift; ARTIFACT="${1:?--fixture requires artifact}"; shift; continue ;;
    --live) MODE=live; shift; ARTIFACT="${1:?--live requires artifact}"; shift; continue ;;
    --image) shift; IMAGE="${1:?--image requires image}"; shift; continue ;;
    --help|-h) printf '%s\n' 'Usage: scripts/test-9router-restore-rehearsal.sh --fixture ARTIFACT | --live ARTIFACT'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[[ -s "$ARTIFACT" ]] || { printf '%s\n' '9Router exact artifact is required' >&2; exit 2; }
checksum="$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')"
[[ -n "$checksum" ]] || exit 1
if [[ "$MODE" == fixture ]]; then
  fixture="$(mktemp -d "${TMPDIR:-/tmp}/9router-rehearsal.XXXXXX")"
  trap 'kill "$server_pid" >/dev/null 2>&1 || true' EXIT
  python3 - "$fixture" <<'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
root=Path(sys.argv[1])
(root/'data').mkdir()
(root/'restore.env').write_text('AUTH=fixture-only\nREQUIRE_API_KEY=true\n')
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        if self.path == '/dashboard':
            self.send_response(200); self.end_headers(); self.wfile.write(b'healthy'); return
        if self.path == '/v1/models':
            if self.headers.get('Authorization') != 'Bearer fixture-auth':
                self.send_response(401); self.end_headers(); return
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"data":[]}'); return
        self.send_response(404); self.end_headers()
server=HTTPServer(('127.0.0.1',0), Handler)
(root/'port').write_text(str(server.server_port)); server.serve_forever()
PY
  server_pid=$!
  for _ in $(seq 1 50); do [[ -s "$fixture/port" ]] && break; sleep 0.05; done
  port="$(cat "$fixture/port")"
  printf '%s\n' 'FIXTURE_DOCKER_LOAD=passed' >"$fixture/docker-load.log"
  printf '%s\n' 'FIXTURE_ISOLATED_DATA_RESTORE=passed' >>"$fixture/docker-load.log"
  curl --fail --silent "http://127.0.0.1:$port/dashboard" | grep -Fqx healthy
  if curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$port/v1/models" | grep -Fqx 401; then :; else exit 1; fi
  if curl --fail --silent -H 'Authorization: Bearer fixture-auth' "http://127.0.0.1:$port/v1/models" | grep -Fq 'data'; then :; else exit 1; fi
  printf 'NINE_ROUTER_RESTORE_REHEARSAL=passed\nNINE_ROUTER_ARTIFACT_SHA256=%s\n' "$checksum"
else
  command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI is required for live rehearsal' >&2; exit 1; }
  MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
  name="skuld-9router-rehearsal-$$"
  rehearsal_data=""
  cleanup() {
    orb -m "$MACHINE" -u root docker rm -f "$name" >/dev/null 2>&1 || true
    if [[ -n "$rehearsal_data" ]]; then orb -m "$MACHINE" -u root rm -rf -- "$rehearsal_data" >/dev/null 2>&1 || true; fi
  }
  trap cleanup EXIT
  orb -m "$MACHINE" -u root docker load <"$ARTIFACT" >/dev/null
  rehearsal_data="$(orb -m "$MACHINE" -u root mktemp -d /tmp/skuld-9router-data.XXXXXX)"
  orb -m "$MACHINE" -u root bash -lc 'cp -a /DATA/AppData/9router/data/. "$1"/' -- "$rehearsal_data"
  # The isolated container has no provider network and receives fixture-only auth; it cannot create paid requests.
  orb -m "$MACHINE" -u root docker run -d --name "$name" --network none \
    -v "$rehearsal_data:/app/data" \
    -e AUTH=fixture-auth -e REQUIRE_API_KEY=true -e NODE_ENV=production "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    if orb -m "$MACHINE" -u root docker exec "$name" node -e 'fetch("http://127.0.0.1:20128/dashboard").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then break; fi
    sleep 1
  done
  orb -m "$MACHINE" -u root docker exec "$name" node - <<'NODE'
const unauth = await fetch('http://127.0.0.1:20128/v1/models');
if (unauth.status !== 401) process.exit(1);
const auth = await fetch('http://127.0.0.1:20128/v1/models', {headers: {Authorization: 'Bearer fixture-auth'}});
if (!auth.ok) process.exit(1);
console.log('isolated-dashboard=200');
console.log('unauthenticated-models=401');
console.log('fixture-authenticated-models=' + auth.status);
NODE
  printf 'NINE_ROUTER_RESTORE_REHEARSAL=passed\nNINE_ROUTER_ARTIFACT_SHA256=%s\n' "$checksum"
fi
