#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_FILE="$ROOT_DIR/apps/fashion-siglip/server.py"
REQUIREMENTS_FILE="$ROOT_DIR/apps/fashion-siglip/requirements-macos.txt"
INSTALL_DIR="${FASHION_SIGLIP_INSTALL_DIR:-$HOME/Library/Application Support/ProductRadar/FashionSigLIP}"
LABEL="com.productradar.fashion-siglip"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APPLY=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/install-fashion-siglip-macos.sh [--dry-run] [--apply]
      [--install-dir <path>]

Default is a dry-run. --apply creates a macOS venv, installs MPS-capable
PyTorch/OpenCLIP dependencies, installs a LaunchAgent, starts the native worker
on 0.0.0.0:18400, and waits for health reporting device=mps.
USAGE
}

fail() {
  printf '%s\n' "$*" >&2
  exit 2
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --install-dir)
      (($# >= 2)) || fail '--install-dir requires a value.'
      INSTALL_DIR="$2"
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'INSTALL_DIR=%s\n' "$INSTALL_DIR"
printf 'PLIST=%s\n' "$PLIST"
printf 'ENDPOINT=http://127.0.0.1:18400/health\n'
printf 'DEVICE=mps\n'

if ((APPLY == 0)); then
  printf '%s\n' 'PLAN=create venv, install native macOS PyTorch/OpenCLIP, write LaunchAgent, start worker, wait for MPS health.'
  exit 0
fi

[[ "$(uname -s)" == Darwin ]] || fail 'FashionSigLIP native worker must be installed on macOS.'
[[ "$(uname -m)" == arm64 ]] || fail 'FashionSigLIP MPS worker requires Apple Silicon arm64.'
[[ -f "$SOURCE_FILE" ]] || fail "Worker source not found: $SOURCE_FILE"
[[ -f "$REQUIREMENTS_FILE" ]] || fail "Requirements not found: $REQUIREMENTS_FILE"

mkdir -p "$INSTALL_DIR" "$INSTALL_DIR/logs" "$INSTALL_DIR/models" "$(dirname "$PLIST")"
venv_dir="$INSTALL_DIR/venv"
if [[ ! -x "$venv_dir/bin/python" ]]; then
  python3 -m venv "$venv_dir"
fi
venv_python="$venv_dir/bin/python"
"$venv_python" -m pip install --upgrade pip
"$venv_python" -m pip install -r "$REQUIREMENTS_FILE"
cp -p "$SOURCE_FILE" "$INSTALL_DIR/server.py"

if [[ -f "$PLIST" ]]; then
  backup="$PLIST.codex-backup.$(date +%Y%m%d-%H%M%S)"
  cp -p "$PLIST" "$backup"
  printf 'ROLLBACK_PLIST=%s\n' "$backup"
fi

python3 - "$PLIST" "$INSTALL_DIR" "$venv_python" "$LABEL" <<'PY'
import os
import plistlib
import sys
from pathlib import Path

plist_path = Path(sys.argv[1])
install_dir = Path(sys.argv[2])
python_path = sys.argv[3]
label = sys.argv[4]
model_dir = install_dir / "models"
plist = {
    "Label": label,
    "ProgramArguments": [python_path, str(install_dir / "server.py")],
    "WorkingDirectory": str(install_dir),
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 10,
    "ProcessType": "Interactive",
    "EnvironmentVariables": {
        "FASHION_SIGLIP_MODEL_ID": "Marqo/marqo-fashionSigLIP",
        "FASHION_SIGLIP_MODEL_VERSION": "Marqo/marqo-fashionSigLIP-v1",
        "FASHION_SIGLIP_DEVICE": "mps",
        "FASHION_SIGLIP_BIND": "0.0.0.0",
        "FASHION_SIGLIP_PORT": "18400",
        "FASHION_SIGLIP_THREADS": "4",
        "HF_HOME": str(model_dir / "huggingface"),
        "TRANSFORMERS_CACHE": str(model_dir / "huggingface"),
        "HTTP_PROXY": os.environ.get("FASHION_SIGLIP_HTTP_PROXY", "http://127.0.0.1:7897"),
        "HTTPS_PROXY": os.environ.get("FASHION_SIGLIP_HTTPS_PROXY", "http://127.0.0.1:7897"),
        "ALL_PROXY": os.environ.get("FASHION_SIGLIP_ALL_PROXY", "socks5://127.0.0.1:7897"),
        "NO_PROXY": "localhost,127.0.0.1",
        "no_proxy": "localhost,127.0.0.1",
    },
    "StandardOutPath": str(install_dir / "logs" / "worker.out.log"),
    "StandardErrorPath": str(install_dir / "logs" / "worker.err.log"),
}
plist_path.parent.mkdir(parents=True, exist_ok=True)
with plist_path.open("wb") as stream:
    plistlib.dump(plist, stream, fmt=plistlib.FMT_XML, sort_keys=False)
PY

uid="$(id -u)"
launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$PLIST"
launchctl kickstart -k "gui/$uid/$LABEL"

health=""
for attempt in $(seq 1 360); do
  if health="$(curl --fail --silent --show-error --max-time 3 http://127.0.0.1:18400/health 2>/dev/null)"; then
    break
  fi
  if ((attempt % 12 == 0)); then
    printf 'WAITING_FOR_MPS attempt=%s/360\n' "$attempt"
  fi
  sleep 5
done
[[ -n "$health" ]] || { tail -60 "$INSTALL_DIR/logs/worker.err.log" >&2 || true; fail 'FashionSigLIP worker did not become healthy.'; }
printf '%s\n' "$health"
python3 -c 'import json,sys; payload=json.loads(sys.argv[1]); sys.exit(0 if payload.get("device") == "mps" else 1)' "$health" || fail 'FashionSigLIP worker is healthy but not using MPS.'
printf '%s\n' 'Native macOS FashionSigLIP worker is healthy on MPS.'
