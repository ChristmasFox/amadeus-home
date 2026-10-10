#!/usr/bin/env bash
# Upgrade only 9Router from a committed Git snapshot; never build the dirty tree.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"
MODE=dry-run
BUILD=0
IMAGE=""
while (($#)); do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --build) BUILD=1 ;;
    --image) shift; IMAGE="${1:?--image requires an image}" ;;
    --help|-h) echo 'Usage: scripts/deploy-9router.sh [--dry-run|--apply] [--build|--image IMAGE]'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
((BUILD == 0)) || [[ -z "$IMAGE" ]] || { echo '--build and --image are exclusive' >&2; exit 2; }
MACHINE="$ORBSTACK_MACHINE"
APP=/var/lib/casaos/apps/9router
DATA=/DATA/AppData/9router
old="$(orb -m "$MACHINE" -u root docker inspect 9router --format '{{.Config.Image}}')"
commit="$(git -C "$ROOT" rev-parse HEAD)"
sha="${commit:0:12}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
checkpoint="$DATA/backups/router-upgrade-$stamp"
printf 'MODE=%s\nGUEST=%s\nSOURCE_COMMIT=%s\nOLD_IMAGE=%s\n' "$MODE" "$MACHINE" "$sha" "$old"
if [[ "$MODE" == dry-run ]]; then
  echo 'PLAN=committed snapshot -> focused tests/secrets -> external old-image export -> BuildKit (only --apply --build) -> isolated fixture -> protected SQLite/compose/env checkpoint -> 9Router-only switch -> health/auth/config smoke; automatic compose rollback on failure'
  exit 0
fi
((BUILD == 1)) || [[ -n "$IMAGE" ]] || { echo '--apply needs --build or --image' >&2; exit 2; }
# Production uses a local protected account policy, never a Git-tracked personal email.
# This check runs BEFORE any backup, candidate build or service mutation.
private_policy="${AMADEUS_9ROUTER_PRIVATE_POLICY_FILE:-$ROOT/.local/9router-production-policy.json}"
if [[ ! -f "$private_policy" || ! -r "$private_policy" ]]; then
  echo 'Missing private 9Router policy. Prepare .local/9router-production-policy.json; see docs/PRODUCTION_9ROUTER_POLICY_MIGRATION.md' >&2
  exit 1
fi
node --input-type=module - "$private_policy" <<'JS'
import { readFileSync } from 'node:fs';
const policy=JSON.parse(readFileSync(process.argv[2],'utf8'));
const models=['gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5'];
if (policy.packageVersion!=='0.5.95'||policy.imageAccount?.provider!=='codex'||
    JSON.stringify(policy.imageAccount.models)!==JSON.stringify(models)||
    typeof policy.imageAccount.email!=='string'||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(policy.imageAccount.email)||
    policy.serverActions?.bodySizeLimit!=='20mb') {
  throw Error('private_production_account_policy_invalid');
}
console.log('PRIVATE_9ROUTER_POLICY=valid (account value not printed)');
JS

context="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-9router-build.XXXXXX")"
cleanup() { rm -rf "$context"; }
trap cleanup EXIT
git -C "$ROOT" archive "$commit" | tar -xf - -C "$context"
# Only the temporary build context receives the private policy; Git stays credential-free.
cp -- "$private_policy" "$context/infra/9router/runtime-policy.json"
chmod 0600 "$context/infra/9router/runtime-policy.json"
(
  cd "$context"
  node infra/docker/casaos/9router/test-asr-bridge.mjs
  node infra/docker/casaos/9router/test-tts-bridge.mjs
  node infra/docker/casaos/9router/test-selfhosted-tts-style.mjs
  if [[ -f infra/docker/casaos/9router/test-runtime-policy.mjs ]]; then
    node infra/docker/casaos/9router/test-runtime-policy.mjs
  fi
  node infra/docker/casaos/9router/test-image-combo-safety.mjs
  node --check infra/docker/casaos/9router/start-9router.mjs
  # The exported Git snapshot has no .git metadata; scan the real worktree.
)
(cd "$ROOT" && pnpm check:secrets)
"$ROOT/scripts/export-9router-runtime.sh" --apply --image "$old"
if ((BUILD == 1)); then
  IMAGE="local/9router:git-${sha}-${stamp}"
  docker buildx build --platform linux/arm64 --load --progress=plain \
    --file "$context/infra/docker/casaos/9router/Dockerfile" --tag "$IMAGE" "$context"
  docker --context orbstack save "$IMAGE" | orb -m "$MACHINE" -u root docker load >/dev/null
