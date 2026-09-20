#!/usr/bin/env bash

# Shared host profile for deploy, doctor, bootstrap and Operation Skuld checks.
# A real profile is local-only; this file contains safe defaults and no secret.
amadeus_host_profile_load() {
  local profile_root="${1:?repository root is required}"
  local profile_file="${AMADEUS_HOST_PROFILE:-$profile_root/infra/host-profile.env}"
  if [[ -f "$profile_file" ]]; then
    # shellcheck disable=SC1090
    source "$profile_file"
  fi

  ORBSTACK_MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
  OPENCLAW_APP_DIR="${OPENCLAW_APP_DIR:-/var/lib/casaos/apps/openclaw}"
  OPENCLAW_DATA_DIR="${OPENCLAW_DATA_DIR:-/DATA/AppData/openclaw}"
  RADAR_APP_DIR="${RADAR_APP_DIR:-/var/lib/casaos/apps/product-radar}"
  RADAR_DATA_DIR="${RADAR_DATA_DIR:-/DATA/AppData/product-radar}"
  AMADEUS_NETWORK_NAME="${AMADEUS_NETWORK_NAME:-amadeus_network}"
  NINE_ROUTER_NETWORK_NAME="${NINE_ROUTER_NETWORK_NAME:-9router_default}"
  MEDIA_ADAPTER_APP_DIR="${MEDIA_ADAPTER_APP_DIR:-/var/lib/casaos/apps/media-organizer-adapter}"
  MEDIA_ADAPTER_CONTAINER="${MEDIA_ADAPTER_CONTAINER:-media-organizer-adapter}"
  MAC_CONTROL_HOST="${MAC_CONTROL_HOST:-host.docker.internal}"
  MAC_CONTROL_USER="${MAC_CONTROL_USER:-$(id -un)}"
  MAC_CONTROL_KEY_HOST_FILE="${MAC_CONTROL_KEY_HOST_FILE:-$OPENCLAW_DATA_DIR/secrets/mac-ssh-key}"
  CODEX_NOTIFY_HOOK_PATH="${CODEX_NOTIFY_HOOK_PATH:-$HOME/.codex/bin/codex-notify.sh}"
  CODEX_NOTIFY_BACKUP_ROOT="${CODEX_NOTIFY_BACKUP_ROOT:-$HOME/.codex/backups}"
  FASHION_SIGLIP_LABEL="${FASHION_SIGLIP_LABEL:-com.productradar.fashion-siglip}"
  FASHION_SIGLIP_PORT="${FASHION_SIGLIP_PORT:-18400}"
  FASHION_SIGLIP_INSTALL_DIR="${FASHION_SIGLIP_INSTALL_DIR:-$HOME/Library/Application Support/ProductRadar/FashionSigLIP}"
  FASHION_SIGLIP_MODEL_CACHE_DIR="${FASHION_SIGLIP_MODEL_CACHE_DIR:-$FASHION_SIGLIP_INSTALL_DIR/models/huggingface}"
  FASHION_SIGLIP_MODEL_CACHE_POLICY="${FASHION_SIGLIP_MODEL_CACHE_POLICY:-redownload}"

  export ORBSTACK_MACHINE OPENCLAW_APP_DIR OPENCLAW_DATA_DIR RADAR_APP_DIR RADAR_DATA_DIR
  export AMADEUS_NETWORK_NAME NINE_ROUTER_NETWORK_NAME MEDIA_ADAPTER_APP_DIR MEDIA_ADAPTER_CONTAINER
  export MAC_CONTROL_HOST MAC_CONTROL_USER MAC_CONTROL_KEY_HOST_FILE
  export CODEX_NOTIFY_HOOK_PATH CODEX_NOTIFY_BACKUP_ROOT
  export FASHION_SIGLIP_LABEL FASHION_SIGLIP_PORT FASHION_SIGLIP_INSTALL_DIR FASHION_SIGLIP_MODEL_CACHE_DIR
  export FASHION_SIGLIP_MODEL_CACHE_POLICY
  export AMADEUS_HOST_PROFILE_FILE="$profile_file"
}
