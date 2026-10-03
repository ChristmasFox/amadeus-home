#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

ENGINE_REPOSITORY="${AMADEUS_IMAGE_ENGINE_REPOSITORY:-https://github.com/xocialize/realesrgan-mlx.git}"
ENGINE_COMMIT="${AMADEUS_IMAGE_ENGINE_COMMIT:-52c0fc1044277900b995308095a1f3cc484a3581}"
SERVICE_SOURCE_DIR="$ROOT_DIR/apps/amadeus-image-service"
INSTALL_DIR="$AMADEUS_IMAGE_SERVICE_INSTALL_DIR"
VENV_DIR="$AMADEUS_IMAGE_SERVICE_VENV_DIR"
MODEL_CACHE_DIR="$AMADEUS_IMAGE_SERVICE_MODEL_CACHE_DIR"
TOKEN_FILE="$AMADEUS_IMAGE_SERVICE_TOKEN_FILE"
PLIST_PATH="$HOME/Library/LaunchAgents/$AMADEUS_IMAGE_SERVICE_LAUNCHD_LABEL.plist"
SERVICE_LOG_DIR="$INSTALL_DIR/logs"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--plan|--apply] <install|uninstall|start|stop|restart|status|health|upscale> [args]

Commands:
  install                 Install the pinned host engine and launchd definition.
  uninstall               Stop and remove the launchd definition (keeps assets/models).
  start|stop|restart      Control the launchd service.
  status                  Show launchd and configured runtime paths.
  health                  Query the local health endpoint.
  upscale IMAGE_ID        Upscale a known image id through the host service.

Upscale options:
  --scale 2|4             Default: 4
  --mode auto|realistic|anime  Default: auto
  --resolution 2k|4k        Optional long-edge target profile.
  --json                  Print the raw JSON response.

Mutating commands require --apply. The default is --plan.
USAGE
}

say_plan() {
  printf 'PLAN action=%s label=%s install_dir=%s asset_root=%s port=%s engine_commit=%s\n' \
    "$1" "$AMADEUS_IMAGE_SERVICE_LAUNCHD_LABEL" "$INSTALL_DIR" "$AMADEUS_IMAGE_ASSET_ROOT" "$AMADEUS_IMAGE_SERVICE_PORT" "$ENGINE_COMMIT"
}

launchctl_target() {
  printf 'gui/%s/%s' "$(id -u)" "$AMADEUS_IMAGE_SERVICE_LAUNCHD_LABEL"
}

unload_service() {
  launchctl bootout "$(launchctl_target)" >/dev/null 2>&1 || true
}

load_service() {
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  launchctl enable "$(launchctl_target)" >/dev/null 2>&1 || true
}

ensure_token() {
  if [[ -s "$TOKEN_FILE" ]]; then
    chmod 600 "$TOKEN_FILE"
    return
  fi
  mkdir -p "$(dirname "$TOKEN_FILE")"
  umask 077
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32 >"$TOKEN_FILE"
  else
    /usr/bin/uuidgen | tr -d '-' >"$TOKEN_FILE"
  fi
  chmod 600 "$TOKEN_FILE"
}

