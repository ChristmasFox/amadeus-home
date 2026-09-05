#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
API_URL="${LANGBOT_URL:-http://127.0.0.1:5300}"
API_KEY="${LANGBOT_API_KEY:-}"
API_KEY_FILE="${LANGBOT_API_KEY_FILE:-}"
COMPOSE_FILE="${LANGBOT_COMPOSE_FILE:-/var/lib/casaos/apps/langbot/docker-compose.yml}"
BACKUP_DIR="${LANGBOT_DEPLOY_BACKUP_DIR:-$REPO_ROOT/.backups/langbot}"
PATCH_DIR="$REPO_ROOT/integrations/langbot/patches"
BUILD_DIR="$REPO_ROOT/integrations/langbot/build"
WAIT_SECONDS=120
APPLY=0
INCLUDE_PATCHES=0
PATCHES_ONLY=0
ACTIVATE_IMAGE=0
SKIP_RUNTIME_CHECK=0
BASE_IMAGE=""
IMAGE_TAG=""
PATCH_CONTEXT=""
STAMP="$(date +%Y%m%d-%H%M%S)"
COMMIT=""
API_BODY=""
API_STATUS=""

usage() {
  cat <<'EOF'
Usage: scripts/deploy-langbot.sh [options]

Build repository-owned LangBot plugins and optionally install them through the
LangBot local-plugin API. The default mode is dry-run.

Options:
  --plugin NAME           Deploy one plugin (repeatable). Use all for the
                          production set: pubg-stats-v3, organize-emby,
                          macos-nas-control. pubg-stats-v2 is explicit legacy.
  --patches               Prepare/build the LangBot image overlay with tracked
                          build-time patches.
  --patches-only          Skip plugin packaging and only handle patches.
  --apply                 Allow API installation or image build.
  --activate-image        After a patch build, update the CasaOS compose and
                          recreate LangBot. Requires --apply and --patches.
  --machine NAME          OrbStack machine (default: ubuntu).
  --api-url URL           LangBot API origin (default: http://127.0.0.1:5300).
  --base-image IMAGE      Base image for the patch overlay; otherwise read the
                          running langbot container image.
  --image-tag IMAGE       Tag for the generated patch image.
  --api-key-file PATH     Read LANGBOT API key from a file outside Git.
  --wait-seconds N        Poll plugin readiness for N seconds (default: 120).
  --skip-runtime-check    Do not inspect the OrbStack/CasaOS containers.
  --dry-run               Explicitly keep the default preview behavior.
  -h, --help              Show this help.

Apply mode requires a clean Git worktree and LANGBOT_API_KEY (or
--api-key-file) for plugin installation. Patch files are never copied into a
running container; activation always uses a new image and keeps a compose
backup beside the CasaOS definition.
EOF
}

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$1" >&2
}

info() {
  printf '%s\n' "$1"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

manifest_value() {
  local manifest="$1"
  local key="$2"
  awk -v key="$key" '
    /^metadata:[[:space:]]*$/ { in_metadata = 1; next }
    in_metadata && /^spec:[[:space:]]*$/ { exit }
    in_metadata && index($0, "  " key ":") == 1 {
      value = $0
      sub("^  " key ":[[:space:]]*", "", value)
      print value
      exit
    }
  ' "$manifest"
}

add_plugin() {
  local candidate="$1"
  local existing
  for existing in "${TARGET_PLUGINS[@]:-}"; do
    [ "$existing" = "$candidate" ] && return 0
  done
  TARGET_PLUGINS+=("$candidate")
}

expand_plugins() {
  local requested
  TARGET_PLUGINS=()
  for requested in "${REQUESTED_PLUGINS[@]:-}"; do
    case "$requested" in
      all)
        add_plugin pubg-stats-v3
        add_plugin organize-emby
        add_plugin macos-nas-control
        ;;
      pubg-stats-v2|pubg-stats-v3|organize-emby|macos-nas-control)
        add_plugin "$requested"
        ;;
      *)
        die "unknown plugin: $requested"
        ;;
    esac
  done
}

