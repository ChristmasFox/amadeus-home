#!/usr/bin/env bash
# Protected rollback checkpoint for the resident A (MLX) TTS runtime.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"
MODE=dry-run
case "${1:---dry-run}" in --dry-run) ;; --apply) MODE=apply ;; *) echo 'Usage: checkpoint-qwen3-tts-a.sh [--dry-run|--apply]' >&2; exit 2;; esac
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 required' >&2; exit 1; }
BASE="$HOME/Library/Application Support/Amadeus/speech"
MLX_ROOT="$BASE/mlx-poc"
VOICE="$HOME/Library/Application Support/Amadeus/voices/kurisu-v1"
TOKEN="$BASE/tts.token"
PLIST="$HOME/Library/LaunchAgents/com.amadeus.qwen3-tts.plist"
CONFIG="$ROOT/infra/macos/qwen3-tts-engine.json"
BACKUP_ROOT="${SKULD_BACKUP_ROOT:-/Volumes/Avalon/backups/operation-skuld}/qwen3-tts-a"
printf 'MODE=%s\nENGINE=A\nBASE=%s\nBACKUP_ROOT=%s\n' "$MODE" "$BASE" "$BACKUP_ROOT"
if [[ "$MODE" == dry-run ]]; then
  printf '%s\n' 'PLAN=preflight live MLX -> copy protected files/metadata -> syntax-check rollback script'
  exit 0
fi
[[ -d "$EXTERNAL_STORAGE_ROOT" ]] || { echo 'external storage is not mounted' >&2; exit 1; }
[[ "$BACKUP_ROOT" == "$EXTERNAL_STORAGE_ROOT/"* ]] || { echo 'checkpoint must stay on external storage' >&2; exit 1; }
for path in "$VOICE/reference.wav" "$VOICE/reference.txt" "$TOKEN" "$PLIST" "$BASE/service.py" "$BASE/mlx_engine.py" "$BASE/engine_contract.py" "$BASE/requirements.txt" "$MLX_ROOT/model-8bit/config.json"; do
  [[ -s "$path" ]] || { echo "required A runtime asset missing: $path" >&2; exit 1; }
done
[[ "$(stat -f %Lp "$TOKEN")" == 600 && "$(stat -f %Lp "$VOICE/reference.wav")" == 600 && "$(stat -f %Lp "$VOICE/reference.txt")" == 600 ]] || { echo 'A token/reference permissions are not 0600' >&2; exit 1; }
health="$(curl -sS --max-time 3 http://127.0.0.1:18794/healthz || true)"
python3 - "$health" <<'PY'
import json, sys
value = json.loads(sys.argv[1])
if value.get('status') != 'ready' or value.get('model') != 'qwen3-tts-1.7b':
    raise SystemExit('A runtime is not ready; checkpoint refused')
