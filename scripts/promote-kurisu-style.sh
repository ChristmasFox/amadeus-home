#!/usr/bin/env bash
# Promote one protected tuner proposal into the Git-tracked canonical style.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE=dry-run
PROPOSAL=""
while (($#)); do
  case "$1" in
    --proposal) [[ $# -ge 2 ]] || { echo '--proposal requires an id or path' >&2; exit 2; }; PROPOSAL="$2"; shift 2 ;;
    --dry-run) MODE=dry-run; shift ;;
    --apply) MODE=apply; shift ;;
    *) echo 'Usage: scripts/promote-kurisu-style.sh --proposal ID|PATH [--dry-run|--apply]' >&2; exit 2 ;;
  esac
done
[[ -n "$PROPOSAL" ]] || { echo '--proposal is required' >&2; exit 2; }
STYLE="$ROOT/apps/qwen3-tts-service/kurisu_style.json"
TUNER_DIR="${AMADEUS_TTS_TUNER_DIR:-$HOME/Library/Application Support/Amadeus/speech/tuner}"
if [[ "$PROPOSAL" = /* ]]; then
  P="$PROPOSAL"
else
  [[ "$PROPOSAL" != */* ]] || { echo 'proposal id must be a protected id or absolute path' >&2; exit 2; }
  P="$TUNER_DIR/proposals/$PROPOSAL.json"
fi
PROPOSAL_ROOT="$(cd "$TUNER_DIR/proposals" 2>/dev/null && pwd -P || true)"
P_PARENT="$(cd "$(dirname "$P")" 2>/dev/null && pwd -P || true)"
[[ -n "$PROPOSAL_ROOT" && "$P_PARENT" == "$PROPOSAL_ROOT" ]] || { echo 'proposal_must_be_in_protected_tuner_directory' >&2; exit 1; }
[[ -f "$P" && ! -L "$P" ]] || { echo 'proposal_not_found' >&2; exit 1; }
python3 - "$ROOT" "$STYLE" "$P" "$MODE" <<'PY'
import hashlib, json, os, sys
from pathlib import Path
root, style_path, proposal_path, mode = sys.argv[1:]
proposal = json.loads(Path(proposal_path).read_text(encoding='utf-8'))
style = json.loads(Path(style_path).read_text(encoding='utf-8'))
def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
current = digest(style)
if proposal.get('expectedProductionStyleHash') != current:
    raise SystemExit('stale_production_style')
candidate = proposal.get('candidate')
if not isinstance(candidate, dict) or candidate.get('emotion') not in style.get('emotions', {}):
    raise SystemExit('invalid_candidate')
baseline, delta = candidate.get('baseline'), candidate.get('delta')
if not isinstance(baseline, str) or not baseline.strip() or len(baseline) > 4000 or not isinstance(delta, str) or len(delta) > 4000:
    raise SystemExit('invalid_candidate')
next_style = json.loads(json.dumps(style, ensure_ascii=False))
next_style['baseline'] = baseline
emotion = candidate['emotion']
next_style['emotions'][emotion]['instruct'] = delta
next_style['emotions'][emotion]['generationOverrides'] = candidate.get('generationOverrides', {})
next_hash = digest(next_style)
print(f'MODE={mode}')
print(f'CURRENT_STYLE_HASH={current}')
print(f'PROPOSED_STYLE_HASH={next_hash}')
print(f'EMOTION={emotion}')
print(f'PROPOSAL_ID={proposal.get("id", "unknown")}')
if mode == 'dry-run':
    raise SystemExit(0)
Path(style_path).write_text(json.dumps(next_style, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
os.chmod(style_path, 0o644)
print(f'UPDATED={style_path}')
PY
if [[ "$MODE" == apply ]]; then
  python3 -m py_compile "$ROOT/apps/qwen3-tts-service/kurisu_style.py" "$ROOT/apps/qwen3-tts-service/service.py" "$ROOT/apps/qwen3-tts-service/tuner.py"
  if command -v curl >/dev/null 2>&1; then
    nonce="$(curl -fsS --max-time 2 http://127.0.0.1:18793/api/v1/config | python3 -c 'import json,sys; print(json.load(sys.stdin)["csrfNonce"])')"
    curl -fsS --max-time 3 -X POST -H 'Content-Type: application/json' -H "X-Amadeus-CSRF: $nonce" --data '{}' http://127.0.0.1:18793/api/v1/reload >/dev/null
    echo 'STYLE_RELOAD=passed'
  else
    echo 'STYLE_RELOAD=unavailable' >&2
    exit 1
  fi
fi