build_plugin() {
  local plugin="$1"
  local source_dir="$REPO_ROOT/integrations/langbot/plugins/$plugin"
  local manifest="$source_dir/manifest.yaml"
  local output="$BUILD_DIR/$plugin.lbpkg"
  local stage

  [ -d "$source_dir" ] || die "plugin source directory is missing: $source_dir"
  [ -f "$manifest" ] || die "plugin manifest is missing: $manifest"

  mkdir -p "$BUILD_DIR"
  case "$plugin" in
    pubg-stats-v2)
      "$REPO_ROOT/scripts/build_pubg_plugin.sh" "$output" >/dev/null
      ;;
    pubg-stats-v3)
      "$REPO_ROOT/scripts/build_pubg_v3_plugin.sh" "$output" >/dev/null
      ;;
    *)
      stage="$(mktemp -d "${TMPDIR:-/tmp}/agent-langbot-plugin.XXXXXX")"
      cp -R "$source_dir/." "$stage/"
      find "$stage" -type d -name __pycache__ -prune -exec rm -rf {} +
      find "$stage" -type f \( -name '*.pyc' -o -name '*.lbpkg' \) -delete
      rm -f "$output"
      (cd "$stage" && zip -qr "$output" . -x '*/__pycache__/*' -x '*.pyc' -x '*.lbpkg')
      rm -rf "$stage"
      ;;
  esac

  unzip -tq "$output" >/dev/null || die "invalid plugin package: $output"
  if unzip -Z1 "$output" | rg -n -i '(^|/)(\.env|\.env\.|.*\.(pem|key|p12|pfx|sqlite|sqlite3|db))$' >/dev/null; then
    die "plugin package contains a forbidden secret or runtime file: $output"
  fi

  local author name version digest
  author="$(manifest_value "$manifest" author)"
  name="$(manifest_value "$manifest" name)"
  version="$(manifest_value "$manifest" version)"
  digest="$(sha256_file "$output")"
  printf 'PACKAGE plugin=%s identity=%s/%s version=%s sha256=%s path=%s\n' \
    "$plugin" "$author" "$name" "$version" "$digest" "$output"
}

