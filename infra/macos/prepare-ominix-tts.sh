#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
ROOT_DIR=""
MODEL_DIR=""
MODE=dry-run
SOURCE_REVISION=4988a3fcfa48b8cb5d0780a501b92c6a41401523
while (($#)); do
  case "$1" in
    --apply) MODE=apply ;;
    --dry-run) MODE=dry-run ;;
    --root) ROOT_DIR="$2"; shift ;;
    --model) MODEL_DIR="$2"; shift ;;
    *) echo "Usage: prepare-ominix-tts.sh [--dry-run|--apply] --root PATH --model PATH" >&2; exit 2 ;;
  esac
  shift
done
[[ -n "$ROOT_DIR" && -n "$MODEL_DIR" ]] || { echo 'root and model are required' >&2; exit 2; }
printf 'MODE=%s\nOMINIX_ROOT=%s\nOMINIX_REVISION=%s\nMODEL=%s\n' "$MODE" "$ROOT_DIR" "$SOURCE_REVISION" "$MODEL_DIR"
[[ "$MODE" == apply ]] || exit 0
command -v cargo >/dev/null 2>&1 || { echo 'cargo_required_for_ominix' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo 'git_required_for_ominix' >&2; exit 1; }
[[ -d "$MODEL_DIR" && -s "$MODEL_DIR/config.json" ]] || { echo 'pinned OminiX model directory missing' >&2; exit 1; }
mkdir -p "$ROOT_DIR"
chmod 700 "$ROOT_DIR"
SOURCE="$ROOT_DIR/source"
if [[ ! -d "$SOURCE/.git" ]]; then
  git clone https://github.com/OminiX-ai/OminiX-MLX.git "$SOURCE"
fi
git -C "$SOURCE" fetch --tags --force origin "$SOURCE_REVISION"
git -C "$SOURCE" checkout --detach "$SOURCE_REVISION"
git -C "$SOURCE" clean -fdx
[[ "$(git -C "$SOURCE" rev-parse HEAD)" == "$SOURCE_REVISION" ]] || { echo 'ominix_source_revision_mismatch' >&2; exit 1; }
python3 "$ROOT/infra/macos/patch-ominix-source.py" "$SOURCE/qwen3-tts-mlx"
BUILD="$ROOT_DIR/worker-build"
rm -rf "$BUILD"
mkdir -p "$BUILD"
python3 - "$ROOT/apps/qwen3-tts-service/ominix-worker/Cargo.toml.template" "$BUILD/Cargo.toml" "$SOURCE" <<'PY'
from pathlib import Path
import sys
template, output, source = map(Path, sys.argv[1:])
output.write_text(template.read_text().replace('__OMINIX_SOURCE__', source.as_posix()))
PY
cp "$ROOT/apps/qwen3-tts-service/ominix-worker/main.rs" "$BUILD/main.rs"
cargo build --release --manifest-path "$BUILD/Cargo.toml" --target-dir "$ROOT_DIR/cargo-target"
install -m 700 "$ROOT_DIR/cargo-target/release/amadeus-ominix-tts-worker" "$ROOT_DIR/worker"
install -m 600 "$ROOT_DIR/cargo-target/release/mlx.metallib" "$ROOT_DIR/mlx.metallib"
rm -rf "$BUILD"
printf '%s\n' 'OMINIX_WORKER=ready (model and reference remain outside Git)'