install_service() {
  say_plan install
  mkdir -p "$INSTALL_DIR" "$MODEL_CACHE_DIR" "$SERVICE_LOG_DIR" "$AMADEUS_IMAGE_ASSET_ROOT"
  ensure_token
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/python" -m pip install -r "$SERVICE_SOURCE_DIR/requirements.txt"
  local engine_dir="$INSTALL_DIR/realesrgan-mlx"
  if [[ ! -f "$engine_dir/.engine-commit" || "$(<"$engine_dir/.engine-commit")" != "$ENGINE_COMMIT" ]]; then
    local archive_url
    archive_url="${ENGINE_REPOSITORY%.git}/archive/$ENGINE_COMMIT.tar.gz"
    local temporary_archive temporary_dir extracted_dir
    temporary_archive="$(mktemp -t amadeus-realesrgan).tar.gz"
    temporary_dir="$(mktemp -d -t amadeus-realesrgan)"
    curl --fail --silent --show-error --location "$archive_url" --output "$temporary_archive"
    tar -xzf "$temporary_archive" -C "$temporary_dir"
    extracted_dir="$(find "$temporary_dir" -mindepth 1 -maxdepth 1 -type d -print -quit)"
    [[ -n "$extracted_dir" ]] || { printf 'engine archive has no source directory\n' >&2; exit 1; }
    rm -rf "$engine_dir"
    mv "$extracted_dir" "$engine_dir"
    printf '%s\n' "$ENGINE_COMMIT" >"$engine_dir/.engine-commit"
    rm -f "$temporary_archive"
    rm -rf "$temporary_dir"
  fi
  "$VENV_DIR/bin/python" -m pip install -e "$engine_dir"
  install -m 0755 "$SERVICE_SOURCE_DIR/service.py" "$INSTALL_DIR/service.py"
  cat >"$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AMADEUS_IMAGE_SERVICE_LAUNCHD_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$VENV_DIR/bin/python</string>
    <string>$INSTALL_DIR/service.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AMADEUS_IMAGE_ASSET_ROOT</key><string>$AMADEUS_IMAGE_ASSET_ROOT</string>
    <key>AMADEUS_IMAGE_SERVICE_TOKEN_FILE</key><string>$TOKEN_FILE</string>
    <key>AMADEUS_IMAGE_SERVICE_BIND</key><string>$AMADEUS_IMAGE_SERVICE_BIND</string>
    <key>AMADEUS_IMAGE_SERVICE_PORT</key><string>$AMADEUS_IMAGE_SERVICE_PORT</string>
    <key>AMADEUS_IMAGE_MAX_INPUT_BYTES</key><string>$AMADEUS_IMAGE_SERVICE_MAX_INPUT_BYTES</string>
    <key>AMADEUS_IMAGE_MAX_OUTPUT_PIXELS</key><string>$AMADEUS_IMAGE_SERVICE_MAX_OUTPUT_PIXELS</string>
    <key>AMADEUS_IMAGE_MAX_CONCURRENCY</key><string>$AMADEUS_IMAGE_SERVICE_MAX_CONCURRENCY</string>
    <key>AMADEUS_IMAGE_TILE</key><string>$AMADEUS_IMAGE_TILE</string>
    <key>AMADEUS_IMAGE_REGISTRY_PATH</key><string>$AMADEUS_IMAGE_REGISTRY_PATH</string>
    <key>REALESRGAN_MLX_WEIGHTS_DIR</key><string>$MODEL_CACHE_DIR</string>
    <key>HF_HOME</key><string>$MODEL_CACHE_DIR/huggingface</string>
  </dict>
  <key>WorkingDirectory</key><string>$INSTALL_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$SERVICE_LOG_DIR/stdout.log</string>
  <key>StandardErrorPath</key><string>$SERVICE_LOG_DIR/stderr.log</string>
</dict>
</plist>
PLIST
  chmod 600 "$PLIST_PATH"
  unload_service
  load_service
  printf 'APPLIED service=%s plist=%s\n' "$AMADEUS_IMAGE_SERVICE_LAUNCHD_LABEL" "$PLIST_PATH"
}

service_url() {
  printf 'http://127.0.0.1:%s' "$AMADEUS_IMAGE_SERVICE_PORT"
}

auth_header() {
  if [[ ! -s "$TOKEN_FILE" ]]; then
    printf '%s' ''
  else
    printf 'Authorization: Bearer %s' "$(<"$TOKEN_FILE")"
  fi
}

health() {
  local header
  header="$(auth_header)"
  if [[ -n "$header" ]]; then
    curl --fail --silent --show-error -H "$header" "$(service_url)/healthz"
  else
    curl --fail --silent --show-error "$(service_url)/healthz"
  fi
  printf '\n'
}

status() {
  say_plan status
  launchctl print "$(launchctl_target)" 2>/dev/null | sed -n '1,24p' || printf 'STATUS launchd=not-loaded\n'
  printf 'STATUS token_file=%s token_present=%s\n' "$TOKEN_FILE" "$([[ -s "$TOKEN_FILE" ]] && echo yes || echo no)"
}

