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
for name,value in [('asr-bridge-key','fixture-bridge-'+'x'*48),('asr-upstream-key','fixture-cloud-'+'y'*48)]:
    f=p/name; f.write_text(value); f.chmod(0o600); os.chown(f,1000,1000)
PY
orb -m "$ORBSTACK_MACHINE" -u root docker run -d --name "$name" --network none \
  -v "$fixture/data:/app/data" \
  -v "$fixture/asr-bridge-key:/run/secrets/asr_bridge_key:ro" \
  -v "$fixture/asr-upstream-key:/run/secrets/asr_upstream_key:ro" \
  -e DATA_DIR=/app/data -e REQUIRE_API_KEY=true -e INITIAL_PASSWORD=test-only -e HOSTNAME=127.0.0.1 -e PORT=20128 \
  -e AMADEUS_ASR_BRIDGE_KEY_FILE=/run/secrets/asr_bridge_key \
  -e AMADEUS_ASR_UPSTREAM_KEY_FILE=/run/secrets/asr_upstream_key \
  -e AMADEUS_ASR_UPSTREAM_URL=https://fixture.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation \
  "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if orb -m "$ORBSTACK_MACHINE" -u root docker exec "$name" node -e 'Promise.all([fetch("http://127.0.0.1:20128/api/health"),fetch("http://127.0.0.1:20129/healthz")]).then(([a,b])=>process.exit(a.ok&&b.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then break; fi
  sleep 1
done
orb -m "$ORBSTACK_MACHINE" -u root docker exec -i "$name" node --input-type=module - <<'JS'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
const processes=readdirSync('/proc').filter(name=>/^\d+$/.test(name)).flatMap(name=>{
  try{return [{args:readFileSync('/proc/'+name+'/cmdline','utf8'),env:readFileSync('/proc/'+name+'/environ','utf8')}]}catch{return []}
});
const bridgeProc=processes.find(p=>p.args.includes('/opt/amadeus/asr-bridge.mjs'));
const routerProc=processes.find(p=>p.args.includes('/usr/local/lib/node_modules/9router/app/custom-server.js'));
if(!bridgeProc?.env.includes('NODE_USE_ENV_PROXY=1') || !routerProc || routerProc.env.includes('NODE_USE_ENV_PROXY=1'))
  throw new Error('scoped_asr_proxy_env_missing_or_globalized');
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
// Exercise the actual 9Router connection + alias layer, not only the bridge.
const routerBase='http://127.0.0.1:20128';
const login=await fetch(routerBase+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-only'})});
if(!login.ok) throw new Error('fixture_dashboard_login_'+login.status);
const cookie=login.headers.get('set-cookie')?.split(';')[0];
if(!cookie) throw new Error('fixture_cookie_missing');
const admin=async (method,path,body) => fetch(routerBase+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
const keyReply=await admin('POST','/api/keys',{name:'fixture-key'});
if(keyReply.status!==201) throw new Error('fixture_key_create_'+keyReply.status);
const routerKey=(await keyReply.json()).key;
if(!routerKey) throw new Error('fixture_key_missing');
writeFileSync('/app/data/fixture-router-key',routerKey,{mode:0o600});
const stt=await admin('POST','/api/providers',{provider:'selfhosted-stt',name:'fixture STT',apiKey:key,providerSpecificData:{baseUrl:base+'/v1/audio/transcriptions'}});
if(stt.status!==201) throw new Error('fixture_stt_provider_'+stt.status);
const asrAlias=await admin('PUT','/api/models/alias',{alias:'amadeus-asr',model:'selfhosted-stt/qwen-audio-3.0-asr-flash'});
if(!asrAlias.ok) throw new Error('fixture_asr_alias_'+asrAlias.status);
const routed=await fetch(routerBase+'/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+routerKey},body:form});
const routedBody=await routed.json();
const asrAliasRouteOk=routed.status>=400 && JSON.stringify(routedBody).includes('provider_unavailable');
const ttsKey='fixture-tts-'+'z'.repeat(40);
const ttsServer=createServer(async(req,res)=>{
  if(req.url!=='/v1/audio/speech' || req.headers.authorization!=='Bearer '+ttsKey) {res.writeHead(401);res.end();return;}
  const chunks=[];for await(const c of req)chunks.push(c);
  const body=JSON.parse(Buffer.concat(chunks).toString());
  if(body.model!=='qwen3-tts-1.7b'||body.voice!=='kurisu-v1'||body.input!=='fixture reply') {res.writeHead(400);res.end();return;}
  res.writeHead(200,{'Content-Type':'audio/mpeg'});res.end(Buffer.from('ID3fixture'));
});
await new Promise(resolve=>ttsServer.listen(18792,'127.0.0.1',resolve));
try {
  const tts=await admin('POST','/api/providers',{provider:'selfhosted-tts',name:'fixture TTS',apiKey:ttsKey,providerSpecificData:{baseUrl:'http://127.0.0.1:18792'}});
  if(tts.status!==201) throw new Error('fixture_tts_provider_'+tts.status);
  const ttsAlias=await admin('PUT','/api/models/alias',{alias:'amadeus-tts',model:'selfhosted-tts/qwen3-tts-1.7b/kurisu-v1'});
  if(!ttsAlias.ok) throw new Error('fixture_tts_alias_'+ttsAlias.status);
  const speech=await fetch(routerBase+'/v1/audio/speech',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+routerKey},body:JSON.stringify({model:'amadeus-tts',input:'fixture reply'})});
  if(!speech.ok || !Buffer.from(await speech.arrayBuffer()).toString().startsWith('ID3')) throw new Error('fixture_tts_route_'+speech.status);
  console.log('ASR_ALIAS_BEFORE_RESTART='+asrAliasRouteOk+' STATUS='+routed.status);
} finally {ttsServer.close();}
// Fresh fixture DB defaults may not enforce the production API-key setting.
// The release apply separately checks the existing protected live DB returns 401.
console.log('ISOLATED_ROUTER_HEALTH=passed');
console.log('ISOLATED_TTS_ALIAS=passed');
console.log('ISOLATED_ASR_AUTH_AND_CONVERSION=passed');
console.log('ISOLATED_NO_NETWORK_FAILURE=provider_unavailable');
JS

# The upstream Next bundles may cache aliases independently per route. A restart
# is part of the production alias apply gate if required by this fixture.
orb -m "$ORBSTACK_MACHINE" -u root docker restart "$name" >/dev/null
for _ in $(seq 1 60); do
  if orb -m "$ORBSTACK_MACHINE" -u root docker exec "$name" node -e 'fetch("http://127.0.0.1:20128/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then break; fi
  sleep 1
done
orb -m "$ORBSTACK_MACHINE" -u root docker exec -i "$name" node --input-type=module - <<'JS'
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const wav=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','1','-f','wav','pipe:1'],{maxBuffer:2*1024*1024}).stdout;
const form=new FormData();form.append('model','amadeus-asr');form.append('file',new Blob([wav],{type:'audio/wav'}),'fixture.wav');
const key=readFileSync('/app/data/fixture-router-key','utf8');
const reply=await fetch('http://127.0.0.1:20128/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form});
const payload=await reply.json();
if(reply.status<400 || !JSON.stringify(payload).includes('provider_unavailable'))
  throw new Error('asr_alias_after_restart_'+reply.status+'_'+String(payload.error?.message||'unknown').slice(0,90));
console.log('ISOLATED_ASR_ALIAS_AFTER_RESTART=passed');
JS
