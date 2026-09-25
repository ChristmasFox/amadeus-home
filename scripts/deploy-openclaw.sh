#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
VERSION_TOOL="$ROOT_DIR/scripts/amadeus-version.sh"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"
MACHINE="$ORBSTACK_MACHINE"
IMAGE=""
RADAR_IMAGE=""
APPLY=0
BUILD=0
BUILD_OPENCLAW=0
BUILD_RADAR=0
AUTO_BUILD=0
NO_BUILD=0
FULL_VERIFY=0
CANDIDATE=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy-openclaw.sh --dry-run
  ./scripts/deploy-openclaw.sh --apply --build
  ./scripts/deploy-openclaw.sh --apply --build-auto
  ./scripts/deploy-openclaw.sh --apply --candidate --build-auto  # pre-release real acceptance; no release notification
  ./scripts/deploy-openclaw.sh --apply --build-openclaw
  ./scripts/deploy-openclaw.sh --apply --build-radar
  ./scripts/deploy-openclaw.sh --apply --no-build
  ./scripts/deploy-openclaw.sh --apply --image <openclaw-image> --radar-image <radar-image>

Default is a dry-run. --build performs a full two-image release. --build-auto
compares the current Git tree with the live image commit and builds only affected
images. --build-openclaw and --build-radar build one image. --no-build reuses
the live images for workspace/compose/config-only updates and rejects stale
images when plugin or service source changed. --candidate replaces the one
runtime for real acceptance before a version bump, preserves checkpoints and
skips release notification/maintenance; it is not a second runtime or release.
USAGE
}

fail() { printf '%s\n' "$*" >&2; exit 2; }
base64_file() { base64 < "$1" | tr -d '\n'; }
DOCKER_BUILD_PROXY_ARGS=()
for proxy_name in HTTP_PROXY HTTPS_PROXY; do
  case "$proxy_name" in
    HTTP_PROXY) proxy_value="${HTTP_PROXY:-}" ;;
    HTTPS_PROXY) proxy_value="${HTTPS_PROXY:-}" ;;
  esac
  if [[ -n "$proxy_value" ]]; then
    # Docker build containers cannot reach a macOS loopback proxy through
    # 127.0.0.1; expose the host endpoint through Docker's stable DNS name.
    proxy_value="$(printf '%s' "$proxy_value" | sed -E 's#(https?://)(127\.0\.0\.1|localhost)(:|/|$)#\1host.docker.internal\3#')"
    DOCKER_BUILD_PROXY_ARGS+=(--build-arg "$proxy_name=$proxy_value")
  fi
done
if [[ -n "${NO_PROXY:-}" ]]; then
  DOCKER_BUILD_PROXY_ARGS+=(--build-arg "NO_PROXY=$NO_PROXY")