upscale() {
  local image_id="" scale=4 mode=auto resolution="" raw=false
  while (($#)); do
    case "$1" in
      --scale) scale="${2:?--scale requires 2 or 4}"; shift 2 ;;
      --mode) mode="${2:?--mode requires auto, realistic or anime}"; shift 2 ;;
      --resolution) resolution="${2:?--resolution requires 2k or 4k}"; shift 2 ;;
      --json) raw=true; shift ;;
      -*) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
      *) if [[ -n "$image_id" ]]; then printf 'only one IMAGE_ID is allowed\n' >&2; exit 2; fi; image_id="$1"; shift ;;
    esac
  done
  [[ -n "$image_id" ]] || { printf 'IMAGE_ID is required\n' >&2; exit 2; }
  [[ "$scale" == 2 || "$scale" == 4 ]] || { printf 'scale must be 2 or 4\n' >&2; exit 2; }
  [[ "$mode" == auto || "$mode" == realistic || "$mode" == anime ]] || { printf 'mode is invalid\n' >&2; exit 2; }
  [[ -z "$resolution" || "$resolution" == 2k || "$resolution" == 4k ]] || { printf 'resolution is invalid\n' >&2; exit 2; }
  local header
  header="$(auth_header)"
  local response
  if [[ -n "$header" ]]; then
    response="$(curl --fail --silent --show-error -X POST -H "$header" -H 'Content-Type: application/json' \
      "$(service_url)/v1/upscale" --data "$(printf '{\"imageId\":\"%s\",\"scale\":%s,\"mode\":\"%s\"%s}' "$image_id" "$scale" "$mode" "${resolution:+,\"resolution\":\"$resolution\"}")")"
  else
    response="$(curl --fail --silent --show-error -X POST -H 'Content-Type: application/json' \
      "$(service_url)/v1/upscale" --data "$(printf '{\"imageId\":\"%s\",\"scale\":%s,\"mode\":\"%s\"%s}' "$image_id" "$scale" "$mode" "${resolution:+,\"resolution\":\"$resolution\"}")")"
  fi
  if [[ "$raw" == true ]]; then
    printf '%s\n' "$response"
  else
    printf '%s\n' "$response" | python3 -c 'import json,sys; payload=json.load(sys.stdin); asset=payload.get("asset", {}); print("imageId={imageId} parentImageId={parentImageId} scale={scale} mode={mode} size={width}x{height} storageKey={storageKey}".format(imageId=asset.get("imageId"), parentImageId=asset.get("parentImageId"), scale=asset.get("transform", {}).get("scale"), mode=asset.get("transform", {}).get("profile"), width=asset.get("width"), height=asset.get("height"), storageKey=asset.get("storageKey")))'
  fi
}

apply=false
if [[ "${1:-}" == --apply ]]; then apply=true; shift; elif [[ "${1:-}" == --plan ]]; then shift; fi
command="${1:-}"
shift || true
if [[ -z "$command" ]]; then usage; exit 2; fi

case "$command" in
  install)
    if [[ "$apply" != true ]]; then say_plan install; exit 0; fi
    install_service
    ;;
  uninstall)
    say_plan uninstall
    if [[ "$apply" != true ]]; then exit 0; fi
    unload_service
    rm -f "$PLIST_PATH"
    printf 'APPLIED service=%s removed=launchd-definition\n' "$AMADEUS_IMAGE_SERVICE_LAUNCHD_LABEL"
    ;;
  start)
    say_plan start
    [[ "$apply" == true ]] || exit 0
    load_service
    ;;
  stop)
    say_plan stop
    [[ "$apply" == true ]] || exit 0
    unload_service
    ;;
  restart)
    say_plan restart
    [[ "$apply" == true ]] || exit 0
    unload_service
    load_service
    ;;
  status) status ;;
  health) health ;;
  upscale) upscale "$@" ;;
  *) usage; exit 2 ;;
esac