PY
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_ROOT/a-$stamp"
umask 077
mkdir -p "$out"; chmod 700 "$out"
python3 - "$out" "$BASE" "$MLX_ROOT" "$VOICE" "$TOKEN" "$PLIST" "$CONFIG" "$ROOT" "$health" <<'PY'
from datetime import datetime, timezone
import hashlib, json, os, shutil, subprocess, sys
from pathlib import Path
paths, health = sys.argv[1:-1], sys.argv[-1]
out,base,mlx,voice,token,plist,config,repo = map(Path, paths)
def cp(source, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, dest); dest.chmod(0o600)
for source, dest in ((base/'service.py',out/'runtime/service.py'),(base/'mlx_engine.py',out/'runtime/mlx_engine.py'),(base/'engine_contract.py',out/'runtime/engine_contract.py'),(base/'requirements.txt',out/'runtime/requirements.txt'),(plist,out/'runtime/com.amadeus.qwen3-tts.plist'),(config,out/'runtime/qwen3-tts-engine.json'),(voice/'reference.wav',out/'voice/reference.wav'),(voice/'reference.txt',out/'voice/reference.txt'),(token,out/'voice/tts.token')): cp(source,dest)
(out/'runtime').chmod(0o700); (out/'voice').chmod(0o700)
# Capture only non-secret runtime facts; token contents and environment values are never printed.
launchctl = subprocess.run(['launchctl','print',f'gui/{os.getuid()}/com.amadeus.qwen3-tts'],capture_output=True,text=True).stdout
(out/'runtime/launchctl.txt').write_text(launchctl); (out/'runtime/launchctl.txt').chmod(0o600)
(out/'runtime/healthz.json').write_text(health+'\n'); (out/'runtime/healthz.json').chmod(0o600)
try: pids=subprocess.check_output(['pgrep','-f','qwen3-tts'],text=True)
except subprocess.CalledProcessError: pids=''
(out/'runtime/pids.txt').write_text(pids); (out/'runtime/pids.txt').chmod(0o600)
try: last=subprocess.check_output(['launchctl','print','system'],text=True,stderr=subprocess.DEVNULL)[:1]
except Exception: last=''
(out/'runtime/last-exit.txt').write_text('captured via launchctl print; see launchctl.txt\n'+last); (out/'runtime/last-exit.txt').chmod(0o600)
# Immutable reconstruction facts for the MLX model; weights remain at their operator-owned path.
model_manifest=[]
for path in sorted((mlx/'model-8bit').rglob('*')):
    if path.is_file():
        item={'path':str(path.relative_to(mlx/'model-8bit')),'bytes':path.stat().st_size}
        if path.name in {'config.json','generation_config.json','tokenizer_config.json'}:
            item['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        model_manifest.append(item)
(out/'runtime/mlx-model-manifest.json').write_text(json.dumps({'root':str(mlx/'model-8bit'),'files':model_manifest},indent=2)+'\n'); (out/'runtime/mlx-model-manifest.json').chmod(0o600)
try: commit=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
except Exception: commit='unknown'
manifest={'createdAt':datetime.now(timezone.utc).isoformat(),'repoCommit':commit,'engine':'mlx','model':'qwen3-tts-1.7b','voice':'kurisu-v1','healthz':json.loads(health),'runtimeBase':str(base),'modelRoot':str(mlx/'model-8bit'),'files':[]}
for path in sorted(out.rglob('*')):
    if path.is_file() and path.name not in {'manifest.json'}:
        item={'path':str(path.relative_to(out)),'bytes':path.stat().st_size,'mode':oct(path.stat().st_mode&0o777)}
        if path.name not in {'tts.token','reference.wav'}: item['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        manifest['files'].append(item)
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'); (out/'manifest.json').chmod(0o600)
PY
cat > "$out/rollback-a.sh" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
BASE="$BASE"
VOICE="$VOICE"
PLIST="$PLIST"
CHECKPOINT="$out"
TARGET="gui/\$(id -u)"
launchctl bootout "\$TARGET/com.amadeus.qwen3-tts" 2>/dev/null || true
install -m 600 "\$CHECKPOINT/runtime/service.py" "\$BASE/service.py"
install -m 600 "\$CHECKPOINT/runtime/mlx_engine.py" "\$BASE/mlx_engine.py"
install -m 600 "\$CHECKPOINT/runtime/engine_contract.py" "\$BASE/engine_contract.py"
install -m 600 "\$CHECKPOINT/runtime/requirements.txt" "\$BASE/requirements.txt"
install -m 600 "\$CHECKPOINT/runtime/com.amadeus.qwen3-tts.plist" "\$PLIST"
install -m 600 "\$CHECKPOINT/voice/reference.wav" "\$VOICE/reference.wav"
install -m 600 "\$CHECKPOINT/voice/reference.txt" "\$VOICE/reference.txt"
install -m 600 "\$CHECKPOINT/voice/tts.token" "\$BASE/tts.token"
plutil -lint "\$PLIST"
launchctl bootstrap "\$TARGET" "\$PLIST"
launchctl enable "\$TARGET/com.amadeus.qwen3-tts"
for i in \$(seq 1 120); do
  if curl -fsS --max-time 2 http://127.0.0.1:18794/healthz | grep -q '"status":"ready"'; then break; fi
  [[ "\$i" == 120 ]] && { echo 'rollback health timeout' >&2; exit 1; }
  sleep 1
done
TOKEN=\$(cat "\$BASE/tts.token")
curl -fsS --max-time 120 -H "Authorization: Bearer \$TOKEN" -H 'Content-Type: application/json' \\
  -d '{"model":"qwen3-tts-1.7b","voice":"kurisu-v1","input":"rollback smoke","response_format":"wav"}' \\
  -o /dev/null http://127.0.0.1:18794/v1/audio/speech
printf '%s\\n' 'QWEN3_TTS_A_ROLLBACK=passed'
EOF
chmod 700 "$out/rollback-a.sh"
bash -n "$out/rollback-a.sh"
printf 'QWEN3_TTS_A_CHECKPOINT=%s\n' "$out"
printf '%s\n' 'QWEN3_TTS_A_ROLLBACK_SCRIPT=syntax-passed'
