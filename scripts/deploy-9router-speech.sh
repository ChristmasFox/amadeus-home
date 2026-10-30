#!/usr/bin/env bash
# Repository-managed, explicit 9Router speech image deployment on M204 CasaOS.
# After the speech-secret preflight this delegates to scripts/deploy-9router.sh, which owns
# the build (protected account policy injected into a temporary context), the isolated
# fixture, the checkpoint and the health/rollback logic. The previous inline build path
# predated the policy-injecting Dockerfile and could not produce a deployable image.
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
node infra/docker/casaos/9router/test-tts-bridge.mjs >/dev/null
node --check infra/docker/casaos/9router/tts-bridge.mjs
node --check infra/docker/casaos/9router/start-9router.mjs
pnpm check:secrets
# Missing operator keys/config must fail *before* checkpoint, build or mutation.
orb -m "$MACHINE" -u root python3 - "$DATA_DIR" "$ALLOW_QWENAI" <<'PY'
from pathlib import Path
import os,sys
base=Path(sys.argv[1]); allow_qwenai=sys.argv[2]=='1'; env=base/'9router.env'
for name in ('asr-upstream-api-key','asr-bridge-key','tts-bridge-key','tts-cloud-api-key','tts-cloud-voice-id-31','tts-cloud-voice-id','tts-local-key'):
    p=base/'secrets'/name
    if p.is_symlink() or not p.is_file() or not p.stat().st_size or p.stat().st_mode & 0o077 or p.stat().st_uid != 1000:
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
tts_urls=[line.split('=',1)[1].strip() for line in env.read_text().splitlines() if line.startswith('AMADEUS_TTS_CLOUD_URL=')]
if len(tts_urls)!=1:
    raise SystemExit('TTS cloud endpoint missing/ambiguous')
tu=urlparse(tts_urls[0]); allowed=(tu.hostname or '').endswith('.maas.aliyuncs.com') or tu.hostname in ('dashscope.aliyuncs.com','maas.qianwenaiapi.com')
if tu.scheme!='https' or not allowed or tu.path!='/api/v1/services/audio/tts/SpeechSynthesizer':
    raise SystemExit('TTS cloud endpoint not allowlisted')
print('SPEECH_SECRET_PREFLIGHT=passed (values suppressed)')
PY
# The protected account policy lives outside Git (docs/PRODUCTION_9ROUTER_POLICY_MIGRATION.md).
# Prefer this checkout's .local copy, then the primary checkout's, unless the caller set a path.
if [[ -z "${AMADEUS_9ROUTER_PRIVATE_POLICY_FILE:-}" ]]; then
  for candidate in "$ROOT/.local/9router-production-policy.json" "$HOME/amadeus-home/.local/9router-production-policy.json"; do
    if [[ -r "$candidate" ]]; then export AMADEUS_9ROUTER_PRIVATE_POLICY_FILE="$candidate"; break; fi
  done
fi
exec "$ROOT/scripts/deploy-9router.sh" --apply --build
