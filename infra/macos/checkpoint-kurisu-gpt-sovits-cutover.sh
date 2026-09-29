#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"

MODE=dry-run
case "${1:---dry-run}" in
  --dry-run) ;;
  --apply) MODE=apply ;;
  *) echo 'Usage: checkpoint-kurisu-gpt-sovits-cutover.sh [--dry-run|--apply]' >&2; exit 2 ;;
esac

[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 required' >&2; exit 1; }
BASE="$HOME/Library/Application Support/Amadeus/speech"
VOICE="$HOME/Library/Application Support/Amadeus/voices/kurisu-v1"
PLIST="$HOME/Library/LaunchAgents/com.amadeus.qwen3-tts.plist"
OMINIX="$BASE/ominix"
MLX_MODEL="$BASE/mlx-poc/model-8bit"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$SKULD_BACKUP_ROOT/kurisu-gpt-sovits-cutover-$STAMP"

printf 'MODE=%s\nBACKUP=%s\n' "$MODE" "$OUT"
for path in "$BASE/service.py" "$BASE/ominix_engine.py" "$BASE/engine_contract.py" "$BASE/kurisu_style.py" "$BASE/kurisu_style.json" "$BASE/tuner.py" "$BASE/tts.token" "$PLIST" "$OMINIX" "$MLX_MODEL" "$VOICE"; do
  [[ -e "$path" ]] || { echo "missing rollback asset: $path" >&2; exit 1; }
done
for path in "$OMINIX" "$MLX_MODEL" "$VOICE"; do
  [[ "$(find "$path" -type l -print -quit)" == "" ]] || { echo "symlink in rollback asset: $path" >&2; exit 1; }
done

echo '--- runtime-before ---'
launchctl print "gui/$(id -u)/com.amadeus.qwen3-tts" 2>/dev/null | grep -E 'state =|pid =|path =|last exit code =' || true
for port in 18792 18793 19870 56708; do
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 || true
done
curl -sS --max-time 3 http://127.0.0.1:18792/healthz || true
printf '\n'

if [[ "$MODE" == dry-run ]]; then
  du -sh "$OMINIX" "$MLX_MODEL" "$VOICE"
  exit 0
fi

free_kib="$(df -Pk "$SKULD_BACKUP_ROOT" | awk 'NR==2 {print $4}')"
(( free_kib >= 8 * 1024 * 1024 )) || { echo 'insufficient Avalon free space for rollback checkpoint' >&2; exit 1; }
mkdir -p "$OUT"; chmod 700 "$OUT"
cp -R "$OMINIX" "$OUT/ominix"
cp -R "$MLX_MODEL" "$OUT/mlx-poc-model-8bit"
cp -R "$VOICE" "$OUT/kurisu-v1"
for file in service.py ominix_engine.py engine_contract.py kurisu_style.py kurisu_style.json tuner.py; do cp "$BASE/$file" "$OUT/$file"; done
cp "$BASE/tts.token" "$OUT/tts.token"
cp "$PLIST" "$OUT/com.amadeus.qwen3-tts.plist"
launchctl print "gui/$(id -u)/com.amadeus.qwen3-tts" > "$OUT/launchd-before.txt" 2>&1 || true
for port in 18792 18793 19870 56708; do lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true; done > "$OUT/listeners-before.txt"
curl -sS --max-time 3 http://127.0.0.1:18792/healthz > "$OUT/ominix-health-before.json" || true
git -C "$ROOT" rev-parse HEAD > "$OUT/repo-commit"
printf '%s\n' "$STAMP" > "$OUT/created-at-utc"
find "$OUT" -type d -exec chmod 700 {} +
find "$OUT" -type f -exec chmod 600 {} +
python3 - "$OUT" <<'PY'
from pathlib import Path
import hashlib,json,sys
root=Path(sys.argv[1])
manifest={}
for path in sorted(p for p in root.rglob('*') if p.is_file()):
    manifest[str(path.relative_to(root))]={'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(root/'manifest.json').chmod(0o600)
print('ROLLBACK_CHECKPOINT=created (values suppressed)')
PY
printf 'CHECKPOINT=%s\n' "$OUT"