fi
# Both pre-built and built candidates must retain the exact private account allowlist.
image_policy="$(orb -m "$MACHINE" -u root docker run --rm --network none --entrypoint cat "$IMAGE" /opt/amadeus/runtime-policy.json)"
if [[ "$image_policy" != "$(<"$private_policy")" ]]; then
  echo 'Candidate 9Router image has a different/missing production account policy; refusing deployment.' >&2
  exit 1
fi
# Do not let the candidate touch production data until the isolated startup passes.
"$context/scripts/test-9router-speech-image.sh" --image "$IMAGE" --apply
if [[ -f "$context/scripts/verify-9router-runtime-policy.mjs" ]]; then
  orb -m "$MACHINE" -u root docker run --rm -i --network none --entrypoint node "$IMAGE" \
    --input-type=module - < "$context/scripts/verify-9router-runtime-policy.mjs"
fi
orb -m "$MACHINE" -u root python3 - "$checkpoint" "$APP" "$DATA" "$old" "$IMAGE" "$sha" <<'PY'
import json,shutil,sqlite3,sys
from pathlib import Path
out,app,data=map(Path,sys.argv[1:4]);old,new,commit=sys.argv[4:]
out.mkdir(mode=0o700,parents=True,exist_ok=False)
src=sqlite3.connect(f'file:{data}/data/db/data.sqlite?mode=ro',uri=True)
dst=sqlite3.connect(out/'data.sqlite');src.backup(dst);dst.close();src.close()
for source,name in [(app/'docker-compose.yml','docker-compose.yml'),(data/'9router.env','9router.env')]:
    shutil.copyfile(source,out/name)
(out/'runtime.json').write_text(json.dumps({'commit':commit,'oldImage':old,'newImage':new,'databaseBackup':'data.sqlite'},indent=2)+'\n')
for p in out.iterdir():
    if p.is_file(): p.chmod(0o600)
print('NINE_ROUTER_CHECKPOINT='+str(out))
PY
changed=0
rollback() {
  trap - ERR
  if ((changed)); then
    echo "9Router failed verification. Restoring compose from $checkpoint (database backup retained; no blind live DB overwrite)." >&2
    orb -m "$MACHINE" -u root cp "$checkpoint/docker-compose.yml" "$APP/docker-compose.yml"
    orb -m "$MACHINE" -u root bash -lc 'cd "$1" && docker compose up -d --no-build 9router' -- "$APP"
  fi
}
trap rollback ERR
orb -m "$MACHINE" -u root python3 - "$APP/docker-compose.yml" "$IMAGE" <<'PY'
import re,sys
from pathlib import Path
p=Path(sys.argv[1]);image=sys.argv[2]
if not re.fullmatch(r'local/9router:[A-Za-z0-9_.-]+',image): raise SystemExit('invalid local image')
s,n=re.subn(r'(?m)^(\s*)image:.*$',lambda m:m[1]+'image: '+image,p.read_text())
if n!=1: raise SystemExit('expected exactly one image; refusing to modify multi-service compose')
t=p.with_suffix('.upgrade-tmp');t.write_text(s);t.chmod(0o600);t.replace(p)
PY
changed=1
orb -m "$MACHINE" -u root bash -lc 'cd "$1" && docker compose config --quiet && docker compose up -d --no-build 9router' -- "$APP"
healthy=0
for _ in $(seq 1 60); do
  if orb -m "$MACHINE" -u root docker exec 9router node -e '
    Promise.all([fetch("http://127.0.0.1:20128/api/health"),fetch("http://127.0.0.1:20129/healthz"),fetch("http://127.0.0.1:20130/healthz")]).then(r=>process.exit(r.every(x=>x.ok)?0:1)).catch(()=>process.exit(1))
  ' >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
((healthy == 1))
status="$(curl --silent --max-time 6 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:20128/v1/models)"
[[ "$status" == 401 ]]
python3 "$context/scripts/provision-9router-image-combo.py" --verify-live --machine "$MACHINE"
if [[ -f "$context/scripts/verify-9router-runtime-policy.mjs" ]]; then
  orb -m "$MACHINE" -u root docker exec -i 9router node --input-type=module - < "$context/scripts/verify-9router-runtime-policy.mjs"
fi
trap - ERR
printf 'NINE_ROUTER_DEPLOY=healthy\nIMAGE=%s\nCHECKPOINT=%s\n' "$IMAGE" "$checkpoint"