show_patch_inventory() {
  local patch
  for patch in "$PATCH_DIR"/*; do
    [ -f "$patch" ] || continue
    printf 'PATCH file=%s sha256=%s\n' "${patch#"$REPO_ROOT"/}" "$(sha256_file "$patch")"
  done
}

runtime_check() {
  local containers name
  if ! command -v orb >/dev/null 2>&1; then
    if [ "$APPLY" -eq 1 ]; then
      die 'OrbStack CLI is required for apply mode; use --skip-runtime-check only when the API is intentionally remote'
    fi
    warn 'OrbStack CLI not found; runtime checks skipped in dry-run'
    return 0
  fi

  if ! orb list 2>/dev/null | awk -v machine="$MACHINE" '$1 == machine && $2 == "running" { found = 1 } END { exit found ? 0 : 1 }'; then
    if [ "$APPLY" -eq 1 ]; then
      die "OrbStack machine is not running: $MACHINE"
    fi
    warn "OrbStack machine is not running: $MACHINE"
    return 0
  fi

  containers="$(orb -m "$MACHINE" -u root docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null || true)"
  for name in langbot langbot_plugin_runtime; do
    if printf '%s\n' "$containers" | awk -F '\t' -v name="$name" '$1 == name { found = 1 } END { exit found ? 0 : 1 }'; then
      info "RUNTIME container=$name status=running"
    elif [ "$APPLY" -eq 1 ]; then
      die "required LangBot container is not running: $name"
    else
      warn "required LangBot container is not running: $name"
    fi
  done
}

load_api_key() {
  if [ -n "$API_KEY_FILE" ]; then
    [ -f "$API_KEY_FILE" ] || die "API key file does not exist: $API_KEY_FILE"
    API_KEY="$(tr -d '\r\n' < "$API_KEY_FILE")"
  fi
  [ -n "$API_KEY" ] || die 'apply plugin mode requires LANGBOT_API_KEY or --api-key-file; keep it outside Git'
}

api_request() {
  local url="$1"
  shift
  local response curl_status

  set +e
  response="$(curl --silent --show-error --connect-timeout 5 --max-time 120 \
    --write-out $'\n%{http_code}' --config - "$@" "$url" <<EOF
header = "X-API-Key: $API_KEY"
EOF
  )"
  curl_status=$?
  set -e

  if [ "$curl_status" -ne 0 ]; then
    return "$curl_status"
  fi
  API_STATUS="${response##*$'\n'}"
  API_BODY="${response%$'\n'*}"
  return 0
}

extract_task_id() {
  printf '%s' "$API_BODY" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
    print((payload.get("data") or {}).get("task_id") or "")
except Exception:
    print("")
'
}

plugin_is_ready() {
  local author="$1"
  local name="$2"
  local version="$3"
  printf '%s' "$API_BODY" | python3 -c '
import json, sys
author, name, version = sys.argv[1:]
try:
    payload = json.load(sys.stdin)
except Exception:
    print("0")
    raise SystemExit

def walk(value):
    if isinstance(value, dict):
        manifest = value.get("manifest") or {}
        metadata = manifest.get("metadata") if isinstance(manifest, dict) else {}
        if isinstance(metadata, dict):
            if str(metadata.get("author") or "") == author and str(metadata.get("name") or "") == name:
                current_version = str(metadata.get("version") or "")
                if not version or current_version == version:
                    return True
        return any(walk(item) for item in value.values())
    if isinstance(value, list):
        return any(walk(item) for item in value)
    return False

print("1" if walk(payload) else "0")
' "$author" "$name" "$version"
}

deploy_package() {
  local package="$1"
  local manifest="$2"
  local author name version task_id elapsed

  author="$(manifest_value "$manifest" author)"
  name="$(manifest_value "$manifest" name)"
  version="$(manifest_value "$manifest" version)"

  if ! api_request "$API_URL/api/v1/plugins/install/local" \
    --form "file=@$package;type=application/octet-stream"; then
    die "LangBot API request failed for $author/$name"
  fi
  case "$API_STATUS" in
    2[0-9][0-9]) ;;
    *) die "LangBot rejected $author/$name (HTTP $API_STATUS)" ;;
  esac

  task_id="$(extract_task_id)"
  printf 'INSTALL_ACCEPTED plugin=%s/%s version=%s task=%s\n' "$author" "$name" "$version" "${task_id:-unknown}"
  [ -n "$task_id" ] || return 0

  elapsed=0
  while [ "$elapsed" -lt "$WAIT_SECONDS" ]; do
    if api_request "$API_URL/api/v1/plugins"; then
      if [ "$API_STATUS" = 200 ] && [ "$(plugin_is_ready "$author" "$name" "$version")" = 1 ]; then
        printf 'INSTALL_READY plugin=%s/%s version=%s elapsed=%ss\n' "$author" "$name" "$version" "$elapsed"
        return 0
      fi
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done

  warn "plugin task did not reach the expected version within ${WAIT_SECONDS}s: $author/$name@$version (task $task_id)"
  return 1
}

prepare_patch_context() {
  local patch
  PATCH_CONTEXT="$REPO_ROOT/.local/langbot-image-$STAMP"
  mkdir -p "$PATCH_CONTEXT/patches"
  for patch in \
    patch_kook_adapter.py \
    patch_telegram_adapter.py \
    patch_message_conversion.py \
    patch_pubg_telegram_picker.py \
    whatsapp.py \
    whatsapp.yaml \
    whatsapp.svg; do
    cp "$PATCH_DIR/$patch" "$PATCH_CONTEXT/patches/$patch"
  done

  cat > "$PATCH_CONTEXT/Dockerfile" <<EOF
FROM $BASE_IMAGE
COPY patches/ /tmp/agent-monorepo-langbot-patches/
COPY patches/whatsapp.py /app/src/langbot/pkg/platform/sources/whatsapp.py
COPY patches/whatsapp.yaml /app/src/langbot/pkg/platform/sources/whatsapp.yaml
COPY patches/whatsapp.svg /app/src/langbot/pkg/platform/sources/whatsapp.svg
RUN python /tmp/agent-monorepo-langbot-patches/patch_kook_adapter.py \
 && python /tmp/agent-monorepo-langbot-patches/patch_telegram_adapter.py \
 && python /tmp/agent-monorepo-langbot-patches/patch_message_conversion.py \
 && python /tmp/agent-monorepo-langbot-patches/patch_pubg_telegram_picker.py \
 && python -m py_compile \
      /app/src/langbot/pkg/platform/sources/kook.py \
      /app/src/langbot/pkg/platform/sources/telegram.py \
      /app/src/langbot/pkg/platform/sources/whatsapp.py \
      /app/src/langbot/pkg/provider/modelmgr/requesters/litellmchat.py \
      /app/src/langbot/pkg/pipeline/process/handlers/chat.py \
      /app/.venv/lib/python3.12/site-packages/langbot_plugin/api/entities/events.py
EOF
}

build_patch_image() {
  if [ -z "$BASE_IMAGE" ]; then
    if command -v orb >/dev/null 2>&1; then
      BASE_IMAGE="$(orb -m "$MACHINE" -u root docker inspect langbot --format '{{.Config.Image}}' 2>/dev/null || true)"
    fi
  fi
  [ -n "$BASE_IMAGE" ] || die 'cannot determine LangBot base image; provide --base-image IMAGE'
  case "$BASE_IMAGE" in
    *[!A-Za-z0-9./:_@-]*) die 'base image contains unsupported characters' ;;
  esac

  if [ -z "$IMAGE_TAG" ]; then
    IMAGE_TAG="local/langbot-agent:${COMMIT:0:12}-${STAMP}"
  fi
  case "$IMAGE_TAG" in
    *[!A-Za-z0-9./:_@-]*) die 'image tag contains unsupported characters' ;;
  esac

  prepare_patch_context
  printf 'PATCH_IMAGE_PLAN base=%s tag=%s context=%s\n' "$BASE_IMAGE" "$IMAGE_TAG" "$PATCH_CONTEXT"
  if [ "$APPLY" -eq 0 ]; then
    info 'DRY_RUN patch image was not built and CasaOS was not changed.'
    return 0
  fi

  command -v orb >/dev/null 2>&1 || die 'OrbStack CLI is required to build the patch image'
  orb -m "$MACHINE" -u root docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || die "base image is unavailable in machine $MACHINE: $BASE_IMAGE"
  orb -m "$MACHINE" -u root docker build --pull=false -t "$IMAGE_TAG" "$PATCH_CONTEXT"
  printf 'PATCH_IMAGE_BUILT image=%s\n' "$IMAGE_TAG"
}

activate_patch_image() {
  [ -n "$IMAGE_TAG" ] || die 'patch image tag is empty'
  orb -m "$MACHINE" -u root bash -s -- "$COMPOSE_FILE" "$IMAGE_TAG" <<'REMOTE'
set -Eeuo pipefail

compose_file="$1"
new_image="$2"
[ -f "$compose_file" ] || { printf 'compose file not found: %s\n' "$compose_file" >&2; exit 1; }

backup_file="${compose_file}.codex-backup.$(date +%Y%m%d-%H%M%S)"
cp -p "$compose_file" "$backup_file"

python3 - "$compose_file" "$new_image" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
image = sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
service = None
changed = 0
output = []
for line in lines:
    service_match = re.match(r"^  ([A-Za-z0-9_.-]+):\s*$", line)
    if service_match:
        service = service_match.group(1)
    if service in {"langbot", "langbot_plugin_runtime"}:
        image_match = re.match(r"^(\s+image:\s*).*$", line)
        if image_match:
            line = image_match.group(1) + image + "\n"
            changed += 1
    output.append(line)

if changed != 2:
    raise SystemExit(f"expected two LangBot image entries, changed {changed}")
path.write_text("".join(output), encoding="utf-8")
PY

compose_dir="$(dirname "$compose_file")"
compose_name="$(basename "$compose_file")"
if ! (cd "$compose_dir" && docker compose -f "$compose_name" config >/dev/null); then
  cp -p "$backup_file" "$compose_file"
  printf 'compose validation failed; restored %s\n' "$backup_file" >&2
  exit 1
fi

if ! (cd "$compose_dir" && docker compose -f "$compose_name" up -d); then
  cp -p "$backup_file" "$compose_file"
  (cd "$compose_dir" && docker compose -f "$compose_name" up -d) || true
  printf 'LangBot activation failed; restored %s\n' "$backup_file" >&2
  exit 1
fi

printf 'PATCH_IMAGE_ACTIVE image=%s backup=%s\n' "$new_image" "$backup_file"
REMOTE
}

REQUESTED_PLUGINS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --plugin)
      [ "$#" -ge 2 ] || die '--plugin requires a value'
      REQUESTED_PLUGINS+=("$2")
      shift 2
      ;;
    --patches) INCLUDE_PATCHES=1; shift ;;
    --patches-only) INCLUDE_PATCHES=1; PATCHES_ONLY=1; shift ;;
    --apply) APPLY=1; shift ;;
    --activate-image) ACTIVATE_IMAGE=1; shift ;;
    --machine)
      [ "$#" -ge 2 ] || die '--machine requires a value'
      MACHINE="$2"
      shift 2
      ;;
    --api-url)
      [ "$#" -ge 2 ] || die '--api-url requires a value'
      API_URL="$2"
      shift 2
      ;;
    --base-image)
      [ "$#" -ge 2 ] || die '--base-image requires a value'
      BASE_IMAGE="$2"
      shift 2
      ;;
    --image-tag)
      [ "$#" -ge 2 ] || die '--image-tag requires a value'
      IMAGE_TAG="$2"
      shift 2
      ;;
    --api-key-file)
      [ "$#" -ge 2 ] || die '--api-key-file requires a value'
      API_KEY_FILE="$2"
      shift 2
      ;;
    --wait-seconds)
      [ "$#" -ge 2 ] || die '--wait-seconds requires a value'
      WAIT_SECONDS="$2"
      shift 2
      ;;
    --skip-runtime-check) SKIP_RUNTIME_CHECK=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

case "$WAIT_SECONDS" in
  ''|*[!0-9]*) die '--wait-seconds must be a non-negative integer' ;;
esac
[ "$ACTIVATE_IMAGE" -eq 0 ] || {
  [ "$APPLY" -eq 1 ] || die '--activate-image requires --apply'
  [ "$INCLUDE_PATCHES" -eq 1 ] || die '--activate-image requires --patches'
}

if [ "$PATCHES_ONLY" -eq 0 ] && [ "${#REQUESTED_PLUGINS[@]}" -eq 0 ]; then
  REQUESTED_PLUGINS=(all)
fi
expand_plugins

cd "$REPO_ROOT"
require_command git
require_command python3
require_command curl
require_command unzip
require_command zip
require_command rg

COMMIT="$(git rev-parse HEAD 2>/dev/null)" || die 'not a Git repository'
git diff --check
"$REPO_ROOT/scripts/check-secrets.sh"

if [ "$APPLY" -eq 1 ] && [ -n "$(git status --porcelain)" ]; then
  die 'apply mode requires a clean Git worktree; commit source changes first'
fi

printf 'DEPLOY_PLAN commit=%s branch=%s mode=%s machine=%s api=%s\n' \
  "$COMMIT" "$(git branch --show-current)" "$([ "$APPLY" -eq 1 ] && printf apply || printf dry-run)" "$MACHINE" "$API_URL"

if [ "$SKIP_RUNTIME_CHECK" -eq 0 ]; then
  runtime_check
fi

show_patch_inventory

if [ "$PATCHES_ONLY" -eq 0 ]; then
  declare -a PACKAGE_PATHS=()
  declare -a PACKAGE_MANIFESTS=()
  for plugin in "${TARGET_PLUGINS[@]}"; do
    package_path="$BUILD_DIR/$plugin.lbpkg"
    manifest_path="$REPO_ROOT/integrations/langbot/plugins/$plugin/manifest.yaml"
    build_plugin "$plugin"
    mkdir -p "$BACKUP_DIR/$STAMP"
    cp "$package_path" "$BACKUP_DIR/$STAMP/"
    chmod 600 "$BACKUP_DIR/$STAMP/$plugin.lbpkg"
    PACKAGE_PATHS+=("$package_path")
    PACKAGE_MANIFESTS+=("$manifest_path")
  done
  printf 'ROLLBACK_DIR=%s\n' "$BACKUP_DIR/$STAMP"
fi

if [ "$INCLUDE_PATCHES" -eq 1 ]; then
  build_patch_image
  if [ "$ACTIVATE_IMAGE" -eq 1 ]; then
    activate_patch_image
  fi
fi

if [ "$APPLY" -eq 1 ] && [ "$PATCHES_ONLY" -eq 0 ]; then
  load_api_key
  for index in "${!PACKAGE_PATHS[@]}"; do
    deploy_package "${PACKAGE_PATHS[$index]}" "${PACKAGE_MANIFESTS[$index]}"
  done
fi

if [ "$APPLY" -eq 0 ]; then
  info 'DRY_RUN complete: no LangBot API installation, image build, or CasaOS change was performed.'
else
  info 'LangBot deployment completed. Run scripts/doctor.sh and real inbound smoke tests before declaring the release healthy.'
fi
