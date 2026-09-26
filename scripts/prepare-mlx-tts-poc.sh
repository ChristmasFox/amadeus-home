#!/usr/bin/env bash
# Prepare pinned community MLX assets only; never touches the running LaunchAgent/profile/token.
set -Eeuo pipefail
MODE="${1:---dry-run}"
case "$MODE" in --dry-run|--apply) ;; *) echo 'Usage: prepare-mlx-tts-poc.sh [--dry-run|--apply]' >&2; exit 2;; esac
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 Apple Silicon host required' >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$REPO/infra/macos/qwen3-tts-engine.json"
REQUIREMENTS="$REPO/infra/macos/requirements-mlx-tts.txt"
ROOT="${AMADEUS_MLX_POC_ROOT:-$HOME/Library/Application Support/Amadeus/speech/mlx-poc}"
SOURCE="$ROOT/mlx-audio"
VENV="$ROOT/venv"
MODEL="$ROOT/model-8bit"
REV="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["mlxSourceRevision"])' "$CONFIG")"
MODEL_ID="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["mlxModelId"])' "$CONFIG")"
MODEL_REV="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["mlxModelRevision"])' "$CONFIG")"
printf 'MODE=%s\nBACKEND=community-mlx-audio@%s\nMODEL=%s@%s\n' "$MODE" "$REV" "$MODEL_ID" "$MODEL_REV"
[[ "$MODE" == --apply ]] || exit 0
umask 077
mkdir -p "$ROOT" "$ROOT/cache"
chmod 700 "$ROOT" "$ROOT/cache"
if [[ ! -d "$SOURCE/.git" ]]; then
  git clone --filter=blob:none https://github.com/Blaizzy/mlx-audio.git "$SOURCE"
  git -C "$SOURCE" checkout --detach "$REV"
fi
[[ "$(git -C "$SOURCE" rev-parse HEAD)" == "$REV" ]] || { echo 'MLX source revision mismatch; inspect before proceeding' >&2; exit 1; }
[[ -x "$VENV/bin/python" ]] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --disable-pip-version-check -c "$REQUIREMENTS" -e "$SOURCE[tts]" \
  soundfile imageio-ffmpeg psutil socksio sentencepiece
HF_HOME="$ROOT/cache" "$VENV/bin/python" - "$MODEL" "$MODEL_ID" "$MODEL_REV" <<'PYMODEL'
from huggingface_hub import snapshot_download
import sys
snapshot_download(sys.argv[2], revision=sys.argv[3], local_dir=sys.argv[1])
print('PINNED_MLX_MODEL=ready (weights outside Git)')
PYMODEL
python3 "$REPO/infra/macos/verify-qwen3-mlx-assets.py" --root "$ROOT" --config "$CONFIG" --write-manifest --apply