fi
resolve_live_image() {
  local container="$1" value
  value="$(orb -m "$MACHINE" -u root docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || true)"
  value="${value%%$'\n'*}"
  [[ -n "$value" ]] || return 1
  printf '%s\n' "$value"
}
image_source_commit() {
  local image="$1"
  if [[ "$image" =~ :git-([0-9a-fA-F]{7,40})-[0-9]{14}$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}
is_openclaw_image_path() {
  case "$1" in
    plugins/pubg/*|plugins/amadeus/*|packages/presentation/*|packages/pubg-domain/*|infra/docker/casaos/openclaw/Dockerfile|scripts/patch-openclaw-channel-identity.mjs|pnpm-lock.yaml|pnpm-workspace.yaml|VERSION) return 0 ;;
    *) return 1 ;;
  esac
}
is_radar_image_path() {
  case "$1" in
    apps/product-radar/*|packages/presentation/*|apps/product-radar/Dockerfile|pnpm-lock.yaml|pnpm-workspace.yaml) return 0 ;;
    *) return 1 ;;
  esac
}
image_needs_rebuild() {
  local image="$1" target="$2" source_commit path
  source_commit="$(image_source_commit "$image")" || fail "$target image tag must contain a git commit and timestamp: $image"
  git -C "$ROOT_DIR" cat-file -e "$source_commit^{commit}" 2>/dev/null || fail "Image source commit is not available locally: $source_commit"
  # Root package.json changes only require an image rebuild when dependency/runtime metadata changed;
  # script-only changes must not rebuild either image. This keeps --build-auto affected-only.
  if git -C "$ROOT_DIR" diff --unified=0 "$source_commit..HEAD" -- package.json | grep -E '^\+[^+].*"(dependencies|devDependencies|peerDependencies|optionalDependencies|engines|packageManager)"' >/dev/null; then
    return 0
  fi
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    if [[ "$target" == openclaw ]] && is_openclaw_image_path "$path"; then
      return 0
    fi
    if [[ "$target" == radar ]] && is_radar_image_path "$path"; then
      return 0
    fi
  done < <(git -C "$ROOT_DIR" diff --name-only "$source_commit..HEAD")
  return 1
}
assert_image_fresh() {
  local image="$1" target="$2"
  if image_needs_rebuild "$image" "$target"; then
    fail "$target image is stale for the current Git tree; use --build-auto, --build-$target, or --build."
  fi
}
version_is_greater() {
  local candidate="$1" previous="$2"
  local candidate_major candidate_minor candidate_patch previous_major previous_minor previous_patch
  IFS=. read -r candidate_major candidate_minor candidate_patch <<< "$candidate"
  IFS=. read -r previous_major previous_minor previous_patch <<< "$previous"
  ((
    candidate_major > previous_major ||
    candidate_major == previous_major && candidate_minor > previous_minor ||
    candidate_major == previous_major && candidate_minor == previous_minor && candidate_patch > previous_patch
  ))
}
assert_release_version_advanced() {
  local live_image live_commit live_version
  live_image="$(resolve_live_image openclaw)" || fail 'Could not resolve the live OpenClaw image to verify release version.'
  live_commit="$(image_source_commit "$live_image")" || fail "Live OpenClaw image tag has no source commit: $live_image"
  git -C "$ROOT_DIR" cat-file -e "$live_commit^{commit}" 2>/dev/null || fail "Live OpenClaw source commit is not available locally: $live_commit"
  live_version="$(git -C "$ROOT_DIR" show "$live_commit:VERSION" 2>/dev/null | tr -d '[:space:]')"
  [[ "$live_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Live OpenClaw source commit has no valid VERSION: $live_commit"
  version_is_greater "$AMADEUS_VERSION" "$live_version" || fail "Refusing apply: VERSION=$AMADEUS_VERSION must advance beyond live Amadeus version $live_version; run scripts/amadeus-version.sh bump patch."
  printf 'LIVE_AMADEUS_VERSION=%s\n' "$live_version"
}

assert_candidate_version_unchanged() {
  local live_image live_commit live_version
  live_image="$(resolve_live_image openclaw)" || fail 'Could not resolve live OpenClaw image for candidate.'
  live_commit="$(image_source_commit "$live_image")" || fail 'Live OpenClaw image has no Git source tag.'
  live_version="$(git -C "$ROOT_DIR" show "$live_commit:VERSION" 2>/dev/null | tr -d '[:space:]')"
  [[ "$AMADEUS_VERSION" == "$live_version" ]] || fail "Candidate apply must keep live VERSION=$live_version; found $AMADEUS_VERSION."
  printf 'LIVE_AMADEUS_VERSION=%s\n' "$live_version"
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --candidate) CANDIDATE=1 ;;
    --build) BUILD=1; BUILD_OPENCLAW=1; BUILD_RADAR=1 ;;
    --build-auto) AUTO_BUILD=1 ;;
    --build-openclaw) BUILD_OPENCLAW=1 ;;
    --build-radar) BUILD_RADAR=1 ;;
    --no-build) NO_BUILD=1 ;;
    --full-verify) FULL_VERIFY=1 ;;
    --image) (($# >= 2)) || fail '--image requires a value.'; IMAGE="$2"; shift ;;
    --radar-image) (($# >= 2)) || fail '--radar-image requires a value.'; RADAR_IMAGE="$2"; shift ;;
    --machine) (($# >= 2)) || fail '--machine requires a value.'; MACHINE="$2"; ORBSTACK_MACHINE="$2"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

if ((AUTO_BUILD && (BUILD || BUILD_OPENCLAW || BUILD_RADAR || NO_BUILD))); then
  fail '--build-auto cannot be combined with an explicit build or no-build option.'
fi
if ((NO_BUILD && (BUILD || BUILD_OPENCLAW || BUILD_RADAR || AUTO_BUILD))); then
  fail '--no-build cannot be combined with a build option.'
fi
((FULL_VERIFY == 0 || APPLY == 1)) || fail '--full-verify requires --apply.'
[[ "$IMAGE" != *$'\n'* && "$IMAGE" != *[[:space:]]* ]] || fail 'OpenClaw image tag contains whitespace.'
[[ "$RADAR_IMAGE" != *$'\n'* && "$RADAR_IMAGE" != *[[:space:]]* ]] || fail 'Product Radar image tag contains whitespace.'
STAMP="$(date -u +%Y%m%d%H%M%S)"
COMMIT="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
AMADEUS_VERSION="$(bash "$VERSION_TOOL" show)"
bash "$VERSION_TOOL" check >/dev/null
RELEASE_NOTES="$(bash "$VERSION_TOOL" notes)"
# The deployment envelope owns the world-line closing. Strip an accidentally
# repeated standalone closing from release notes before appending it once.
RELEASE_NOTES="$(printf '%s\n' "$RELEASE_NOTES" | sed '/^[[:space:]]*El Psy Kongroo\.[[:space:]]*$/d')"
if ((APPLY)); then
  if ((AUTO_BUILD)); then
    [[ -z "$IMAGE" && -z "$RADAR_IMAGE" ]] || fail '--build-auto resolves both images from the live CasaOS containers; omit --image/--radar-image.'
    IMAGE="$(resolve_live_image openclaw)" || fail 'Could not resolve the live OpenClaw image for --build-auto.'
    RADAR_IMAGE="$(resolve_live_image product-radar)" || fail 'Could not resolve the live Product Radar image for --build-auto.'
    if image_needs_rebuild "$IMAGE" openclaw; then
      BUILD_OPENCLAW=1
      IMAGE="local/openclaw-amadeus:git-$COMMIT-$STAMP"
    fi
    if image_needs_rebuild "$RADAR_IMAGE" radar; then
      BUILD_RADAR=1
      RADAR_IMAGE="local/product-radar:git-$COMMIT-$STAMP"
    fi
  else
    if [[ -z "$IMAGE" && "$BUILD_OPENCLAW" -eq 1 ]]; then IMAGE="local/openclaw-amadeus:git-$COMMIT-$STAMP"; fi
    if [[ -z "$RADAR_IMAGE" && "$BUILD_RADAR" -eq 1 ]]; then RADAR_IMAGE="local/product-radar:git-$COMMIT-$STAMP"; fi
    if [[ -z "$IMAGE" ]]; then IMAGE="$(resolve_live_image openclaw)" || fail 'Could not resolve the live OpenClaw image; pass --image or use --build.'; fi
    if [[ -z "$RADAR_IMAGE" ]]; then RADAR_IMAGE="$(resolve_live_image product-radar)" || fail 'Could not resolve the live Product Radar image; pass --radar-image or use --build.'; fi
  fi
fi

if ((NO_BUILD)); then
  ((BUILD_OPENCLAW == 0 && BUILD_RADAR == 0 && AUTO_BUILD == 0)) || fail '--no-build cannot be combined with any build option.'
fi
if ((BUILD_OPENCLAW == 1 && BUILD_RADAR == 1)); then
  BUILD_MODE='all'
elif ((BUILD_OPENCLAW == 1)); then
  BUILD_MODE='openclaw-only'
elif ((BUILD_RADAR == 1)); then
  BUILD_MODE='product-radar-only'
elif ((AUTO_BUILD)); then
  BUILD_MODE='auto/no-build'
else
  BUILD_MODE='no-build'
fi

shown_image="$IMAGE"
shown_radar_image="$RADAR_IMAGE"
[[ -n "$shown_image" ]] || shown_image='resolved from live CasaOS container on apply'
[[ -n "$shown_radar_image" ]] || shown_radar_image='resolved from live CasaOS container on apply'
printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'BUILD_MODE=%s\n' "$BUILD_MODE"
printf 'AMADEUS_VERSION=%s\n' "$AMADEUS_VERSION"
printf 'DEPLOYMENT_PHASE=%s\n' "$([[ $CANDIDATE -eq 1 ]] && printf candidate || printf release)"
printf 'OPENCLAW_IMAGE=%s\n' "$shown_image"
printf 'PRODUCT_RADAR_IMAGE=%s\n' "$shown_radar_image"
printf 'MACHINE=%s\n' "$MACHINE"

if ((APPLY == 0)); then
  printf '%s\n' 'PLAN=on apply, reuse live images by default; --build-auto rebuilds only affected images; --build remains the explicit full two-image migration path.'
  live_openclaw="$(resolve_live_image openclaw 2>/dev/null || true)"
  live_radar="$(resolve_live_image product-radar 2>/dev/null || true)"
  if [[ -n "$live_openclaw" ]]; then
    if image_needs_rebuild "$live_openclaw" openclaw; then printf '%s\n' 'AUTO_SCOPE_OPENCLAW=build'; else printf '%s\n' 'AUTO_SCOPE_OPENCLAW=reuse'; fi
  fi
  if [[ -n "$live_radar" ]]; then
    if image_needs_rebuild "$live_radar" radar; then printf '%s\n' 'AUTO_SCOPE_PRODUCT_RADAR=build'; else printf '%s\n' 'AUTO_SCOPE_PRODUCT_RADAR=reuse'; fi
  fi
  exit 0
fi

[[ -n "$IMAGE" && -n "$RADAR_IMAGE" ]] || fail 'Apply requires resolvable OpenClaw and Product Radar images.'
git -C "$ROOT_DIR" diff --check
git -C "$ROOT_DIR" diff --quiet || fail 'Refusing apply with unstaged changes; commit reviewed source first.'
git -C "$ROOT_DIR" diff --cached --quiet || fail 'Refusing apply with staged-but-uncommitted changes.'
if ((CANDIDATE)); then assert_candidate_version_unchanged; else assert_release_version_advanced; fi

if ((BUILD_OPENCLAW == 0)); then assert_image_fresh "$IMAGE" openclaw; fi
if ((BUILD_RADAR == 0)); then assert_image_fresh "$RADAR_IMAGE" radar; fi

(
  cd "$ROOT_DIR"
  if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm use 24.16.0 >/dev/null
  fi
  if ((FULL_VERIFY || (BUILD_OPENCLAW && BUILD_RADAR))); then
    pnpm build
    pnpm typecheck
    pnpm test
  else
    if ((BUILD_OPENCLAW)); then
      pnpm build:pubg
      pnpm build:amadeus
      pnpm typecheck:pubg
      pnpm typecheck:amadeus
      pnpm test:pubg
      pnpm test:amadeus
    fi
    if ((BUILD_RADAR)); then
      pnpm build:product-radar
      pnpm typecheck:product-radar
      pnpm test:product-radar
    fi
    if ((BUILD_OPENCLAW == 0 && BUILD_RADAR == 0)); then
      bash -n scripts/deploy-openclaw.sh scripts/host-profile.sh scripts/amadeus-version.sh scripts/test-amadeus-version.sh integrations/openclaw/codex-notify.sh scripts/notify-owner.sh scripts/provision-vps-readonly.sh
      sh -n infra/vps/amadeus-vps-readonly-probe.sh
      python3 -m py_compile scripts/openclaw_prepare.py
    fi
  fi
  node --check scripts/patch-openclaw-channel-identity.mjs
  node --check scripts/patch-openclaw-voice-failure.mjs
  node --check scripts/patch-openclaw-whatsapp-media-agent.mjs
  node scripts/test-patch-openclaw-whatsapp-media-agent.mjs
  pnpm check:secrets
)

if ((BUILD_OPENCLAW)); then
  docker buildx build --platform linux/arm64 --load --progress=plain "${DOCKER_BUILD_PROXY_ARGS[@]}" --file "$ROOT_DIR/infra/docker/casaos/openclaw/Dockerfile" --tag "$IMAGE" "$ROOT_DIR"
  docker --context orbstack save "$IMAGE" | orb -m "$MACHINE" -u root docker load
else
  orb -m "$MACHINE" -u root docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "OpenClaw image not found: $IMAGE"
fi
if ((BUILD_RADAR)); then
  docker buildx build --platform linux/arm64 --load --progress=plain "${DOCKER_BUILD_PROXY_ARGS[@]}" --file "$ROOT_DIR/apps/product-radar/Dockerfile" --tag "$RADAR_IMAGE" "$ROOT_DIR"
  docker --context orbstack save "$RADAR_IMAGE" | orb -m "$MACHINE" -u root docker load
else
  orb -m "$MACHINE" -u root docker image inspect "$RADAR_IMAGE" >/dev/null 2>&1 || fail "Product Radar image not found: $RADAR_IMAGE"
fi

CHECKPOINT_ID="amadeus-openclaw-$STAMP"
CHECKPOINT_DIR="$OPENCLAW_DATA_DIR/backups/$CHECKPOINT_ID"
OPENCLAW_COMPOSE_FILE="$OPENCLAW_APP_DIR/docker-compose.yml"
RADAR_COMPOSE_FILE="$RADAR_APP_DIR/docker-compose.yml"
RADAR_ENV_FILE="$RADAR_APP_DIR/.env"
MEDIA_COMPOSE_FILE="$MEDIA_ADAPTER_APP_DIR/docker-compose.yml"
PREPARE="$ROOT_DIR/scripts/openclaw_prepare.py"
PATCH_RUNTIME="$ROOT_DIR/scripts/patch-openclaw-channel-identity.mjs"
VOICE_PATCH_RUNTIME="$ROOT_DIR/scripts/patch-openclaw-voice-failure.mjs"
MEDIA_AGENT_PATCH_RUNTIME="$ROOT_DIR/scripts/patch-openclaw-whatsapp-media-agent.mjs"
for source in \
  "$ROOT_DIR/infra/docker/casaos/openclaw/docker-compose.example.yml" \
  "$ROOT_DIR/infra/docker/casaos/product-radar/docker-compose.example.yml" \
  "$ROOT_DIR/integrations/openclaw/openclaw.json.example" \
  "$ROOT_DIR/packages/pubg-domain/config/default-team.json" \
  "$ROOT_DIR/integrations/openclaw/workspace-seed/AGENTS.seed.md" \
  "$ROOT_DIR/integrations/openclaw/workspace-seed/SOUL.seed.md" \
  "$ROOT_DIR/integrations/openclaw/workspace-seed/USER.seed.md" \
  "$ROOT_DIR/integrations/openclaw/workspace-seed/MEMORY.seed.md" "$PREPARE" "$PATCH_RUNTIME" "$VOICE_PATCH_RUNTIME" "$MEDIA_AGENT_PATCH_RUNTIME"; do
  [[ -f "$source" ]] || fail "Missing deployment source: $source"
done

OPENCLAW_COMPOSE_B64="$(base64_file "$ROOT_DIR/infra/docker/casaos/openclaw/docker-compose.example.yml")"
RADAR_COMPOSE_B64="$(base64_file "$ROOT_DIR/infra/docker/casaos/product-radar/docker-compose.example.yml")"
CONFIG_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/openclaw.json.example")"
TEAM_B64="$(base64_file "$ROOT_DIR/packages/pubg-domain/config/default-team.json")"
AGENTS_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace-seed/AGENTS.seed.md")"
SOUL_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace-seed/SOUL.seed.md")"
USER_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace-seed/USER.seed.md")"
MEMORY_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace-seed/MEMORY.seed.md")"

orb -m "$MACHINE" -u root python3 - \
  "$CHECKPOINT_DIR" \
  "$OPENCLAW_COMPOSE_FILE" openclaw-compose.before.yml \
  "$RADAR_COMPOSE_FILE" product-radar-compose.before.yml \
  "$RADAR_ENV_FILE" product-radar.env.before \
  "$MEDIA_COMPOSE_FILE" media-organizer-compose.before.yml \
  "$OPENCLAW_DATA_DIR/config/openclaw.json" openclaw-config.before.json \
  "$OPENCLAW_DATA_DIR/openclaw.env" openclaw.env.before \
  "$OPENCLAW_DATA_DIR/secrets" openclaw-secrets.before \
  "$OPENCLAW_DATA_DIR/data/pubg.sqlite" pubg.sqlite.before \
  "$OPENCLAW_DATA_DIR/data/identity.sqlite" identity.sqlite.before \
  "$OPENCLAW_DATA_DIR/data/vps-usage-state.json" vps-usage-state.json.before \
  "$OPENCLAW_DATA_DIR/data/longbridge-oauth.json" longbridge-oauth.json.before \
  "$OPENCLAW_DATA_DIR/data/longbridge-sdk-home" longbridge-sdk-home.before \
  "$RADAR_DATA_DIR/product-radar.sqlite" product-radar.sqlite.before \
  "$OPENCLAW_DATA_DIR/notifications" owner-notifications.before \
  "$OPENCLAW_DATA_DIR/workspace" openclaw-workspace.before <<'PY'
import hashlib, json, os, shutil, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
checkpoint = Path(sys.argv[1])
if checkpoint.exists(): raise SystemExit('checkpoint already exists: ' + str(checkpoint))
checkpoint.mkdir(parents=True)
args = sys.argv[2:]
if len(args) % 2: raise SystemExit('checkpoint pairs are unbalanced')
for i in range(0, len(args), 2):
    source, destination = Path(args[i]), checkpoint / args[i + 1]
    if not source.exists(): continue
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir(): shutil.copytree(source, destination, symlinks=True)
    else: shutil.copy2(source, destination)
containers = {}
for name in ['openclaw','product-radar','media-organizer-adapter','changedetection','9router']:
    try: containers[name] = subprocess.check_output(['docker','inspect','--format','{{.State.Status}}',name], text=True).strip()
    except subprocess.CalledProcessError: containers[name] = 'absent'
manifest = []
for i in range(0, len(args), 2):
    source = Path(args[i])
    item = {'source': str(source), 'exists': source.exists()}
    if source.exists():
        item['kind'] = 'directory' if source.is_dir() else 'file'
        item['mode'] = oct(source.stat().st_mode & 0o777)
        item['size'] = sum(path.stat().st_size for path in source.rglob('*') if path.is_file()) if source.is_dir() else source.stat().st_size
        sensitive = source.name in {'openclaw.env', '.env', 'longbridge-oauth.json', 'longbridge-sdk-home'} or 'secrets' in source.parts
        if not sensitive and source.is_file():
            digest = hashlib.sha256()
            with source.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
            item['sha256'] = digest.hexdigest()
        elif sensitive:
            item['sensitiveMetadataOnly'] = True
    manifest.append(item)
(checkpoint / 'backup-manifest.json').write_text(json.dumps({'createdAt': datetime.now(timezone.utc).isoformat(), 'items': manifest}, ensure_ascii=False, indent=2) + '\n')
(checkpoint / 'checkpoint.json').write_text(json.dumps({
    'createdAt': datetime.now(timezone.utc).isoformat(),
    'checkpointId': checkpoint.name,
    'containersBeforeSwitch': containers,
    'note': 'External checkpoint; contains runtime data and protected secret copies needed for recovery. Secret contents are never printed or checksummed.'
}, ensure_ascii=False, indent=2) + '\n')
print('CHECKPOINT=' + str(checkpoint))
PY

orb -m "$MACHINE" -u root python3 - \
  "$OPENCLAW_DATA_DIR" "$CONFIG_B64" "$TEAM_B64" "$AGENTS_B64" "$SOUL_B64" "$USER_B64" "$MEMORY_B64" < "$PREPARE"

orb -m "$MACHINE" -u root python3 - \
  "$OPENCLAW_DATA_DIR/openclaw.env" "$MAC_CONTROL_HOST" "$MAC_CONTROL_USER" \
  "$HOME_LAB_HOST" "$HOME_LAB_BASE_URL" "$HOME_LAB_GLANCES_URL" "$HOME_LAB_UPTIME_URL" "$CONTROL_UI_LAN_ORIGIN" <<'PY'
import os, sys
from pathlib import Path
path = Path(sys.argv[1])
host, user, home_lab_host, home_lab_base_url, home_lab_glances_url, home_lab_uptime_url, control_ui_lan_origin = sys.argv[2:]
lines = path.read_text().splitlines() if path.is_file() else []
def set_env(key, value):
    prefix = key + '='
    for index, line in enumerate(lines):
        if line.strip().startswith(prefix):
            lines[index] = prefix + value
            return
    lines.append(prefix + value)
set_env('MAC_CONTROL_HOST', host)
set_env('MAC_CONTROL_USER', user)
set_env('HOME_LAB_HOST', home_lab_host)
set_env('HOME_LAB_BASE_URL', home_lab_base_url)
set_env('HOME_LAB_GLANCES_URL', home_lab_glances_url)
set_env('HOME_LAB_UPTIME_URL', home_lab_uptime_url)
set_env('CONTROL_UI_LAN_ORIGIN', control_ui_lan_origin)
path.write_text('\n'.join(lines) + '\n')
os.chmod(path, 0o600)
print('MAC_CONTROL_PROFILE=installed')
PY

orb -m "$MACHINE" -u root docker exec -i openclaw node - \
  --whatsapp-root /home/node/.openclaw/npm/projects < "$PATCH_RUNTIME"
orb -m "$MACHINE" -u root docker exec -i openclaw node - \
  /home/node/.openclaw/npm/projects < "$VOICE_PATCH_RUNTIME"
orb -m "$MACHINE" -u root docker exec -i openclaw node - \
  /home/node/.openclaw/npm/projects < "$MEDIA_AGENT_PATCH_RUNTIME"

orb -m "$MACHINE" -u root python3 - \
  "$OPENCLAW_APP_DIR" "$OPENCLAW_COMPOSE_FILE" "$OPENCLAW_COMPOSE_B64" "$IMAGE" <<'PY'
import base64, os, re, sys
from pathlib import Path
app_dir, compose_path, encoded, image = sys.argv[1:]
if not re.fullmatch(r'[A-Za-z0-9._/@:-]+', image): raise SystemExit('invalid OpenClaw image tag')
content = base64.b64decode(encoded).decode()
matches = list(re.finditer(r'(?m)^(\s*)image:\s*.*$', content))
if len(matches) != 1: raise SystemExit('OpenClaw compose must have one image line')
m = matches[0]
content = content[:m.start()] + m.group(1) + 'image: ' + image + content[m.end():]
Path(app_dir).mkdir(parents=True, exist_ok=True)
temporary = Path(compose_path + '.codex-tmp')
temporary.write_text(content); os.chmod(temporary, 0o644); os.replace(temporary, compose_path)
print('OPENCLAW_COMPOSE=installed')
PY

orb -m "$MACHINE" -u root python3 - \
  "$RADAR_APP_DIR" "$RADAR_COMPOSE_FILE" "$RADAR_COMPOSE_B64" "$RADAR_IMAGE" "$RADAR_ENV_FILE" <<'PY'
import base64, os, re, sys
from pathlib import Path
app_dir, compose_path, encoded, image, env_path = sys.argv[1:]
if not re.fullmatch(r'[A-Za-z0-9._/@:-]+', image): raise SystemExit('invalid Product Radar image tag')
content = base64.b64decode(encoded).decode()
lines, replaced = [], False
for line in content.splitlines(keepends=True):
    if line.lstrip().startswith('image:') and 'PRODUCT_RADAR_IMAGE' in line:
        indent = line[:len(line)-len(line.lstrip())]
        lines.append(indent + 'image: ' + image + ('\n' if line.endswith('\n') else ''))
        replaced = True
    else: lines.append(line)
if not replaced: raise SystemExit('Product Radar image line missing')
Path(app_dir).mkdir(parents=True, exist_ok=True)
temporary = Path(compose_path + '.codex-tmp')
temporary.write_text(''.join(lines)); os.chmod(temporary, 0o644); os.replace(temporary, compose_path)
allowed = {'PRODUCT_RADAR_API_KEY','CHANGEDETECTION_API_KEY','PRODUCT_RADAR_IMAGE_MATCHER_PROVIDER','FASHION_SIGLIP_BASE_URL','FASHION_SIGLIP_TIMEOUT_MS','PRODUCT_RADAR_MAX_BODY_BYTES','PRODUCT_RADAR_PUBLIC_PORT','PRODUCT_RADAR_PORT'}
env = Path(env_path)
old = env.read_text().splitlines() if env.is_file() else []
filtered, found = [], False
for line in old:
    stripped = line.strip()
    if not stripped or stripped.startswith('#'): filtered.append(line); continue
    key = stripped.split('=', 1)[0].strip()
    if key == 'PRODUCT_RADAR_IMAGE':
        filtered.append('PRODUCT_RADAR_IMAGE=' + image); found = True
    elif key in allowed: filtered.append(line)
if not found: filtered.append('PRODUCT_RADAR_IMAGE=' + image)
env.write_text('\n'.join(filtered) + '\n'); os.chmod(env, 0o600)
print('PRODUCT_RADAR_COMPOSE=installed')
print('PRODUCT_RADAR_ENV=legacy_notification_keys_removed')
PY

orb -m "$MACHINE" -u root docker network inspect "$AMADEUS_NETWORK_NAME" >/dev/null 2>&1 || orb -m "$MACHINE" -u root docker network create "$AMADEUS_NETWORK_NAME" >/dev/null
orb -m "$MACHINE" -u root docker network inspect "$NINE_ROUTER_NETWORK_NAME" >/dev/null 2>&1 || fail "$NINE_ROUTER_NETWORK_NAME network is unavailable."
MEDIA_ADAPTER_PRESENT=0
if orb -m "$MACHINE" -u root docker inspect "$MEDIA_ADAPTER_CONTAINER" >/dev/null 2>&1; then
  MEDIA_ADAPTER_PRESENT=1
  if ! orb -m "$MACHINE" -u root docker inspect --format '{{json .NetworkSettings.Networks}}' "$MEDIA_ADAPTER_CONTAINER" 2>/dev/null | grep -q "$AMADEUS_NETWORK_NAME"; then
    orb -m "$MACHINE" -u root docker network connect --alias media-organizer-adapter "$AMADEUS_NETWORK_NAME" "$MEDIA_ADAPTER_CONTAINER"
  fi
else
  printf '%s\n' 'MEDIA_ADAPTER=absent (external service was not restored; media tool acceptance remains pending)' >&2
fi
orb -m "$MACHINE" -u root docker compose --project-directory "$RADAR_APP_DIR" -f "$RADAR_COMPOSE_FILE" config >/dev/null
orb -m "$MACHINE" -u root bash -lc "cd '$OPENCLAW_APP_DIR' && docker compose config >/dev/null && docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js config validate --json > '$CHECKPOINT_DIR/config-validate.json' && docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js plugins inspect pubg --runtime --json > '$CHECKPOINT_DIR/plugin-pubg-preflight.json' && docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js plugins inspect amadeus --runtime --json > '$CHECKPOINT_DIR/plugin-amadeus-preflight.json' && docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js skills list --json > '$CHECKPOINT_DIR/skills-preflight.json'"

orb -m "$MACHINE" -u root python3 - \
  "$CHECKPOINT_DIR/plugin-pubg-preflight.json" "$CHECKPOINT_DIR/plugin-amadeus-preflight.json" "$CHECKPOINT_DIR/skills-preflight.json" <<'PY'
import json, sys
from pathlib import Path
pubg = json.dumps(json.loads(Path(sys.argv[1]).read_text()), ensure_ascii=False)
amadeus = json.dumps(json.loads(Path(sys.argv[2]).read_text()), ensure_ascii=False)
skills = json.dumps(json.loads(Path(sys.argv[3]).read_text()), ensure_ascii=False)
for name in ['pubg_resolve_players','pubg_search_matches','pubg_query_stats','pubg_compare_stats','pubg_get_match','pubg_get_review_facts','pubg_query_team_damage','pubg_prefetch_telemetry','pubg_telemetry_sync_report']:
    if name not in pubg: raise SystemExit('PUBG preflight missing ' + name)
for name in ['amadeus_product_radar','amadeus_media_organize','amadeus_nas','amadeus_homelab_status','amadeus_kook_group_members','amadeus_market_overview','amadeus_market_quote','amadeus_market_intraday','amadeus_market_session','amadeus_market_movers','amadeus_market_constituents','amadeus_macos_host_status','amadeus_macos_host_processes','identity_resolve','identity_get_person','identity_bind_channel','identity_add_alias','identity_link_account','identity_list_candidates','identity_confirm_candidate','amadeus_notify_owner','amadeus_vps_service_info','amadeus_vps_live_status','amadeus_vps_usage','amadeus_vps_system_status','amadeus_vps_services']:
    if name not in amadeus: raise SystemExit('Amadeus preflight missing ' + name)
for name in ['pubg','amadeus','market','macos-host','vps']:
    if '"name": "' + name + '"' not in skills: raise SystemExit('bundled Skill missing ' + name)
print('OPENCLAW_PREFLIGHT=passed')
PY

orb -m "$MACHINE" -u root python3 - "$OPENCLAW_DATA_DIR/config/openclaw.json" <<'PY'
import json, sys
from pathlib import Path
config = json.loads(Path(sys.argv[1]).read_text())
session = config.get('session', {})
if session.get('dmScope') != 'per-account-channel-peer':
    raise SystemExit('direct-message sessions must use dmScope=per-account-channel-peer')
if session.get('groupScope') != 'per-group':
    raise SystemExit('group sessions must use groupScope=per-group')
if config.get('tools', {}).get('sessions', {}).get('visibility') != 'self':
    raise SystemExit('session history visibility must be self to prevent cross-conversation memory leaks')
if config.get('tools', {}).get('profile') != 'full':
    raise SystemExit('owner tool policy is not tools.profile=full')
if 'allow' in config.get('tools', {}):
    raise SystemExit('strict tools.allow list would hide future native tools')
if 'amadeus' not in config.get('plugins', {}).get('allow', []):
    raise SystemExit('Amadeus plugin is not in the OpenClaw plugin allowlist')
sender_policies = config.get('tools', {}).get('toolsBySender', {})
if sender_policies.get('*', {}).get('allow') != ['web_search', 'web_fetch']:
    raise SystemExit('non-owner sender tool policy is not read-only web access')
owner_targets = config.get('commands', {}).get('ownerAllowFrom', [])
if len(owner_targets) != 1 or not str(owner_targets[0]).startswith('whatsapp:+'):
    raise SystemExit('exactly one WhatsApp owner identity is required')
owner_phone = str(owner_targets[0]).split(':', 1)[1]
if sender_policies.get('e164:' + owner_phone, {}).get('allow') != ['*']:
    raise SystemExit('WhatsApp owner sender policy does not retain the full tool profile')
whatsapp = config.get('channels', {}).get('whatsapp', {})
if whatsapp.get('dmPolicy') != 'open' or whatsapp.get('allowFrom') != ['*']:
    raise SystemExit('WhatsApp DM policy is not open for all senders')
for account in whatsapp.get('accounts', {}).values():
    if isinstance(account, dict) and (account.get('dmPolicy') != 'open' or account.get('allowFrom') != ['*']):
        raise SystemExit('WhatsApp account DM policy is not open for all senders')
wildcard_group = whatsapp.get('groups', {}).get('*', {})
if 'tools' in wildcard_group or 'toolsBySender' in wildcard_group:
    raise SystemExit('WhatsApp group tool policy must inherit the full agent profile')
print('OWNER_TOOL_POLICY=full')
print('DM_SESSION_SCOPE=per-account-channel-peer')
PY

orb -m "$MACHINE" -u root docker compose --project-directory "$RADAR_APP_DIR" -f "$RADAR_COMPOSE_FILE" up -d --no-build product-radar >/dev/null
orb -m "$MACHINE" -u root bash -lc "cd '$OPENCLAW_APP_DIR' && docker compose up -d --no-build >/dev/null && docker compose restart openclaw >/dev/null"
# The pinned WhatsApp module is volume-installed. A same-image compose up can
# leave the Node process running with the old media agent; restart loads it.

for attempt in $(seq 1 40); do
  if orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 3 http://127.0.0.1:18789/healthz >/dev/null 2>&1; then break; fi
  sleep 2
done
orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18789/healthz >/dev/null
orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 5 http://127.0.0.1:5315/health >/dev/null
if ((MEDIA_ADAPTER_PRESENT)); then
  orb -m "$MACHINE" -u root docker exec openclaw sh -lc 'node -e "fetch(\"http://media-organizer-adapter:8765/healthz\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"' >/dev/null
else
  printf '%s\n' 'MEDIA_ADAPTER_NETWORK=skipped_missing_service'
fi
orb -m "$MACHINE" -u root docker exec openclaw sh -lc "ssh -i /run/secrets/mac_ssh_key -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null '$MAC_CONTROL_USER@$MAC_CONTROL_HOST' nas.status" >/dev/null
orb -m "$MACHINE" -u root bash -lc "docker exec openclaw node dist/index.js channels status --json > '$CHECKPOINT_DIR/channels-status.json'"

ensure_cron() {
  local name="$1" expression="$2" message="$3" tools="$4" timezone="${5:-Asia/Shanghai}"
  local existing_id
  existing_id="$(orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron list --json \
    | python3 -c 'import json,sys; n=sys.argv[1]; v=json.load(sys.stdin); print(next((x.get("id", "") for x in v.get("jobs",[]) if x.get("name")==n), ""))' "$name")"
  if [[ -z "$existing_id" ]]; then
    orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron add \
      --name "$name" --cron "$expression" --tz "$timezone" --session isolated --agent main \
      --message "$message" --no-deliver --tools "$tools" --exact \
      --declaration-key "amadeus-$name-v1" --json >/dev/null
  else
    orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron edit "$existing_id" \
      --cron "$expression" --tz "$timezone" --session isolated --agent main \
      --message "$message" --no-deliver --tools "$tools" --exact --json >/dev/null
  fi
}
remove_cron() {
  local name="$1" existing_id
  existing_id="$(orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron list --all --json \
    | python3 -c 'import json,sys; n=sys.argv[1]; v=json.load(sys.stdin); print(next((x.get("id", "") for x in v.get("jobs",[]) if x.get("name")==n), ""))' "$name")"
  if [[ -n "$existing_id" ]]; then
    orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron rm "$existing_id" --json >/dev/null
  fi
}
remove_cron amadeus-briefing-morning
remove_cron amadeus-briefing-evening
ensure_cron amadeus-vps-morning '30 9 * * *' '调用 amadeus_vps_live_status、amadeus_vps_usage、amadeus_vps_system_status、amadeus_vps_services；根据返回事实生成简洁中文 VPS 晨间报告，流量段单独输出十格 █/░ 与 usedPercent，unknown 必须保留为未知。随后调用 amadeus_notify_owner，传入 type=worldline_notification_intent、eventType=vps_report_morning、kind=scheduled_report、severity 按事实取 success/warning/error、significance 按影响取 notable/major/critical、eventKey 使用当天正式 vps-report:当天日期:morning、source=vps-report、headline、facts、summary、occurredAt；手动或补跑使用 vps-report:manual:<当前 ISO 时间>:morning，不得占用正式 key。' 'amadeus_vps_live_status amadeus_vps_usage amadeus_vps_system_status amadeus_vps_services amadeus_notify_owner'
ensure_cron amadeus-vps-evening '0 23 * * *' '调用 amadeus_vps_live_status、amadeus_vps_usage、amadeus_vps_system_status、amadeus_vps_services；根据返回事实生成简洁中文 VPS 晚间报告，流量段单独输出十格 █/░ 与 usedPercent，unknown 必须保留为未知。随后调用 amadeus_notify_owner，传入 type=worldline_notification_intent、eventType=vps_report_evening、kind=scheduled_report、severity 按事实取 success/warning/error、significance 按影响取 notable/major/critical、eventKey 使用当天正式 vps-report:当天日期:evening、source=vps-report、headline、facts、summary、occurredAt；手动或补跑使用 vps-report:manual:<当前 ISO 时间>:evening，不得占用正式 key。' 'amadeus_vps_live_status amadeus_vps_usage amadeus_vps_system_status amadeus_vps_services amadeus_notify_owner'
ensure_cron amadeus-pubg-telemetry-hourly '5 * * * *' '只调用 pubg_prefetch_telemetry，参数 team=true、maxMatches=500、maxFetches=20、concurrency=2。该任务每小时刷新所有配置 PUBG 玩家最新对局，只获取本地不存在的新 Match API 详情，再为新对局或到期重试对局获取 Telemetry 并写入持久化缓存；严格保留工具返回的 status、cacheStatus、availability、dataUpdatedAt 和计数，不要把 status=FETCHED/cacheStatus=MISS/availability=AVAILABLE 说成数据缺失；不要调用其他工具、不要发送通知，定时任务使用 no-deliver。' 'pubg_prefetch_telemetry'
ensure_cron amadeus-pubg-sync-daily '0 0 * * *' '调用 pubg_telemetry_sync_report，参数 team=true。报告统计上一自然日；仅当 status/data 有效时把 data.notification 这个完整的 owner_notification 结构化对象原样传给 amadeus_notify_owner，保留 theme、significance、eventType、eventKey、source、headline、facts、summary、dataUpdatedAt、occurredAt 和 worldLineClosing，不得改写事实。' 'pubg_telemetry_sync_report amadeus_notify_owner'
ensure_cron amadeus-market-open '30 9 * * 1-5' '调用 amadeus_market_overview（phase=open）与 amadeus_market_session；由 Longbridge trading day/session 事实判断是否为有效开盘检查，不能把固定时钟当作市场真相。有效时把 overview.notification 的完整结构化对象原样传给 amadeus_notify_owner；非交易日、休市、OAuth reauth 或 provider unavailable 时直接结束，不得改写行情或数据时间。' 'amadeus_market_overview amadeus_market_session amadeus_notify_owner' 'America/New_York'
ensure_cron amadeus-market-close '0 16 * * 1-5' '调用 amadeus_market_overview（phase=close）与 amadeus_market_session；由 Longbridge trading day/session 事实判断是否为有效收盘检查，不能把固定时钟当作市场真相。有效时把 overview.notification 的完整结构化对象原样传给 amadeus_notify_owner；非交易日、休市、OAuth reauth 或 provider unavailable 时直接结束，不得改写行情或数据时间。' 'amadeus_market_overview amadeus_market_session amadeus_notify_owner' 'America/New_York'
orb -m "$MACHINE" -u root bash -lc "docker exec openclaw node dist/index.js cron list --json > '$CHECKPOINT_DIR/cron-list.json'"

HOOK_PATH="$CODEX_NOTIFY_HOOK_PATH"
HOOK_BACKUP_DIR="$CODEX_NOTIFY_BACKUP_ROOT/$CHECKPOINT_ID"
mkdir -p "$HOOK_BACKUP_DIR"
mkdir -p "$(dirname -- "$HOOK_PATH")"
if [[ -f "$HOOK_PATH" ]]; then cp -p "$HOOK_PATH" "$HOOK_BACKUP_DIR/codex-notify.before.sh"; fi
install -m 755 "$ROOT_DIR/integrations/openclaw/codex-notify.sh" "$HOOK_PATH"

if ((CANDIDATE)); then
  owner_notification_status='skipped-candidate'
else
ACCEPTANCE_KEY="amadeus-release:$AMADEUS_VERSION"
DEPLOYMENT_SUMMARY="${RELEASE_NOTES}
已部署到当前 CasaOS 主机 ${MACHINE}。"
for owner_outbox in "$CHECKPOINT_DIR/owner-smoke" "$OPENCLAW_DATA_DIR/notifications"; do
  "$ROOT_DIR/scripts/notify-owner.sh" \
    --remote-machine "$MACHINE" \
    --outbox-dir "$owner_outbox" \
    --event-key "$ACCEPTANCE_KEY" \
    --source amadeus-release \
    --headline "Amadeus $AMADEUS_VERSION · 世界线收束" \
    --summary "$DEPLOYMENT_SUMMARY" \
    --severity success \
    --significance major \
    --theme worldline_convergence \
    --fact-label 版本 \
    --fact-value "$AMADEUS_VERSION" \
    --worldline-closing
done

owner_smoke_id="$(printf '%s' "$ACCEPTANCE_KEY" | shasum -a 256 | cut -c1-40)"
orb -m "$MACHINE" -u root test -f "$CHECKPOINT_DIR/owner-smoke/$owner_smoke_id.pending.json" || fail 'Owner outbox contract smoke did not queue.'
if ! orb -m "$MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/notifications/$owner_smoke_id.pending.json" \
  && ! orb -m "$MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/notifications/$owner_smoke_id.sent.json"; then
  fail 'Owner release notification did not enter the production outbox.'
fi
owner_notification_status='pending'
for attempt in $(seq 1 30); do
  if orb -m "$MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/notifications/$owner_smoke_id.sent.json"; then
    owner_notification_status='sent'
    break
  fi
  sleep 1
done
[[ "$owner_notification_status" == sent ]] || fail 'Owner release notification remained pending after 30 seconds.'

fi

POST_DEPLOY_EVIDENCE_DIR="$SKULD_BACKUP_ROOT/deploy/$CHECKPOINT_ID"
[[ "$POST_DEPLOY_EVIDENCE_DIR" == "$EXTERNAL_STORAGE_ROOT/"* ]] || fail 'post-deploy evidence must be stored on the verified external volume.'
mkdir -p "$POST_DEPLOY_EVIDENCE_DIR"
chmod 700 "$POST_DEPLOY_EVIDENCE_DIR"
if ((CANDIDATE)); then
  post_deploy_maintenance='skipped-candidate'
  log_policy_status='skipped-candidate'
else
post_deploy_maintenance='passed'
log_policy_status='passed'
if ! bash "$ROOT_DIR/scripts/apply-docker-log-policy.sh" --apply >"$POST_DEPLOY_EVIDENCE_DIR/log-policy.log" 2>&1; then
  log_policy_status='warning'
  "$ROOT_DIR/scripts/notify-owner.sh" \
    --remote-machine "$MACHINE" \
    --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
    --event-key "log-policy:post-deploy:$AMADEUS_VERSION" \
    --source storage-runtime \
    --headline '世界线偏移 · 受管日志策略未完全收束' \
    --summary "健康 release 保持运行；日志策略应用失败，证据保留在 $POST_DEPLOY_EVIDENCE_DIR/log-policy.log。未知服务仍为 report-only。" \
    --severity warning \
    --significance major \
    --theme worldline_divergence || true
fi
if ! bash "$ROOT_DIR/scripts/storage-maintenance.sh" --post-deploy --apply >"$POST_DEPLOY_EVIDENCE_DIR/storage-maintenance.log" 2>&1; then
  post_deploy_maintenance='warning'
  "$ROOT_DIR/scripts/notify-owner.sh" \
    --remote-machine "$MACHINE" \
    --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
    --event-key "storage-maintenance:post-deploy:$AMADEUS_VERSION" \
    --source storage-maintenance \
    --headline '世界线偏移 · 发布后存储维护未完全收束' \
    --summary "健康 release 保持运行；受保护对象未通用清理，维护证据保留在 $POST_DEPLOY_EVIDENCE_DIR/storage-maintenance.log。" \
    --severity warning \
    --significance major \
    --theme worldline_divergence || true
fi

fi

printf 'CHECKPOINT=%s\n' "$CHECKPOINT_DIR"
printf 'POST_DEPLOY_EVIDENCE=%s\n' "$POST_DEPLOY_EVIDENCE_DIR"
printf 'OPENCLAW_IMAGE=%s\n' "$IMAGE"
printf 'PRODUCT_RADAR_IMAGE=%s\n' "$RADAR_IMAGE"
printf '%s\n' 'OPENCLAW_HEALTH=passed'
printf '%s\n' 'PRODUCT_RADAR_HEALTH=passed'
if ((MEDIA_ADAPTER_PRESENT)); then printf '%s\n' 'MEDIA_ADAPTER_NETWORK=passed'; fi
printf '%s\n' 'NAS_SSH_READONLY_SMOKE=passed'
printf '%s\n' "OWNER_NOTIFICATION=$owner_notification_status"
printf 'OWNER_OUTBOX_SMOKE=%s\n' "$([[ $CANDIDATE -eq 1 ]] && printf skipped-candidate || printf passed)"
printf '%s\n' "LOG_POLICY=$log_policy_status"
printf '%s\n' "POST_DEPLOY_MAINTENANCE=$post_deploy_maintenance"
printf '%s\n' "AMADEUS_NETWORK=$AMADEUS_NETWORK_NAME"
if ((CANDIDATE)); then
  printf '%s\n' 'Single OpenClaw candidate runtime ready for real acceptance; not a release.'
else
  printf '%s\n' "Amadeus $AMADEUS_VERSION migration completed."
fi
