#!/usr/bin/env bash
# Explicit single-runtime technical acceptance; never sends a WhatsApp message or fakes owner hearing.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE=--dry-run
BENCHMARK=0
while (($#)); do
  case "$1" in
    --dry-run|--apply) MODE="$1" ;;
    --benchmark) BENCHMARK=1 ;;
    *) echo 'Usage: scripts/accept-voice.sh [--dry-run|--apply] [--benchmark]' >&2; exit 2 ;;
  esac
  shift
done
if ((BENCHMARK)) && [[ "$MODE" != --apply ]]; then echo '--benchmark requires --apply' >&2; exit 2; fi
printf 'MODE=%s\n' "$MODE"
if [[ "$MODE" == --dry-run ]]; then
  echo 'PLAN=read-only verify selected engine/source/health/channel/markers and memory; optional --apply --benchmark runs five protected fixture requests only in a controlled quiet window. Real owner handset acceptance remains separate.'
  exit 0
fi
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 host required' >&2; exit 1; }
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"
ENGINE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["productionEngine"])' "$ROOT/infra/macos/qwen3-tts-engine.json")"
PLIST="$HOME/Library/LaunchAgents/com.amadeus.qwen3-tts.plist"
BASE="$HOME/Library/Application Support/Amadeus/speech"
LIVE_ENGINE="$(plutil -extract EnvironmentVariables.AMADEUS_TTS_ENGINE raw "$PLIST")"
[[ "$ENGINE" == "$LIVE_ENGINE" ]] || { echo 'source/live TTS engine mismatch' >&2; exit 1; }
for name in service.py mlx_engine.py engine_contract.py; do
  cmp -s "$ROOT/apps/qwen3-tts-service/$name" "$BASE/$name" || { echo "source/live mismatch: $name" >&2; exit 1; }
done
if [[ "$ENGINE" == mlx ]]; then
  python3 "$ROOT/infra/macos/verify-qwen3-mlx-assets.py" \
    --root "$BASE/mlx-poc" --config "$ROOT/infra/macos/qwen3-tts-engine.json"
fi
/usr/bin/curl --fail --silent --show-error --max-time 3 http://127.0.0.1:18792/healthz | python3 -c '
import json,sys
state=json.load(sys.stdin)
if state.get("status")!="ready" or state.get("model")!="qwen3-tts-1.7b" or state.get("voice")!="kurisu-v1":raise SystemExit("TTS health/model/voice mismatch")
print("TTS_HEALTH=ready")'
OPENCLAW_HEALTH="$(orb -m "$ORBSTACK_MACHINE" -u root docker inspect openclaw --format '{{.State.Health.Status}}')"
[[ "$OPENCLAW_HEALTH" == healthy ]] || { echo 'OpenClaw unhealthy' >&2; exit 1; }
orb -m "$ORBSTACK_MACHINE" -u root docker exec openclaw node dist/index.js channels status --json | python3 -c '
import json,sys
channels=json.load(sys.stdin).get("channels",{})
whatsapp=channels.get("whatsapp",{})
if not all(whatsapp.get(key) is True for key in ("linked","running","connected")):
 raise SystemExit("WhatsApp candidate not linked/running/connected")
print("WHATSAPP_CHANNEL=linked,running,connected")'
core_marker="$(orb -m "$ORBSTACK_MACHINE" -u root docker exec openclaw sh -lc 'grep -l "amadeus-whatsapp-japanese-tts-input-v1" /app/dist/runtime-api-*.mjs | wc -l' | tr -d '[:space:]')"
voice_marker="$(orb -m "$ORBSTACK_MACHINE" -u root docker exec openclaw sh -lc 'grep -Rl "amadeus-whatsapp-japanese-audio-guard-v1" /home/node/.openclaw/npm/projects --include="monitor-*.js" 2>/dev/null | wc -l' | tr -d '[:space:]')"
[[ "$core_marker" == 1 && "$voice_marker" == 1 ]] || { echo 'pinned Voice patch markers not unique' >&2; exit 1; }
if ((BENCHMARK)); then
  OUT_ROOT="${AMADEUS_TTS_ACCEPT_ROOT:-$SKULD_BACKUP_ROOT/qwen3-tts-acceptance}"
  [[ "$OUT_ROOT" == /* && "$OUT_ROOT" != "$ROOT"/* ]] || { echo 'external absolute evidence root required' >&2; exit 1; }
  umask 077
  mkdir -p "$OUT_ROOT"
  [[ ! -L "$OUT_ROOT" && "$(stat -f %Lp "$OUT_ROOT")" == 700 ]] || { echo 'private evidence root required' >&2; exit 1; }
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  OUT="$OUT_ROOT/voice-technical-$STAMP"
  mkdir -m 700 "$OUT"
  "$BASE/venv/bin/python" "$ROOT/apps/qwen3-tts-service/endpoint_benchmark.py" \
    --apply --bucket short --runs 5 --token-file "$BASE/tts.token" --output "$OUT/endpoint-short.jsonl" > "$OUT/endpoint.log" 2>&1
  python3 - "$OUT/endpoint-short.jsonl" <<'PY'
from pathlib import Path
import json,statistics,sys
rows=[json.loads(x) for x in Path(sys.argv[1]).read_text().splitlines()]
if len(rows)!=5 or not all(x['success'] for x in rows):raise SystemExit('endpoint benchmark incomplete')
values=sorted(x['total_ms'] for x in rows)
p95=values[3]+.8*(values[4]-values[3])
print(f'ENDPOINT_SHORT_N=5 P50_MS={statistics.median(values):.1f} P95_MS={p95:.1f} MIN_MS={values[0]:.1f} MAX_MS={values[-1]:.1f}')
PY
fi
pid="$(launchctl print "gui/$(id -u)/com.amadeus.qwen3-tts" 2>/dev/null | awk '/pid =/{print $3;exit}')"
[[ "$pid" =~ ^[0-9]+$ ]] || { echo 'TTS LaunchAgent PID unavailable' >&2; exit 1; }
vmmap -summary "$pid" 2>/dev/null | grep '^Physical footprint' | head -2
memory_pressure -Q | tail -1
sysctl vm.swapusage
printf 'VOICE_RUNTIME_TECHNICAL=passed\nOWNER_HANDSET=manual_required\n'
if ((BENCHMARK)); then printf 'BENCHMARK_EVIDENCE=%s\n' "$OUT"; else printf 'BENCHMARK=not_run_read_only\n'; fi
