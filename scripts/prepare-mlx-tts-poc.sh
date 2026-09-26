#!/usr/bin/env bash
# Isolated community MLX PoC only; never touches production LaunchAgent/model/profile.
set -Eeuo pipefail
MODE="${1:---dry-run}"
case "$MODE" in --dry-run|--apply) ;; *) echo 'Usage: prepare-mlx-tts-poc.sh [--dry-run|--apply]' >&2; exit 2;; esac
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 Apple Silicon host required' >&2; exit 1; }
ROOT="${AMADEUS_MLX_POC_ROOT:-$HOME/Library/Application Support/Amadeus/speech/mlx-poc}"
SOURCE="$ROOT/mlx-audio"
VENV="$ROOT/venv"
MODEL="$ROOT/model-8bit"
REV='4ab7e6f7dedd69a136cfaa318c5dc8aed5119446'
MODEL_REV='e7dd0585652209fa0d7783659aad4e8a324de11c'
printf 'MODE=%s\nBACKEND=community-mlx-audio@%s\nMODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit@%s\n' "$MODE" "$REV" "$MODEL_REV"
[[ "$MODE" == --apply ]] || exit 0
umask 077
mkdir -p "$ROOT" "$ROOT/cache"
chmod 700 "$ROOT" "$ROOT/cache"
if [[ ! -d "$SOURCE/.git" ]]; then
  git clone --depth 1 https://github.com/Blaizzy/mlx-audio.git "$SOURCE"
fi
[[ "$(git -C "$SOURCE" rev-parse HEAD)" == "$REV" ]] || { echo 'MLX source revision mismatch; inspect before proceeding' >&2; exit 1; }
[[ -x "$VENV/bin/python" ]] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --disable-pip-version-check -e "$SOURCE[tts]" socksio==1.0.0 psutil==7.2.2 imageio-ffmpeg==0.6.0
HF_HOME="$ROOT/cache" "$VENV/bin/python" - "$MODEL" "$MODEL_REV" <<'PY'
from huggingface_hub import snapshot_download
import sys
snapshot_download('mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit',revision=sys.argv[2],local_dir=sys.argv[1])
print('PINNED_MLX_MODEL=ready (weights outside Git)')
PY
