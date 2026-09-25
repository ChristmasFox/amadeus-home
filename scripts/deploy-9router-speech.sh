#!/usr/bin/env bash
# Repository-managed, explicit 9Router speech image deployment on M204 CasaOS.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"
MACHINE="$ORBSTACK_MACHINE"
APP_DIR=/var/lib/casaos/apps/9router
DATA_DIR=/DATA/AppData/9router
COMPOSE="$APP_DIR/docker-compose.yml"
MODE=dry-run
ALLOW_QWENAI=0
usage() { echo 'Usage: scripts/deploy-9router-speech.sh [--dry-run|--apply] [--allow-qwenai-upstream]'; }
while (($#)); do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --allow-qwenai-upstream) ALLOW_QWENAI=1 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 required' >&2; exit 1; }
old_image="$(orb -m "$MACHINE" -u root docker inspect 9router --format '{{.Config.Image}}')"
printf 'MODE=%s\nGUEST=%s\nOLD_IMAGE=%s\nQWENAI_AUTHORITY_FLAG=%s\n' "$MODE" "$MACHINE" "$old_image" "$ALLOW_QWENAI"
if [[ "$MODE" == dry-run ]]; then
  printf '%s\n' 'PLAN=verify -> protected checkpoint + old image export -> BuildKit immutable image -> compose --no-build -> dual health/auth smoke'
  exit 0
fi
cd "$ROOT"
[[ -z "$(git status --porcelain)" ]] || { echo 'Git must be clean for immutable image tag' >&2; exit 1; }
node infra/docker/casaos/9router/test-asr-bridge.mjs >/dev/null
node --check infra/docker/casaos/9router/start-9router.mjs
pnpm check:secrets
# Missing operator keys/config must fail *before* checkpoint, build or mutation.
orb -m "$MACHINE" -u root python3 - "$DATA_DIR" "$ALLOW_QWENAI" <<'PY'
from pathlib import Path
import os,sys
base=Path(sys.argv[1]); allow_qwenai=sys.argv[2]=='1'; env=base/'9router.env'
for name in ('asr-upstream-api-key','asr-bridge-key'):
    p=base/'secrets'/name
    if not p.is_file() or not p.stat().st_size or p.stat().st_mode & 0o077 or p.stat().st_uid != 1000:
        raise SystemExit('protected 9Router speech secret missing/unreadable by container uid 1000: '+name)
if not env.is_file(): raise SystemExit('protected 9router.env missing')
from urllib.parse import urlparse
urls=[line.split('=',1)[1].strip() for line in env.read_text().splitlines() if line.startswith('AMADEUS_ASR_UPSTREAM_URL=')]
if len(urls)!=1: raise SystemExit('ASR upstream URL missing/ambiguous')
u=urlparse(urls[0]); allowed=(u.hostname or '').endswith('.maas.aliyuncs.com') or u.hostname=='maas.qianwenaiapi.com'
if u.scheme!='https' or not allowed or u.path!='/api/v1/services/aigc/multimodal-generation/generation':
    raise SystemExit('ASR upstream URL not allowlisted')
if u.hostname=='maas.qianwenaiapi.com' and not allow_qwenai:
    raise SystemExit('QwenAI platform is not the original Goal authority; explicit --allow-qwenai-upstream required')
print('SPEECH_SECRET_PREFLIGHT=passed (values suppressed)')
PY
sha="$(git rev-parse --short=12 HEAD)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
image="local/9router:git-${sha}-${stamp}"
checkpoint="$DATA_DIR/backups/voice-1.5.3-deploy-$stamp"
# Retain an exact old-image artifact outside Git, as well as the still-loaded tag.
NINE_ROUTER_IMAGE="$old_image" scripts/export-9router-runtime.sh --apply >/dev/null
orb -m "$MACHINE" -u root python3 - "$checkpoint" "$COMPOSE" "$DATA_DIR" "$old_image" "$image" "$sha" <<'PY'
import json,shutil,sqlite3,sys
from pathlib import Path
out,compose,data=map(Path,sys.argv[1:4]); old,new,commit=sys.argv[4:]
out.mkdir(parents=True,exist_ok=False,mode=0o700)
src=sqlite3.connect(f'file:{data}/data/db/data.sqlite?mode=ro',uri=True)
dst=sqlite3.connect(out/'data.sqlite'); src.backup(dst); dst.close(); src.close()
for source,name in ((compose,'docker-compose.yml'),(data/'9router.env','9router.env')):
    shutil.copyfile(source,out/name)
    (out/name).chmod(0o600)
if (data/'secrets').is_dir():
    shutil.copytree(data/'secrets',out/'secrets')
    (out/'secrets').chmod(0o700)
    for p in (out/'secrets').rglob('*'):
        if p.is_file(): p.chmod(0o600)
(out/'runtime.json').write_text(json.dumps({'repoCommit':commit,'oldImage':old,'newImage':new,'rollback':'restore compose, env and SQLite from this protected checkpoint; old image artifact exported to Avalon'},indent=2)+'\n')
for p in out.iterdir():
    if p.is_file(): p.chmod(0o600)
print('NINE_ROUTER_CHECKPOINT=created (contents suppressed)')
PY
printf 'CHECKPOINT=%s\nNEW_IMAGE=%s\n' "$checkpoint" "$image"
docker buildx build --platform linux/arm64 --load --progress=plain \
  --file "$ROOT/infra/docker/casaos/9router/Dockerfile" --tag "$image" "$ROOT"
docker --context orbstack save "$image" | orb -m "$MACHINE" -u root docker load >/dev/null
orb -m "$MACHINE" -u root docker image inspect "$image" >/dev/null
changed=0
rollback() {
  trap - ERR
  if ((changed == 0)); then return; fi
  echo '9Router smoke failed; restoring checkpoint compose and old image' >&2
  orb -m "$MACHINE" -u root cp "$checkpoint/docker-compose.yml" "$COMPOSE"
  orb -m "$MACHINE" -u root bash -lc 'cd "$1" && docker compose up -d --no-build' -- "$APP_DIR"
}
trap rollback ERR
encoded="$(base64 < "$ROOT/infra/docker/homelab/9router/docker-compose.example.yml" | tr -d '\n')"
orb -m "$MACHINE" -u root python3 - "$COMPOSE" "$encoded" "$image" <<'PY'
import base64,re,sys
from pathlib import Path
path=Path(sys.argv[1]); text=base64.b64decode(sys.argv[2]).decode(); image=sys.argv[3]
if not re.fullmatch(r'local/9router:git-[a-f0-9]{12}-[0-9]{8}T[0-9]{6}Z',image): raise SystemExit('invalid image tag')
text,count=re.subn(r'(?m)^(\s*)image:.*$',lambda m:m.group(1)+'image: '+image,text)
if count != 1: raise SystemExit('expected one image line')
temp=path.with_suffix('.voice-tmp'); temp.write_text(text); temp.chmod(0o600); temp.replace(path)
PY
changed=1
orb -m "$MACHINE" -u root bash -lc 'cd "$1" && docker compose config --quiet && docker compose up -d --no-build' -- "$APP_DIR"
for _ in $(seq 1 50); do
  if orb -m "$MACHINE" -u root docker exec 9router node -e '
    Promise.all([fetch("http://127.0.0.1:20128/api/health"),fetch("http://127.0.0.1:20129/healthz")]).then(([a,b])=>process.exit(a.ok&&b.ok?0:1)).catch(()=>process.exit(1))
  ' >/dev/null 2>&1; then
    # 9Router exempts container-local loopback from the API-key gate. Probe
    # through the actual published host route, not from inside the container.
    unauth_status="$(curl --silent --max-time 4 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:20128/v1/models || true)"
    if [[ "$unauth_status" == 401 ]]; then
      trap - ERR
      echo 'NINE_ROUTER_SPEECH_DEPLOY=healthy (direct ASR and WhatsApp acceptance still required)'
      exit 0
    fi
  fi
  sleep 2
done
false # invoke rollback ERR trap
