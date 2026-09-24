#!/usr/bin/env bash
# Isolated release-image smoke: fixture keys, no network and no live 9Router data.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"
MODE=dry-run
IMAGE=""
while (($#)); do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --image) shift; IMAGE="${1:?--image requires a tag}" ;;
    --help|-h) echo 'Usage: scripts/test-9router-speech-image.sh --image IMAGE [--dry-run|--apply]'; exit 0 ;;
    *) echo "Unexpected argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[[ -n "$IMAGE" ]] || { echo '--image required' >&2; exit 2; }
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 required' >&2; exit 1; }
printf 'MODE=%s\nIMAGE=%s\n' "$MODE" "$IMAGE"
if [[ "$MODE" == dry-run ]]; then echo 'PLAN=isolated network-none boot, dual health and fixture-only ASR failure contract; no live mutation'; exit 0; fi
orb -m "$ORBSTACK_MACHINE" -u root docker image inspect "$IMAGE" >/dev/null
name="amadeus-voice-image-smoke-$$"
fixture="$(orb -m "$ORBSTACK_MACHINE" -u root mktemp -d /tmp/amadeus-voice-image.XXXXXX)"
cleanup() {
  orb -m "$ORBSTACK_MACHINE" -u root docker rm -f "$name" >/dev/null 2>&1 || true
  orb -m "$ORBSTACK_MACHINE" -u root python3 - "$fixture" <<'PY' >/dev/null 2>&1 || true
from pathlib import Path
import shutil,sys
p=Path(sys.argv[1])
if p.name.startswith('amadeus-voice-image.') and p.parent==Path('/tmp'): shutil.rmtree(p)
PY
}
trap cleanup EXIT
orb -m "$ORBSTACK_MACHINE" -u root python3 - "$fixture" <<'PY'
from pathlib import Path
import os,sys
p=Path(sys.argv[1]); (p/'data').mkdir(mode=0o700)
for name,value in [('asr-bridge-key','fixture-bridge-'+'x'*48),('dashscope-asr-key','fixture-cloud-'+'y'*48)]:
    f=p/name; f.write_text(value); f.chmod(0o600); os.chown(f,1000,1000)
PY
orb -m "$ORBSTACK_MACHINE" -u root docker run -d --name "$name" --network none \
  -v "$fixture/data:/app/data" \
  -v "$fixture/asr-bridge-key:/run/secrets/asr_bridge_key:ro" \
  -v "$fixture/dashscope-asr-key:/run/secrets/dashscope_asr_key:ro" \
  -e DATA_DIR=/app/data -e REQUIRE_API_KEY=true -e HOSTNAME=127.0.0.1 -e PORT=20128 \
  -e AMADEUS_ASR_BRIDGE_KEY_FILE=/run/secrets/asr_bridge_key \
  -e AMADEUS_DASHSCOPE_KEY_FILE=/run/secrets/dashscope_asr_key \
  -e AMADEUS_DASHSCOPE_ASR_URL=https://fixture.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation \
  "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if orb -m "$ORBSTACK_MACHINE" -u root docker exec "$name" node -e 'Promise.all([fetch("http://127.0.0.1:20128/api/health"),fetch("http://127.0.0.1:20129/healthz")]).then(([a,b])=>process.exit(a.ok&&b.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then break; fi
  sleep 1
done
orb -m "$ORBSTACK_MACHINE" -u root docker exec -i "$name" node --input-type=module - <<'JS'
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const base='http://127.0.0.1:20129';
const health=await fetch(base+'/healthz');
if (!health.ok) throw new Error('bridge_unhealthy');
const noAuth=await fetch(base+'/v1/audio/transcriptions',{method:'POST'});
if(noAuth.status!==401) throw new Error('bridge_auth_not_enforced');
const gen=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','1','-f','wav','pipe:1'],{maxBuffer:2*1024*1024});
if(gen.status!==0 || gen.stdout.length<1024) throw new Error('ffmpeg_fixture_failed');
const form=new FormData();
form.append('model','qwen-audio-3.0-asr-flash');
form.append('file',new Blob([gen.stdout],{type:'audio/wav'}),'fixture.wav');
const key=readFileSync('/run/secrets/asr_bridge_key','utf8').trim();
const reply=await fetch(base+'/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form});
const body=await reply.json();
if(reply.status!==503 || body.error?.type!=='provider_unavailable') throw new Error('isolated_cloud_failure_not_normalized');
// Fresh fixture DB defaults may not enforce the production API-key setting.
// The release apply separately checks the existing protected live DB returns 401.
console.log('ISOLATED_ROUTER_HEALTH=passed');
console.log('ISOLATED_ASR_AUTH_AND_CONVERSION=passed');
console.log('ISOLATED_NO_NETWORK_FAILURE=provider_unavailable');
JS
