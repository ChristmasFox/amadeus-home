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
OPENCLAW_ONLY=0
AUTO_RELEASE=0
BUILD_ONLY=0
QWEN_IMAGE_BASE_URL="${AMADEUS_QWEN_IMAGE_BASE_URL:-http://host.docker.internal:18793/v1}"
QWEN_IMAGE_LOCAL_ONLY="${AMADEUS_QWEN_IMAGE_LOCAL_ONLY:-0}"
QWEN_IMAGE_FALLBACK_ENABLED="${AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED:-0}"
QWEN_IMAGE_TOKEN_HOST_FILE="${OPENCLAW_QWEN_IMAGE_TOKEN_HOST_FILE:-$HOME/Library/Application Support/Amadeus/secrets/qwen-image-token}"
QWEN_IMAGE_TOKEN_GUEST_FILE="${OPENCLAW_QWEN_IMAGE_TOKEN_GUEST_FILE:-/DATA/AppData/openclaw/secrets/qwen-image-token}"
VPS_ACCOUNT_MAP_HOST_FILE="${OPENCLAW_VPS_ACCOUNT_MAP_HOST_FILE:-$HOME/Library/Application Support/Amadeus/secrets/vps-account-map.json}"
VPS_ACCOUNT_MAP_GUEST_FILE="${OPENCLAW_VPS_ACCOUNT_MAP_GUEST_FILE:-/DATA/AppData/openclaw/secrets/vps-account-map.json}"
LINEAGE_BRIDGE=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy-openclaw.sh --dry-run --build-auto
  ./scripts/deploy-openclaw.sh --build-only --openclaw-only --build-openclaw
  ./scripts/deploy-openclaw.sh --apply --candidate --openclaw-only --build-openclaw  # main candidate
#  ./scripts/deploy-openclaw.sh --apply --auto-release --build-openclaw              # formal release

Read-only planning defaults to dry-run. The M204 main-merge automation owns
Lab image builds and all runtime writes. --build-only performs an isolated
local image build without switching the runtime.
--candidate is the automatic main-merge Lab deploy: same OpenClaw build/switch
and health checks, keeps VERSION unchanged, and does not create lab/v* tags.
--auto-release is the formal Lab release after Arthur approval: VERSION bump
commit, live verify, then lab/vX.Y.Z + GitHub Release. Both roll back the prior
Compose image automatically if post-switch health or smoke checks fail.
USAGE
}

fail() { printf '%s\n' "$*" >&2; exit 2; }
base64_file() { base64 < "$1" | tr -d '\n'; }
validate_vps_account_map_source() {
  [[ -f "$VPS_ACCOUNT_MAP_HOST_FILE" && ! -L "$VPS_ACCOUNT_MAP_HOST_FILE" ]] \
    || fail "VPS account map must be a regular file: $VPS_ACCOUNT_MAP_HOST_FILE"
  [[ "$(stat -f %Lp "$VPS_ACCOUNT_MAP_HOST_FILE")" == 600 ]] \
    || fail "VPS account map must be mode 0600: $VPS_ACCOUNT_MAP_HOST_FILE"
  python3 "$ROOT_DIR/scripts/validate-vps-account-map.py" "$VPS_ACCOUNT_MAP_HOST_FILE" --private >/dev/null \
    || fail 'VPS account map failed the ID-only schema validation.'
  [[ "$VPS_ACCOUNT_MAP_GUEST_FILE" == /DATA/AppData/openclaw/secrets/* ]] \
    || fail 'VPS account map guest path must stay under the protected OpenClaw secrets directory.'
}
run_vps_account_map_node_preflight() {
  (
    set -Eeuo pipefail
    local preflight_dir="/tmp/amadeus-vps-account-map-${STAMP}-$$"
    local preflight_path="$preflight_dir/vps-account-map.json"
    cleanup_vps_account_map_preflight() {
      orb -m "$MACHINE" -u root bash -lc 'rm -rf -- "$1"' bash "$preflight_dir" >/dev/null 2>&1 || true
    }
    trap cleanup_vps_account_map_preflight EXIT
    orb -m "$MACHINE" -u root bash -lc '
      set -Eeuo pipefail
      dir="$1"
      test ! -e "$dir"
      mkdir -- "$dir"
      chown root:1000 "$dir"
      chmod 0710 "$dir"
      cat > "$dir/vps-account-map.json"
      chown 1000:1000 "$dir/vps-account-map.json"
      chmod 0600 "$dir/vps-account-map.json"
    ' bash "$preflight_dir" < "$VPS_ACCOUNT_MAP_HOST_FILE"
    orb -m "$MACHINE" -u root docker run --rm --user 1000:1000 \
      --mount "type=bind,src=$preflight_path,dst=/run/secrets/vps_account_map.json,readonly" \
      --entrypoint node "$IMAGE" -e "require('fs').readFileSync('/run/secrets/vps_account_map.json','utf8');" >/dev/null \
      || fail 'OpenClaw container uid node cannot read the VPS account map.'
    printf 'OPENCLAW_VPS_ACCOUNT_MAP_PREFLIGHT=passed\n'
  )
}
DOCKER_BUILD_PROXY_ARGS=()
for proxy_name in HTTP_PROXY HTTPS_PROXY; do
  case "$proxy_name" in
    HTTP_PROXY) proxy_value="${HTTP_PROXY:-${http_proxy:-}}" ;;
    HTTPS_PROXY) proxy_value="${HTTPS_PROXY:-${https_proxy:-}}" ;;
  esac
  if [[ -n "$proxy_value" ]]; then
    # Docker build containers cannot reach a macOS loopback proxy through
    # 127.0.0.1; expose the host endpoint through Docker's stable DNS name.
    proxy_value="$(printf '%s' "$proxy_value" | sed -E 's#(https?://)(127\.0\.0\.1|localhost)(:|/|$)#\1host.docker.internal\3#')"
    DOCKER_BUILD_PROXY_ARGS+=(--build-arg "$proxy_name=$proxy_value")
  fi
done
if [[ -n "${NO_PROXY:-${no_proxy:-}}" ]]; then
  DOCKER_BUILD_PROXY_ARGS+=(--build-arg "NO_PROXY=${NO_PROXY:-${no_proxy:-}}")
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
  if [[ "$image" =~ :git-([0-9a-fA-F]{7,40})-([0-9]{12}|[0-9]{14})$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}
image_needs_rebuild() {
  local image="$1" target="$2" source_commit image_target result state
  source_commit="$(image_source_commit "$image")" || fail "$target image tag must contain a git commit and timestamp: $image"
  if ! git -C "$ROOT_DIR" cat-file -e "$source_commit^{commit}" 2>/dev/null; then
    printf 'IMAGE_LINEAGE_MISSING target=%s commit=%s rebuild=required\n' "$target" "$source_commit" >&2
    return 0
  fi
  case "$target" in
    openclaw) image_target=openclaw ;;
    radar|product-radar) image_target=radar ;;
    *) fail "No image-impact target mapping for $target." ;;
  esac
  result="$(python3 "$ROOT_DIR/scripts/image-impact.py" --repo "$ROOT_DIR" --base "$source_commit" --target "$image_target")" \
    || fail "Could not analyze $target build inputs; refusing to reuse the image."
  state="$(sed -n 's/^IMAGE_IMPACT=//p' <<<"$result" | head -n 1)"
  case "$state" in
    REUSE) return 1 ;;
    REBUILD|UNKNOWN)
      printf 'IMAGE_IMPACT target=%s state=%s\n' "$target" "$state" >&2
      while IFS= read -r reason; do [[ "$reason" == REASON=* ]] && printf 'IMAGE_IMPACT_DETAIL %s\n' "${reason#REASON=}" >&2; done <<<"$result"
      return 0
      ;;
    *) fail "Image impact analyzer returned no recognized state for $target." ;;
  esac
}
assert_image_fresh() {
  local image="$1" target="$2"
  if image_needs_rebuild "$image" "$target"; then
    fail "$target image is stale for the current Git tree; use --build-auto, --build-$target, or --build."
  fi
}
assert_openclaw_candidate_image() {
  local image="$1" tagged_commit labels
  tagged_commit="$(image_source_commit "$image")" || fail "Candidate image tag must contain a Git commit and timestamp: $image"
  [[ "$tagged_commit" == "$COMMIT" ]] || fail "Candidate image source tag does not match current source $COMMIT."
  labels="$(orb -m "$MACHINE" -u root docker image inspect --format '{{json .Config.Labels}}' "$image")" \
    || fail "Candidate image is not available on Lab machine: $image"
  python3 - "$SOURCE_REVISION" "$AMADEUS_VERSION" "$labels" <<'PY'
import json, re, sys
revision, version, raw_labels = sys.argv[1:]
labels = json.loads(raw_labels)
if labels.get('com.amadeus.release.provenance') != 'amadeus-product-release-v1': raise SystemExit('candidate provenance marker is invalid')
if labels.get('org.opencontainers.image.revision') != revision: raise SystemExit('candidate source revision does not match current HEAD')
if labels.get('org.opencontainers.image.version') != version: raise SystemExit('candidate product version does not match VERSION')
created = labels.get('org.opencontainers.image.created', '')
if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', created): raise SystemExit('candidate build timestamp is invalid')
print('OPENCLAW_CANDIDATE_PROVENANCE=passed')
PY
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
  if git -C "$ROOT_DIR" cat-file -e "$live_commit^{commit}" 2>/dev/null; then
    live_version="$(git -C "$ROOT_DIR" show "$live_commit:VERSION" 2>/dev/null | tr -d '[:space:]')"
  elif ((LINEAGE_BRIDGE)); then
    live_version="$(orb -m "$MACHINE" -u root docker run --rm --entrypoint cat "$live_image" /opt/amadeus/VERSION | tr -d '[:space:]')"
    printf 'LINEAGE_BRIDGE=validated\n'
  else
    fail "Live OpenClaw source commit is not available locally: $live_commit; use --lineage-bridge with an explicit OpenClaw build."
  fi
  [[ "$live_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Live OpenClaw source commit has no valid VERSION: $live_commit"
  version_is_greater "$AMADEUS_VERSION" "$live_version" || fail "Refusing apply: VERSION=$AMADEUS_VERSION must advance beyond live Amadeus version $live_version; run scripts/amadeus-version.sh bump patch."
  printf 'LIVE_AMADEUS_VERSION=%s\n' "$live_version"
}

assert_candidate_version_unchanged() {
  local live_image live_commit live_version
  live_image="$(resolve_live_image openclaw)" || fail 'Could not resolve live OpenClaw image for candidate.'
  live_commit="$(image_source_commit "$live_image")" || fail 'Live OpenClaw image has no Git source tag.'
  if git -C "$ROOT_DIR" cat-file -e "$live_commit^{commit}" 2>/dev/null; then
    live_version="$(git -C "$ROOT_DIR" show "$live_commit:VERSION" 2>/dev/null | tr -d '[:space:]')"
  elif ((LINEAGE_BRIDGE)); then
    live_version="$(orb -m "$MACHINE" -u root docker run --rm --entrypoint cat "$live_image" /opt/amadeus/VERSION | tr -d '[:space:]')"
    printf 'LINEAGE_BRIDGE=validated\n'
  else
    fail "Live OpenClaw source commit is not available locally: $live_commit; use --lineage-bridge with an explicit OpenClaw build."
  fi
  [[ "$AMADEUS_VERSION" == "$live_version" ]] || fail "Candidate apply must keep live VERSION=$live_version; found $AMADEUS_VERSION."
  printf 'LIVE_AMADEUS_VERSION=%s\n' "$live_version"
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --candidate) CANDIDATE=1 ;;
    --openclaw-only) OPENCLAW_ONLY=1 ;;
    --auto-release) AUTO_RELEASE=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    --lineage-bridge) LINEAGE_BRIDGE=1 ;;
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
# The single-step Lab main release (the documented `--apply --auto-release --build-openclaw`, as the release
# automation calls it) is OpenClaw-only by definition.
((AUTO_RELEASE == 0)) || OPENCLAW_ONLY=1

if ((CANDIDATE)); then
  ((OPENCLAW_ONLY == 1)) || fail 'Lab candidate apply is OpenClaw-only; full Lab candidate is not used.'
  ((AUTO_RELEASE == 0)) || fail '--candidate cannot combine with --auto-release (use formal --auto-release).'
fi

if ((OPENCLAW_ONLY)); then
  ((AUTO_RELEASE == 1 || CANDIDATE == 1 || BUILD_ONLY == 1)) || fail '--openclaw-only requires --auto-release, --candidate, or build-only.'
  ((BUILD == 0 && BUILD_RADAR == 0 && AUTO_BUILD == 0)) \
    || fail '--openclaw-only excludes full, Product Radar, and build-auto modes.'
  if ((BUILD_ONLY)); then
    ((APPLY == 0 && BUILD_OPENCLAW == 1 && NO_BUILD == 0)) \
      || fail '--build-only --openclaw-only requires --build-openclaw without --apply or --no-build.'
  elif ((APPLY)); then
    if ((AUTO_RELEASE || CANDIDATE)); then
      ((BUILD_OPENCLAW == 1 && NO_BUILD == 0 && AUTO_BUILD == 0)) \
        || fail 'Automatic Lab deploy must build a fresh OpenClaw image.'
    else
      ((BUILD_OPENCLAW == 0 && NO_BUILD == 1 && AUTO_BUILD == 0)) \
        || fail 'OpenClaw-only apply requires a prebuilt --image and --no-build.'
      [[ -n "$IMAGE" ]] || fail 'OpenClaw-only apply requires the prebuilt --image reference.'
    fi
  else
    ((BUILD_OPENCLAW == 1 || NO_BUILD == 1)) || fail 'OpenClaw-only plan requires --build-openclaw or --no-build.'
  fi
  ((LINEAGE_BRIDGE == 0)) || fail '--openclaw-only does not support lineage bridge.'
  [[ -z "$RADAR_IMAGE" ]] || fail '--openclaw-only does not accept --radar-image.'
fi
if ((AUTO_RELEASE)); then
  ((CANDIDATE == 0 && OPENCLAW_ONLY == 1)) || fail '--auto-release is the formal OpenClaw-only Lab release mode.'
  if ((APPLY)); then
    ((BUILD_OPENCLAW == 1 && NO_BUILD == 0 && BUILD == 0 && BUILD_RADAR == 0 && AUTO_BUILD == 0)) \
      || fail '--auto-release requires a fresh --build-openclaw image.'
  else
    ((BUILD_OPENCLAW == 1)) || fail '--auto-release dry-run requires --build-openclaw.'
  fi
  if ((APPLY)); then
    [[ "${LAB_AUTOMATION_VERIFIED_MAIN_SHA:-}" == "$(git -C "$ROOT_DIR" rev-parse HEAD)" ]] \
      || fail '--auto-release requires LAB_AUTOMATION_VERIFIED_MAIN_SHA to match the clean main HEAD.'
    if ! git -C "$ROOT_DIR" merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
      fail '--auto-release source must be reachable from origin/main.'
    fi
  fi
fi
if ((CANDIDATE)); then
  ((OPENCLAW_ONLY == 1 && AUTO_RELEASE == 0)) || fail '--candidate is the OpenClaw-only Lab main candidate mode.'
  if ((APPLY)); then
    ((BUILD_OPENCLAW == 1 && NO_BUILD == 0 && BUILD == 0 && BUILD_RADAR == 0 && AUTO_BUILD == 0)) \
      || fail '--candidate requires a fresh --build-openclaw image.'
    [[ "${LAB_AUTOMATION_VERIFIED_MAIN_SHA:-}" == "$(git -C "$ROOT_DIR" rev-parse HEAD)" ]] \
      || fail '--candidate requires LAB_AUTOMATION_VERIFIED_MAIN_SHA to match the clean main HEAD.'
    if ! git -C "$ROOT_DIR" merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
      fail '--candidate source must be reachable from origin/main.'
    fi
  else
    ((BUILD_OPENCLAW == 1)) || fail '--candidate dry-run requires --build-openclaw.'
  fi
fi

if ((AUTO_BUILD && (BUILD || BUILD_OPENCLAW || BUILD_RADAR || NO_BUILD))); then
  fail '--build-auto cannot be combined with an explicit build or no-build option.'
fi
if ((NO_BUILD && (BUILD || BUILD_OPENCLAW || BUILD_RADAR || AUTO_BUILD))); then
  fail '--no-build cannot be combined with a build option.'
fi
((FULL_VERIFY == 0 || APPLY == 1)) || fail '--full-verify requires --apply.'
((BUILD_ONLY == 0 || APPLY == 0)) || fail '--build-only cannot be combined with --apply.'
((BUILD_ONLY == 0 || OPENCLAW_ONLY == 1)) || fail '--build-only is scoped to --openclaw-only candidates.'
((LINEAGE_BRIDGE == 0 || APPLY == 1)) || fail '--lineage-bridge requires --apply.'
[[ "$IMAGE" != *$'\n'* && "$IMAGE" != *[[:space:]]* ]] || fail 'OpenClaw image tag contains whitespace.'
[[ "$RADAR_IMAGE" != *$'\n'* && "$RADAR_IMAGE" != *[[:space:]]* ]] || fail 'Product Radar image tag contains whitespace.'
[[ "$QWEN_IMAGE_LOCAL_ONLY" == 0 || "$QWEN_IMAGE_LOCAL_ONLY" == 1 ]] || fail 'Qwen local-only flag must be 0 or 1.'
[[ "$QWEN_IMAGE_FALLBACK_ENABLED" == 0 || "$QWEN_IMAGE_FALLBACK_ENABLED" == 1 ]] || fail 'Qwen fallback flag must be 0 or 1.'
((QWEN_IMAGE_LOCAL_ONLY == 0 || CANDIDATE == 1)) || fail 'Qwen local-only image route is candidate-only.'
STAMP="$(date -u +%Y%m%d%H%M%S)"
COMMIT="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
SOURCE_REVISION="$(git -C "$ROOT_DIR" rev-parse HEAD)"
BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Stage timing goes to stderr so machine-read stdout keys stay unchanged.
DEPLOY_STARTED_AT="$(date +%s)"
DEPLOY_STAGE_NAME=''
DEPLOY_STAGE_STARTED_AT="$DEPLOY_STARTED_AT"
deploy_stage() {
  local now
  now="$(date +%s)"
  if [[ -n "$DEPLOY_STAGE_NAME" ]]; then
    printf 'DEPLOY_STAGE=%s seconds=%s\n' "$DEPLOY_STAGE_NAME" "$((now - DEPLOY_STAGE_STARTED_AT))" >&2
  fi
  if [[ "$1" == done ]]; then
    printf 'DEPLOY_STAGE_TOTAL seconds=%s\n' "$((now - DEPLOY_STARTED_AT))" >&2
    DEPLOY_STAGE_NAME=''
  else
    DEPLOY_STAGE_NAME="$1"
  fi
  DEPLOY_STAGE_STARTED_AT="$now"
}
deploy_stage prepare
AMADEUS_VERSION="$(bash "$VERSION_TOOL" show)"
bash "$VERSION_TOOL" check >/dev/null
RELEASE_NOTES="$(bash "$VERSION_TOOL" notes)"
# The deployment envelope owns the world-line closing. Strip an accidentally
# repeated standalone closing from release notes before appending it once.
RELEASE_NOTES="$(printf '%s\n' "$RELEASE_NOTES" | sed '/^[[:space:]]*El Psy Kongroo\.[[:space:]]*$/d')"
if ((BUILD_ONLY && OPENCLAW_ONLY)); then
  IMAGE="${IMAGE:-local/openclaw-amadeus:git-$COMMIT-$STAMP}"
elif ((APPLY)); then
  if ((AUTO_RELEASE || CANDIDATE)); then
    IMAGE="local/openclaw-amadeus:git-$COMMIT-$STAMP"
  elif ((OPENCLAW_ONLY)); then
    :
  elif ((AUTO_BUILD)); then
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

if ((LINEAGE_BRIDGE)); then
  ((BUILD_OPENCLAW == 1 && BUILD_RADAR == 1)) || fail '--lineage-bridge requires fresh OpenClaw and Product Radar builds (--build or both --build-openclaw --build-radar).'
fi

if ((NO_BUILD)); then
  ((BUILD_OPENCLAW == 0 && BUILD_RADAR == 0 && AUTO_BUILD == 0)) || fail '--no-build cannot be combined with any build option.'
fi
if ((OPENCLAW_ONLY && BUILD_ONLY)); then
  BUILD_MODE='openclaw-only-build'
elif ((OPENCLAW_ONLY && NO_BUILD)); then
  BUILD_MODE='openclaw-only-prebuilt'
elif ((OPENCLAW_ONLY)); then
  BUILD_MODE='openclaw-only-scoped'
elif ((BUILD_OPENCLAW == 1 && BUILD_RADAR == 1)); then
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

if ((APPLY == 1 && OPENCLAW_ONLY == 0 && BUILD_RADAR == 1 && BUILD_OPENCLAW == 0)); then
  fail 'Refusing Product Radar-only apply: the Lab-default deployment also restarts OpenClaw. Use --dry-run or prepare a reviewed full two-image Lab deployment.'
fi
if ((APPLY && AUTO_RELEASE == 0 && CANDIDATE == 0)); then
  fail 'Direct Lab runtime apply is retired; use Lab auto-release candidate (main) or formal approval.'
fi

shown_image="$IMAGE"
shown_radar_image="$RADAR_IMAGE"
[[ -n "$shown_image" ]] || shown_image='resolved from live CasaOS container on apply'
[[ -n "$shown_radar_image" ]] || shown_radar_image='resolved from live CasaOS container on apply'
if ((BUILD_ONLY)); then deployment_mode=build-only; elif ((APPLY)); then deployment_mode=apply; else deployment_mode=dry-run; fi
printf 'MODE=%s\n' "$deployment_mode"
printf 'BUILD_MODE=%s\n' "$BUILD_MODE"
printf 'AMADEUS_VERSION=%s\n' "$AMADEUS_VERSION"
if ((AUTO_RELEASE)); then
  printf '%s\n' 'DEPLOYMENT_PHASE=formal-release'
elif ((CANDIDATE)); then
  printf '%s\n' 'DEPLOYMENT_PHASE=candidate'
else
  printf 'DEPLOYMENT_PHASE=%s\n' release
fi
printf 'DEPLOYMENT_SCOPE=%s\n' "$([[ $OPENCLAW_ONLY -eq 1 ]] && printf openclaw-only || printf lab-default)"
printf 'QWEN_IMAGE_LOCAL_ONLY=%s\n' "$QWEN_IMAGE_LOCAL_ONLY"
printf 'QWEN_IMAGE_FALLBACK_ENABLED=%s\n' "$QWEN_IMAGE_FALLBACK_ENABLED"
printf 'LINEAGE_BRIDGE=%s\n' "$LINEAGE_BRIDGE"
printf 'OPENCLAW_IMAGE=%s\n' "$shown_image"
printf 'PRODUCT_RADAR_IMAGE=%s\n' "$shown_radar_image"
printf 'MACHINE=%s\n' "$MACHINE"

if ((APPLY == 0 && BUILD_ONLY == 0)); then
  printf '%s\n' 'PLAN=on apply, reuse live images by default; --build-auto rebuilds only affected images; --build remains the explicit full two-image migration path.'
  live_openclaw="$(resolve_live_image openclaw 2>/dev/null || true)"
  if ((OPENCLAW_ONLY == 0)); then live_radar="$(resolve_live_image product-radar 2>/dev/null || true)"; else live_radar=''; fi
  if [[ -n "$live_openclaw" ]]; then
    if image_needs_rebuild "$live_openclaw" openclaw; then printf '%s\n' 'AUTO_SCOPE_OPENCLAW=build'; else printf '%s\n' 'AUTO_SCOPE_OPENCLAW=reuse'; fi
  fi
  if ((OPENCLAW_ONLY == 0)) && [[ -n "$live_radar" ]]; then
    if image_needs_rebuild "$live_radar" radar; then printf '%s\n' 'AUTO_SCOPE_PRODUCT_RADAR=build'; else printf '%s\n' 'AUTO_SCOPE_PRODUCT_RADAR=reuse'; fi
  fi
  exit 0
fi

[[ "$MACHINE" != community ]] || fail 'Lab build/apply requires an operator-owned host profile; community defaults are dry-run only.'

[[ -n "$IMAGE" ]] || fail 'Apply requires a resolvable OpenClaw image.'
if ((OPENCLAW_ONLY == 0)); then [[ -n "$RADAR_IMAGE" ]] || fail 'Apply requires a resolvable Product Radar image.'; fi
git -C "$ROOT_DIR" diff --check
git -C "$ROOT_DIR" diff --quiet || fail 'Refusing apply with unstaged changes; commit reviewed source first.'
git -C "$ROOT_DIR" diff --cached --quiet || fail 'Refusing apply with staged-but-uncommitted changes.'
if ((CANDIDATE)); then assert_candidate_version_unchanged; else assert_release_version_advanced; fi

if ((APPLY)); then
  python3 "$ROOT_DIR/scripts/provision-9router-image-combo.py" --verify-live --machine "$MACHINE"
  python3 "$ROOT_DIR/scripts/verify-9router-image-reference.py" --machine "$MACHINE"
fi
if ((BUILD_OPENCLAW == 0)); then
  if ((OPENCLAW_ONLY)); then assert_openclaw_candidate_image "$IMAGE"; else assert_image_fresh "$IMAGE" openclaw; fi
fi
if ((OPENCLAW_ONLY == 0 && BUILD_RADAR == 0)); then assert_image_fresh "$RADAR_IMAGE" radar; fi

deploy_stage verify
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
  node --check scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs
  node --check scripts/patch-openclaw-group-image-policy.mjs
  node --check scripts/patch-openclaw-heartbeat-silence.mjs
  node --check scripts/patch-openclaw-memory-core.mjs
  node scripts/test-patch-openclaw-group-image-policy.mjs
  node scripts/test-patch-openclaw-heartbeat-silence.mjs
  node scripts/test-patch-openclaw-memory-core.mjs
  pnpm test:openclaw-image-route-authority
  node scripts/test-delivery-boundary.mjs
  node scripts/test-patch-openclaw-whatsapp-voice-lifecycle.mjs
  node --check scripts/patch-openclaw-voice-failure.mjs
  node --check scripts/patch-openclaw-whatsapp-media-agent.mjs
  node scripts/test-patch-openclaw-whatsapp-media-agent.mjs
  node scripts/test-openclaw-bilingual-voice.mjs
  pnpm test:model-capability-adapter
  pnpm check:secrets
)

build_images_and_preflight() {
if ((BUILD_OPENCLAW)); then
  deploy_stage image-build
  docker buildx build --platform linux/arm64 --load --progress=plain ${DOCKER_BUILD_PROXY_ARGS[@]+"${DOCKER_BUILD_PROXY_ARGS[@]}"} \
    --build-arg "OCI_SOURCE_REVISION=$SOURCE_REVISION" \
    --build-arg "OCI_PRODUCT_VERSION=$AMADEUS_VERSION" \
    --build-arg "OCI_BUILD_TIMESTAMP=$BUILD_TIMESTAMP" \
    --file "$ROOT_DIR/infra/docker/casaos/openclaw/Dockerfile" --tag "$IMAGE" "$ROOT_DIR"
  docker image inspect --format '{{json .Config.Labels}}' "$IMAGE" | python3 "$ROOT_DIR/scripts/verify-image-provenance.py" \
    --revision "$SOURCE_REVISION" --version "$AMADEUS_VERSION" --build-time "$BUILD_TIMESTAMP"
  deploy_stage image-transfer
  docker --context orbstack save "$IMAGE" | orb -m "$MACHINE" -u root docker load
else
  orb -m "$MACHINE" -u root docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "OpenClaw image not found: $IMAGE"
fi
deploy_stage image-preflight
if ((BUILD_OPENCLAW || OPENCLAW_ONLY)); then
  # Immutable-image preflight before any checkpoint-backed runtime write. The
  # container runs as node, so root-readable-only bundles must fail here.
  orb -m "$MACHINE" -u root docker run --rm --user 1000:1000 --entrypoint node "$IMAGE" --check /app/dist/extensions/amadeus/dist/index.js >/dev/null \
    || fail 'Immutable OpenClaw image has an unreadable or invalid Amadeus plugin.'
  printf 'OPENCLAW_IMAGE_NODE_PREFLIGHT=passed\n'
  orb -m "$MACHINE" -u root docker run --rm --entrypoint sh "$IMAGE" -lc "grep -Fq 'codex-amadeus-heartbeat-silent-delivery-v1' /app/dist/heartbeat-runner-CPy-qxAy.mjs" \
    || fail 'Immutable OpenClaw image is missing the heartbeat silence guard.'
  printf 'OPENCLAW_IMAGE_HEARTBEAT_SILENCE=passed\n'
  orb -m "$MACHINE" -u root docker run --rm --entrypoint sh "$IMAGE" -lc "grep -Fq 'amadeus-memory-knn-loader-path-v1' /app/dist/extensions/memory-core/manager-runtime.js && grep -Fq 'amadeus-memory-dreaming-peer-admission-v2' /app/dist/extensions/memory-core/openclaw.plugin.json && grep -Fq 'amadeus-memory-dreaming-peer-admission-v2' /app/dist/session-ingestion-*.mjs && grep -Fq 'amadeus-memory-backfill-peer-admission-v1' /app/dist/session-backfill-*.mjs && grep -Fq 'amadeus-memory-dreaming-no-corpus-v1' /app/dist/dreaming-phases-*.mjs && grep -Fq 'amadeus-memory-dreaming-no-corpus-v1' /app/dist/extensions/memory-core/index.js && grep -Fq 'classifyDreamingSessionAdmission' /app/dist/session-ingestion-*.mjs" \
    || fail 'Immutable OpenClaw image is missing the Memory Core runtime fixes.'
  printf 'OPENCLAW_IMAGE_MEMORY_CORE_PATCH=passed\n'
fi
image_amadeus_version="$(orb -m "$MACHINE" -u root docker run --rm --entrypoint cat "$IMAGE" /opt/amadeus/VERSION | tr -d '[:space:]')"
[[ "$image_amadeus_version" == "$AMADEUS_VERSION" ]] || fail "Immutable OpenClaw candidate contains Amadeus VERSION=$image_amadeus_version, expected $AMADEUS_VERSION."
printf 'OPENCLAW_IMAGE_AMADEUS_VERSION=%s\n' "$image_amadeus_version"
if ((OPENCLAW_ONLY)); then
  printf 'OPENCLAW_RUNTIME_SECRET_FILES=preserved\n'
else
  validate_vps_account_map_source
  run_vps_account_map_node_preflight
fi
deploy_stage radar-build
if ((BUILD_RADAR)); then
  docker buildx build --platform linux/arm64 --load --progress=plain ${DOCKER_BUILD_PROXY_ARGS[@]+"${DOCKER_BUILD_PROXY_ARGS[@]}"} \
    --build-arg "OCI_SOURCE_REVISION=$SOURCE_REVISION" \
    --build-arg "OCI_PRODUCT_VERSION=$AMADEUS_VERSION" \
    --build-arg "OCI_BUILD_TIMESTAMP=$BUILD_TIMESTAMP" \
    --file "$ROOT_DIR/apps/product-radar/Dockerfile" --tag "$RADAR_IMAGE" "$ROOT_DIR"
  docker image inspect --format '{{json .Config.Labels}}' "$RADAR_IMAGE" | python3 "$ROOT_DIR/scripts/verify-image-provenance.py" \
    --revision "$SOURCE_REVISION" --version "$AMADEUS_VERSION" --build-time "$BUILD_TIMESTAMP"
  docker --context orbstack save "$RADAR_IMAGE" | orb -m "$MACHINE" -u root docker load
elif ((OPENCLAW_ONLY == 0)); then
  orb -m "$MACHINE" -u root docker image inspect "$RADAR_IMAGE" >/dev/null 2>&1 || fail "Product Radar image not found: $RADAR_IMAGE"
fi

}

# Automated Lab deploys (candidate + formal) verify the checkpoint before compiling
# the immutable image. The legacy build-only command remains checkpoint-free.
if ((BUILD_ONLY || (AUTO_RELEASE == 0 && CANDIDATE == 0))); then
  build_images_and_preflight
fi

if ((BUILD_ONLY)); then
  deploy_stage done
  printf 'BUILD_VERIFIED=passed\nOPENCLAW_IMAGE=%s\nSOURCE_REVISION=%s\nVERSION=%s\n' "$IMAGE" "$SOURCE_REVISION" "$AMADEUS_VERSION"
  exit 0
fi

deploy_stage checkpoint
CHECKPOINT_ID="amadeus-openclaw-$STAMP"
if ((AUTO_RELEASE || CANDIDATE)); then
  CHECKPOINT_DIR="$OPENCLAW_DATA_DIR/data/deploy-recovery/$CHECKPOINT_ID"
else
  CHECKPOINT_DIR="$SKULD_BACKUP_ROOT/deploy/$CHECKPOINT_ID"
fi
OPENCLAW_COMPOSE_FILE="$OPENCLAW_APP_DIR/docker-compose.yml"
RADAR_COMPOSE_FILE="$RADAR_APP_DIR/docker-compose.yml"
RADAR_ENV_FILE="$RADAR_APP_DIR/.env"
MEDIA_COMPOSE_FILE="$MEDIA_ADAPTER_APP_DIR/docker-compose.yml"

if ((OPENCLAW_ONLY && AUTO_RELEASE == 0 && CANDIDATE == 0)); then
  STORAGE_PREFLIGHT_LIB_ONLY=1
  # shellcheck disable=SC1091
  source "$ROOT_DIR/scripts/storage-preflight.sh"
  storage_host_volume_check "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_VOLUME_UUID"
  if ((STORAGE_FAILURES == 0)); then storage_read_sentinel "$EXTERNAL_STORAGE_ROOT" "$EXTERNAL_STORAGE_SENTINEL_ID"; fi
  if ((STORAGE_FAILURES == 0)); then storage_identity_only_check "$CHECKPOINT_DIR"; fi
  ((STORAGE_FAILURES == 0)) || fail 'External Lab checkpoint storage identity is not verified; no runtime change was made.'
fi

PREPARE="$ROOT_DIR/scripts/openclaw_prepare.py"
PATCH_RUNTIME="$ROOT_DIR/scripts/patch-openclaw-channel-identity.mjs"
VOICE_PATCH_RUNTIME="$ROOT_DIR/scripts/patch-openclaw-voice-failure.mjs"
MEDIA_AGENT_PATCH_RUNTIME="$ROOT_DIR/scripts/patch-openclaw-whatsapp-media-agent.mjs"
VOICE_LIFECYCLE_PATCH_RUNTIME="$ROOT_DIR/scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs"
for source in \
  "$ROOT_DIR/infra/docker/casaos/openclaw/docker-compose.example.yml" \
  "$ROOT_DIR/infra/docker/casaos/product-radar/docker-compose.example.yml" \
  "$ROOT_DIR/integrations/openclaw/openclaw.json.example" \
  "$ROOT_DIR/packages/pubg-domain/config/default-team.json" \
  "$VOICE_LIFECYCLE_PATCH_RUNTIME" \
  "$ROOT_DIR/scripts/patch-openclaw-memory-core.mjs" \
  "$ROOT_DIR/scripts/openclaw-voice-markers.mjs" \
  "$ROOT_DIR/scripts/openclaw-voice-lease.mjs" \
  "$ROOT_DIR/integrations/openclaw/workspace-seed/AGENTS.seed.md" \
  "$ROOT_DIR/integrations/openclaw/workspace-seed/SOUL.seed.md" \
  "$ROOT_DIR/integrations/openclaw/workspace-seed/USER.seed.md" \
  "$ROOT_DIR/integrations/openclaw/workspace-seed/MEMORY.seed.md" "$PREPARE" "$PATCH_RUNTIME" "$VOICE_PATCH_RUNTIME" "$MEDIA_AGENT_PATCH_RUNTIME"; do
  [[ -f "$source" ]] || fail "Missing deployment source: $source"
done

if ((OPENCLAW_ONLY && AUTO_RELEASE == 0)); then
  orb -m "$MACHINE" -u root python3 - "$PUBG_TELEMETRY_ARCHIVE_HOST_DIR" <<'PY'
import sys
from pathlib import Path
archive = Path(sys.argv[1])
if not archive.is_absolute() or archive.is_symlink() or not archive.is_dir():
    raise SystemExit('PUBG telemetry archive must be an existing non-symlink directory before checkpointing')
for entry in archive.rglob('*'):
    if entry.is_symlink() or not (entry.is_dir() or entry.is_file()):
        raise SystemExit('PUBG telemetry archive contains an unsupported filesystem entry')
print('PUBG_TELEMETRY_ARCHIVE_SOURCE=verified')
PY
fi

OPENCLAW_COMPOSE_B64="$(base64_file "$ROOT_DIR/infra/docker/casaos/openclaw/docker-compose.example.yml")"
RADAR_COMPOSE_B64="$(base64_file "$ROOT_DIR/infra/docker/casaos/product-radar/docker-compose.example.yml")"
CONFIG_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/openclaw.json.example")"
TEAM_B64="$(base64_file "$ROOT_DIR/packages/pubg-domain/config/default-team.json")"
AGENTS_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace-seed/AGENTS.seed.md")"
SOUL_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace-seed/SOUL.seed.md")"
USER_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace-seed/USER.seed.md")"
MEMORY_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace-seed/MEMORY.seed.md")"

CHECKPOINT_ARGS=(
  "$CHECKPOINT_DIR"
  "$OPENCLAW_COMPOSE_FILE" openclaw-compose.before.yml \
  "$OPENCLAW_APP_DIR/.env" openclaw-compose.env.before \
  "$OPENCLAW_DATA_DIR/config/openclaw.json" openclaw-config.before.json \
  "$OPENCLAW_DATA_DIR/config/state/openclaw.sqlite" openclaw-state.sqlite.before \
  "$OPENCLAW_DATA_DIR/config/agents/main/agent/openclaw-agent.sqlite" openclaw-agent.sqlite.before \
  "$OPENCLAW_DATA_DIR/config/agents/main/sessions" openclaw-sessions.before \
  "$OPENCLAW_DATA_DIR/openclaw.env" openclaw.env.before \
  "$OPENCLAW_DATA_DIR/secrets" openclaw-secrets.before \
  "$OPENCLAW_DATA_DIR/data/pubg.sqlite" pubg.sqlite.before \
  "$OPENCLAW_DATA_DIR/data/identity.sqlite" identity.sqlite.before \
  "$OPENCLAW_DATA_DIR/data/vps-usage-state.json" vps-usage-state.json.before \
  "$OPENCLAW_DATA_DIR/data/longbridge-oauth.json" longbridge-oauth.json.before \
  "$OPENCLAW_DATA_DIR/data/longbridge-sdk-home" longbridge-sdk-home.before \
  "$OPENCLAW_DATA_DIR/notifications" owner-notifications.before \
  "$OPENCLAW_DATA_DIR/workspace" openclaw-workspace.before \
  "$OPENCLAW_DATA_DIR/config/npm/projects" openclaw-whatsapp-npm-projects.before
)
if ((OPENCLAW_ONLY == 0)); then
  CHECKPOINT_ARGS+=(
    "$RADAR_COMPOSE_FILE" product-radar-compose.before.yml
    "$RADAR_ENV_FILE" product-radar.env.before
    "$MEDIA_COMPOSE_FILE" media-organizer-compose.before.yml
    "$RADAR_DATA_DIR/product-radar.sqlite" product-radar.sqlite.before
  )
else
  CHECKPOINT_ARGS+=(
    "$PUBG_TELEMETRY_ARCHIVE_HOST_DIR" pubg-telemetry-archive.before
  )
fi
# Automatic deploys preserve only tiny Compose rollback metadata.
# They never copy SQLite, sessions, secrets, or complete telemetry archives.
if ((AUTO_RELEASE || CANDIDATE)); then
  CHECKPOINT_ARGS=(
    "$CHECKPOINT_DIR"
    "$OPENCLAW_COMPOSE_FILE" openclaw-compose.before.yml
    "$OPENCLAW_APP_DIR/.env" openclaw-compose.env.before
  )
fi
orb -m "$MACHINE" -u root python3 - "${CHECKPOINT_ARGS[@]}" <<'PY'
import hashlib, json, os, shutil, sqlite3, stat, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
checkpoint = Path(sys.argv[1])
if checkpoint.exists() or checkpoint.is_symlink(): raise SystemExit('checkpoint already exists: ' + str(checkpoint))
os.umask(0o077)
checkpoint.mkdir(mode=0o700, parents=True)
if stat.S_IMODE(checkpoint.stat().st_mode) != 0o700:
    raise SystemExit('protected checkpoint directory is not mode 0700')
args = sys.argv[2:]
if len(args) % 2: raise SystemExit('checkpoint pairs are unbalanced')
for i in range(0, len(args), 2):
    source, destination = Path(args[i]), checkpoint / args[i + 1]
    if not source.exists(): continue
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix in {'.sqlite', '.sqlite3', '.db'}:
        if source.is_symlink(): raise SystemExit('OpenClaw state SQLite path must not be a symlink')
        live = sqlite3.connect('file:' + str(source) + '?mode=ro', uri=True, timeout=15)
        saved = sqlite3.connect(str(destination))
        try: live.backup(saved)
        finally: saved.close(); live.close()
        os.chmod(destination, 0o600)
    elif source.is_dir(): shutil.copytree(source, destination, symlinks=True)
    else: shutil.copy2(source, destination)
containers = {}
for name in ['openclaw']:
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
        sensitive = source.suffix in {'.sqlite', '.sqlite3', '.db'} or source.name in {'openclaw.env', '.env', 'longbridge-oauth.json', 'longbridge-sdk-home'} or 'secrets' in source.parts
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
for name in ('backup-manifest.json', 'checkpoint.json'):
    if stat.S_IMODE((checkpoint / name).stat().st_mode) != 0o600:
        raise SystemExit('protected checkpoint manifest is not mode 0600')
print('CHECKPOINT=' + str(checkpoint))
PY

if ((OPENCLAW_ONLY && AUTO_RELEASE == 0)); then
  orb -m "$MACHINE" -u root test -s "$CHECKPOINT_DIR/openclaw-compose.before.yml"
  orb -m "$MACHINE" -u root test -s "$CHECKPOINT_DIR/openclaw-agent.sqlite.before"
  orb -m "$MACHINE" -u root test -d "$CHECKPOINT_DIR/openclaw-workspace.before"
  orb -m "$MACHINE" -u root test -d "$CHECKPOINT_DIR/openclaw-sessions.before"
  orb -m "$MACHINE" -u root test -d "$CHECKPOINT_DIR/pubg-telemetry-archive.before"
  orb -m "$MACHINE" -u root python3 - \
    "$PUBG_TELEMETRY_ARCHIVE_HOST_DIR" "$CHECKPOINT_DIR/pubg-telemetry-archive.before" <<'PY'
import hashlib, sys
from pathlib import Path
def fingerprint(root):
    if root.is_symlink() or not root.is_dir(): raise SystemExit('archive checkpoint directory is invalid')
    directories, files = set(), {}
    for path in root.rglob('*'):
        if path.is_symlink(): raise SystemExit('archive checkpoint contains a symlink')
        relative = path.relative_to(root).as_posix()
        if path.is_dir(): directories.add(relative)
        elif path.is_file():
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
            files[relative] = digest.hexdigest()
        else: raise SystemExit('archive checkpoint contains an unsupported entry')
    return directories, files
source, backup = map(Path, sys.argv[1:])
source_tree, backup_tree = fingerprint(source), fingerprint(backup)
if source_tree != backup_tree: raise SystemExit('PUBG telemetry archive backup verification failed')
print(f'PUBG_TELEMETRY_ARCHIVE_BACKUP=verified files={len(source_tree[1])}')
PY
fi

if ((AUTO_RELEASE || CANDIDATE)); then
  build_images_and_preflight
fi

deploy_stage prepare-runtime
OPENCLAW_SWITCHED=0
# WhatsApp runtime module (persisted under config/npm/projects, not in the image).
# Every apply path, including openclaw-only auto-release, restores the
# checksum-pinned pristine monitor, installs the typed boundary from
# delivery-boundary/whatsapp-plan.js, then re-applies every lifecycle patch in
# the same order, so the result is deterministic and no patch is wiped.
install_whatsapp_runtime_patches() {
tar -C "$ROOT_DIR/integrations/openclaw/delivery-boundary" -cf - install.mjs whatsapp-plan.js whatsapp-status-reaction.js | \
  orb -m "$MACHINE" -u root docker exec -i openclaw sh -ec '
    tmp=$(mktemp -d /tmp/amadeus-delivery-boundary.XXXXXX)
    trap "rm -rf $tmp" EXIT
    tar -C "$tmp" -xf -
    node "$tmp/install.mjs" --whatsapp-root /home/node/.openclaw/npm/projects --apply
  '

orb -m "$MACHINE" -u root docker exec -i openclaw node - \
  --whatsapp-root /home/node/.openclaw/npm/projects < "$PATCH_RUNTIME"
orb -m "$MACHINE" -u root docker exec -i openclaw node - \
  /home/node/.openclaw/npm/projects < "$VOICE_PATCH_RUNTIME"
orb -m "$MACHINE" -u root docker exec -i openclaw node - \
  /home/node/.openclaw/npm/projects < "$MEDIA_AGENT_PATCH_RUNTIME"
tar -C "$ROOT_DIR/scripts" -cf - \
  patch-openclaw-whatsapp-voice-lifecycle.mjs openclaw-voice-markers.mjs \
  openclaw-voice-lease.mjs | \
  orb -m "$MACHINE" -u root docker exec -i openclaw sh -ec '
    tmp=$(mktemp -d /tmp/amadeus-voice-patch.XXXXXX)
    trap "rm -rf $tmp" EXIT
    tar -C "$tmp" -xf -
    node "$tmp/patch-openclaw-whatsapp-voice-lifecycle.mjs" --whatsapp-root /home/node/.openclaw/npm/projects
  '
}
# Fails (and so rolls back) when the live module lacks any template hook.
verify_whatsapp_boundary_live() {
  tar -C "$ROOT_DIR/integrations/openclaw/delivery-boundary" -cf - install.mjs whatsapp-plan.js whatsapp-status-reaction.js | \
    orb -m "$MACHINE" -u root docker exec -i openclaw sh -ec '
      tmp=$(mktemp -d /tmp/amadeus-delivery-verify.XXXXXX)
      trap "rm -rf $tmp" EXIT
      tar -C "$tmp" -xf -
      node "$tmp/install.mjs" --whatsapp-root /home/node/.openclaw/npm/projects --verify
    '
}
WHATSAPP_MONITOR_GLOB='config/npm/projects/*/node_modules/@openclaw/whatsapp/dist/monitor-DaIAK4fT.js'
# Auto-release checkpoints stay tiny: keep only the single patched monitor.
backup_whatsapp_monitor() {
  orb -m "$MACHINE" -u root python3 - "$OPENCLAW_DATA_DIR" "$WHATSAPP_MONITOR_GLOB" "$CHECKPOINT_DIR/whatsapp-monitor.before.js" <<'PY'
import glob, os, shutil, sys
matches = glob.glob(os.path.join(sys.argv[1], sys.argv[2]))
if len(matches) != 1: raise SystemExit('whatsapp monitor module count mismatch')
shutil.copy2(matches[0], sys.argv[3]); open(sys.argv[3] + '.path', 'w').write(matches[0])
print('WHATSAPP_MONITOR_CHECKPOINT=saved')
PY
}
rollback_openclaw_candidate() {
  local status=$? restore_status=0
  if ((OPENCLAW_ONLY && OPENCLAW_SWITCHED && status != 0)); then
    trap - EXIT
    set +e
    if ((AUTO_RELEASE)); then
      printf 'AUTO_RELEASE_FAILURE=rollback_started checkpoint=%s\n' "$CHECKPOINT_DIR" >&2
    else
      printf 'CANDIDATE_FAILURE=rollback_started checkpoint=%s\n' "$CHECKPOINT_DIR" >&2
    fi
    orb -m "$MACHINE" -u root python3 - \
      "$CHECKPOINT_DIR/openclaw-compose.before.yml" "$OPENCLAW_COMPOSE_FILE" \
      "$CHECKPOINT_DIR/openclaw-compose.env.before" "$OPENCLAW_APP_DIR/.env" <<'PY'
import os, sys, tempfile
from pathlib import Path
compose_source, compose_destination, env_source, env_destination = map(Path, sys.argv[1:])
def restore(source, destination, required):
    if source.is_symlink(): raise SystemExit('checkpoint configuration source is a symlink')
    if not source.exists():
        if required: raise SystemExit('checkpoint Compose source is unavailable')
        if destination.is_symlink(): raise SystemExit('runtime Compose environment is a symlink')
        destination.unlink(missing_ok=True)
        return
    if not source.is_file() or destination.is_symlink(): raise SystemExit('checkpoint configuration path is invalid')
    fd, temporary_name = tempfile.mkstemp(prefix='.' + destination.name + '.rollback-', dir=destination.parent)
    temporary = Path(temporary_name)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(source.read_bytes())
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, source.stat().st_mode & 0o777)
    os.replace(temporary, destination)
restore(compose_source, compose_destination, True)
restore(env_source, env_destination, False)
PY
    restore_status=$?
    if ((restore_status == 0)); then
      orb -m "$MACHINE" -u root python3 - "$CHECKPOINT_DIR/whatsapp-monitor.before.js" <<'PY'
import os, shutil, sys
from pathlib import Path
source = Path(sys.argv[1]); marker = Path(str(source) + '.path')
if source.is_file() and marker.is_file():
    destination = Path(marker.read_text())
    temporary = destination.with_name(destination.name + '.rollback-tmp')
    shutil.copy2(source, temporary); os.replace(temporary, destination)
    print('WHATSAPP_MONITOR_ROLLBACK=restored')
PY
      restore_status=$?
    fi
    if ((restore_status == 0)); then
      orb -m "$MACHINE" -u root bash -lc "cd '$OPENCLAW_APP_DIR' && docker compose up -d --no-build --no-deps openclaw" >/dev/null
      restore_status=$?
    fi
    if ((restore_status == 0)); then
      for attempt in $(seq 1 40); do
        orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 3 http://127.0.0.1:18789/healthz >/dev/null 2>&1 && break
        sleep 2
      done
      orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18789/healthz >/dev/null
      restore_status=$?
      if ((restore_status == 0 && AUTO_RELEASE)); then
        # Docker runs its first health probe one interval (30s) after start;
        # wait for it instead of reading the transient "starting" state.
        restored_health=starting
        for attempt in $(seq 1 60); do
          restored_health="$(orb -m "$MACHINE" -u root docker inspect openclaw --format '{{.State.Health.Status}}' 2>/dev/null || true)"
          [[ "$restored_health" == starting ]] || break
          sleep 2
        done
        [[ "$restored_health" == healthy ]] || restore_status=1
      fi
    fi
    if ((restore_status == 0)); then
      if ((AUTO_RELEASE)); then
        printf 'AUTO_RELEASE_ROLLBACK=passed checkpoint=%s persisted_data=preserved\n' "$CHECKPOINT_DIR" >&2
      else
        printf 'CANDIDATE_ROLLBACK=passed checkpoint=%s persisted_data=preserved\n' "$CHECKPOINT_DIR" >&2
      fi
    else
      if ((AUTO_RELEASE)); then
        printf 'AUTO_RELEASE_ROLLBACK=failed checkpoint=%s inspect_before_any_restore=true\n' "$CHECKPOINT_DIR" >&2
      else
        printf 'CANDIDATE_ROLLBACK=failed checkpoint=%s inspect_before_any_restore=true\n' "$CHECKPOINT_DIR" >&2
      fi
    fi
    exit "$status"
  fi
  return "$status"
}
if ((OPENCLAW_ONLY)); then trap rollback_openclaw_candidate EXIT; fi

if ((OPENCLAW_ONLY == 0)); then
  [[ -f "$QWEN_IMAGE_TOKEN_HOST_FILE" && "$(stat -f %Lp "$QWEN_IMAGE_TOKEN_HOST_FILE")" == 600 ]] || fail "Qwen image token must exist with mode 600: $QWEN_IMAGE_TOKEN_HOST_FILE"
  [[ "$QWEN_IMAGE_TOKEN_GUEST_FILE" == /DATA/AppData/openclaw/secrets/* ]] || fail 'Qwen guest token must stay under the protected OpenClaw secrets directory.'
  orb -m "$MACHINE" -u root bash -lc 'umask 077; mkdir -p /DATA/AppData/openclaw/secrets; cat > /DATA/AppData/openclaw/secrets/qwen-image-token.tmp; chmod 600 /DATA/AppData/openclaw/secrets/qwen-image-token.tmp; chown 1000:1000 /DATA/AppData/openclaw/secrets/qwen-image-token.tmp; mv -f /DATA/AppData/openclaw/secrets/qwen-image-token.tmp "$1"' bash "$QWEN_IMAGE_TOKEN_GUEST_FILE" < "$QWEN_IMAGE_TOKEN_HOST_FILE"
  orb -m "$MACHINE" -u root test -f "$QWEN_IMAGE_TOKEN_GUEST_FILE"
  orb -m "$MACHINE" -u root bash -lc 'set -Eeuo pipefail; path="$1"; install -d -o root -g root -m 0700 "$(dirname "$path")"; cat > "$path.tmp"; chown 1000:1000 "$path.tmp"; chmod 0600 "$path.tmp"; mv -f "$path.tmp" "$path"' bash "$VPS_ACCOUNT_MAP_GUEST_FILE" < "$VPS_ACCOUNT_MAP_HOST_FILE"
  orb -m "$MACHINE" -u root test -f "$VPS_ACCOUNT_MAP_GUEST_FILE"
  orb -m "$MACHINE" -u root test "$(orb -m "$MACHINE" -u root stat -c %a "$VPS_ACCOUNT_MAP_GUEST_FILE")" = 600
  printf 'OPENCLAW_VPS_ACCOUNT_MAP=installed\n'
fi

if ((OPENCLAW_ONLY == 0)); then
orb -m "$MACHINE" -u root python3 - \
  "$OPENCLAW_DATA_DIR" "$CONFIG_B64" "$TEAM_B64" "$AGENTS_B64" "$SOUL_B64" "$USER_B64" "$MEMORY_B64" < "$PREPARE"

orb -m "$MACHINE" -u root python3 - \
  "$OPENCLAW_DATA_DIR/openclaw.env" "$MAC_CONTROL_HOST" "$MAC_CONTROL_USER" "$MAC_HOST_NAME" \
  "$HOME_LAB_SERVICE_BASE_URL" "$OPENWRT_BASE_URL" "$MAC_HOST_AGENT_BASE_URL" "$CONTROL_UI_LAN_ORIGIN" \
  "$AMADEUS_IMAGE_SERVICE_BASE_URL" "$AMADEUS_IMAGE_ASSET_HOST_DIR" "$OPENCLAW_IMAGE_SERVICE_TOKEN_HOST_FILE" "$VPS_ACCOUNT_MAP_GUEST_FILE" <<'PY'
import os, sys
from pathlib import Path
path = Path(sys.argv[1])
host, user, mac_host_name, home_lab_service_base_url, openwrt_base_url, mac_host_agent_base_url, control_ui_lan_origin, image_service_base_url, image_asset_host_dir, image_service_token_host_file, vps_account_map_host_file = sys.argv[2:]
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
set_env('MAC_HOST_NAME', mac_host_name)
set_env('HOME_LAB_SERVICE_BASE_URL', home_lab_service_base_url)
set_env('OPENWRT_BASE_URL', openwrt_base_url)
set_env('MAC_HOST_AGENT_BASE_URL', mac_host_agent_base_url)
set_env('CONTROL_UI_LAN_ORIGIN', control_ui_lan_origin)
set_env('AMADEUS_IMAGE_SERVICE_BASE_URL', image_service_base_url)
set_env('AMADEUS_IMAGE_ASSET_HOST_DIR', image_asset_host_dir)
set_env('OPENCLAW_IMAGE_SERVICE_TOKEN_HOST_FILE', image_service_token_host_file)
set_env('OPENCLAW_VPS_ACCOUNT_MAP_HOST_FILE', vps_account_map_host_file)
path.write_text('\n'.join(lines) + '\n')
os.chmod(path, 0o600)
print('MAC_CONTROL_PROFILE=installed')
PY

orb -m "$MACHINE" -u root docker run --rm --user 1000:1000 \
  --mount "type=bind,src=$VPS_ACCOUNT_MAP_GUEST_FILE,dst=/run/secrets/vps_account_map.json,readonly" \
  --entrypoint node "$IMAGE" -e "require('fs').readFileSync('/run/secrets/vps_account_map.json','utf8');" >/dev/null \
  || fail 'Installed guest VPS account map is not readable by container uid node.'
printf 'OPENCLAW_VPS_ACCOUNT_MAP_NODE_READ=passed\n'

install_whatsapp_runtime_patches
verify_whatsapp_boundary_live

orb -m "$MACHINE" -u root python3 - \
  "$OPENCLAW_APP_DIR" "$OPENCLAW_COMPOSE_FILE" "$OPENCLAW_COMPOSE_B64" "$IMAGE" \
  "$OPENCLAW_APP_DIR/.env" "$AMADEUS_IMAGE_SERVICE_BASE_URL" "$AMADEUS_IMAGE_ASSET_HOST_DIR" \
  "$OPENCLAW_IMAGE_SERVICE_TOKEN_HOST_FILE" "$PUBG_TELEMETRY_ARCHIVE_HOST_DIR" \
  "$QWEN_IMAGE_BASE_URL" "$QWEN_IMAGE_TOKEN_GUEST_FILE" "$QWEN_IMAGE_LOCAL_ONLY" "$QWEN_IMAGE_FALLBACK_ENABLED" <<'PY'
import base64, os, re, sys
from pathlib import Path
app_dir, compose_path, encoded, image, compose_env_path, image_service_base_url, image_asset_host_dir, image_service_token_host_file, pubg_telemetry_archive_host_dir, qwen_base_url, qwen_token_host_file, qwen_local_only, qwen_fallback_enabled = sys.argv[1:]
if not re.fullmatch(r'[A-Za-z0-9._/@:-]+', image): raise SystemExit('invalid OpenClaw image tag')
archive_path = Path(pubg_telemetry_archive_host_dir).expanduser()
if not archive_path.is_absolute() or '\n' in str(archive_path) or '\r' in str(archive_path): raise SystemExit('invalid PUBG telemetry archive host directory')
archive_path.mkdir(parents=True, exist_ok=True, mode=0o700)
if archive_path.is_symlink() or not archive_path.is_dir(): raise SystemExit('invalid PUBG telemetry archive host directory')
os.chown(archive_path, 1000, 1000)
os.chmod(archive_path, 0o700)
content = base64.b64decode(encoded).decode()
matches = list(re.finditer(r'(?m)^(\s*)image:\s*.*$', content))
if len(matches) != 1: raise SystemExit('OpenClaw compose must have one image line')
m = matches[0]
content = content[:m.start()] + m.group(1) + 'image: ' + image + content[m.end():]
Path(app_dir).mkdir(parents=True, exist_ok=True)
temporary = Path(compose_path + '.codex-tmp')
temporary.write_text(content); os.chmod(temporary, 0o644); os.replace(temporary, compose_path)
env_path = Path(compose_env_path)
env_lines = env_path.read_text().splitlines() if env_path.is_file() else []
env_lines = [line for line in env_lines if not line.strip().startswith(('AMADEUS_KREA2_IMAGE_BASE_URL=', 'AMADEUS_KREA2_IMAGE_TOKEN_FILE=', 'OPENCLAW_KREA2_IMAGE_TOKEN_HOST_FILE='))]
def set_env(key, value):
    prefix = key + '='
    for index, line in enumerate(env_lines):
        if line.strip().startswith(prefix):
            env_lines[index] = prefix + value
            return
    env_lines.append(prefix + value)
set_env('AMADEUS_IMAGE_SERVICE_BASE_URL', image_service_base_url)
set_env('AMADEUS_IMAGE_ASSET_HOST_DIR', image_asset_host_dir)
set_env('OPENCLAW_IMAGE_SERVICE_TOKEN_HOST_FILE', image_service_token_host_file)
set_env('PUBG_TELEMETRY_ARCHIVE_HOST_DIR', str(archive_path))
set_env('AMADEUS_QWEN_IMAGE_BASE_URL', qwen_base_url)
set_env('OPENCLAW_QWEN_IMAGE_TOKEN_HOST_FILE', qwen_token_host_file)
set_env('AMADEUS_QWEN_IMAGE_LOCAL_ONLY', qwen_local_only)
set_env('AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED', qwen_fallback_enabled)
set_env('AMADEUS_IMAGE_ASSET_CONTAINER_ROOT', '/var/lib/amadeus/image-assets')
env_path.write_text('\n'.join(env_lines) + '\n')
os.chmod(env_path, 0o600)
print('OPENCLAW_COMPOSE=installed')
print('OPENCLAW_COMPOSE_ENV=installed')
PY
else
  OPENCLAW_SWITCHED=1
  backup_whatsapp_monitor
  install_whatsapp_runtime_patches
  verify_whatsapp_boundary_live
  orb -m "$MACHINE" -u root python3 - \
    "$OPENCLAW_COMPOSE_FILE" "$OPENCLAW_APP_DIR/.env" "$IMAGE" "$PUBG_TELEMETRY_ARCHIVE_HOST_DIR" \
    < "$ROOT_DIR/scripts/openclaw_telemetry_mount.py"
  orb -m "$MACHINE" -u root docker compose --project-directory "$OPENCLAW_APP_DIR" \
    -f "$OPENCLAW_COMPOSE_FILE" config >/dev/null \
    || fail 'OpenClaw Compose configuration is invalid after installing the archive mount.'
fi

if ((OPENCLAW_ONLY == 0)); then
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
fi

if ((OPENCLAW_ONLY)); then
  orb -m "$MACHINE" -u root docker network inspect "$AMADEUS_NETWORK_NAME" >/dev/null 2>&1 || fail "$AMADEUS_NETWORK_NAME network is unavailable; scoped deployment will not create shared networks."
else
  orb -m "$MACHINE" -u root docker network inspect "$AMADEUS_NETWORK_NAME" >/dev/null 2>&1 || orb -m "$MACHINE" -u root docker network create "$AMADEUS_NETWORK_NAME" >/dev/null
fi
orb -m "$MACHINE" -u root docker network inspect "$NINE_ROUTER_NETWORK_NAME" >/dev/null 2>&1 || fail "$NINE_ROUTER_NETWORK_NAME network is unavailable."
MEDIA_ADAPTER_PRESENT=0
if ((OPENCLAW_ONLY == 0)) && orb -m "$MACHINE" -u root docker inspect "$MEDIA_ADAPTER_CONTAINER" >/dev/null 2>&1; then
  MEDIA_ADAPTER_PRESENT=1
  if ! orb -m "$MACHINE" -u root docker inspect --format '{{json .NetworkSettings.Networks}}' "$MEDIA_ADAPTER_CONTAINER" 2>/dev/null | grep -q "$AMADEUS_NETWORK_NAME"; then
    orb -m "$MACHINE" -u root docker network connect --alias media-organizer-adapter "$AMADEUS_NETWORK_NAME" "$MEDIA_ADAPTER_CONTAINER"
  fi
elif ((OPENCLAW_ONLY == 0)); then
  printf '%s\n' 'MEDIA_ADAPTER=absent (external service was not restored; media tool acceptance remains pending)' >&2
fi
if ((OPENCLAW_ONLY == 0)); then orb -m "$MACHINE" -u root docker compose --project-directory "$RADAR_APP_DIR" -f "$RADAR_COMPOSE_FILE" config >/dev/null; fi
# Ensure Lab web_search has a working key-free provider. DuckDuckGo's HTML
# scraper is bot-challenged in production, so Lab runs a private SearXNG
# container (amadeus_network, no host port) and the vendored @openclaw/searxng-plugin.
# Config is repaired here because --openclaw-only auto-release skips openclaw_prepare.py.
SEARXNG_PLUGIN_TGZ="$ROOT_DIR/integrations/openclaw/vendor/openclaw-searxng-plugin-2026.9.4.tar.gz"
SEARXNG_IMAGE_TAG="local/searxng:2026.10.19"
SEARXNG_UPSTREAM_IMAGE="searxng/searxng@sha256:5ed0323b5f5f8701264ef65e239a2bd83cb57098f2b971fa30bf79c06eeae271"
SEARXNG_SRC_DIR="$ROOT_DIR/infra/docker/casaos/searxng"
SEARXNG_APP_DIR=/var/lib/casaos/apps/searxng
SEARXNG_DATA_DIR=/DATA/AppData/searxng
[[ -f "$SEARXNG_PLUGIN_TGZ" ]] || fail "Missing vendored SearXNG plugin: $SEARXNG_PLUGIN_TGZ"
if ! orb -m "$MACHINE" -u root docker image inspect "$SEARXNG_IMAGE_TAG" >/dev/null 2>&1; then
  docker --context orbstack pull --platform linux/arm64 "$SEARXNG_UPSTREAM_IMAGE" >/dev/null
  docker --context orbstack tag "$SEARXNG_UPSTREAM_IMAGE" "$SEARXNG_IMAGE_TAG"
  docker --context orbstack save "$SEARXNG_IMAGE_TAG" | orb -m "$MACHINE" -u root docker load >/dev/null
fi
orb -m "$MACHINE" -u root bash -lc "install -d -m 0755 '$SEARXNG_DATA_DIR' '$SEARXNG_APP_DIR'; [ -f '$SEARXNG_DATA_DIR/searxng.env' ] || { umask 077; echo SEARXNG_SECRET=\$(openssl rand -hex 32) > '$SEARXNG_DATA_DIR/searxng.env'; }; chmod 600 '$SEARXNG_DATA_DIR/searxng.env'"
orb -m "$MACHINE" -u root bash -lc "cat > '$SEARXNG_DATA_DIR/settings.yml'; chmod 644 '$SEARXNG_DATA_DIR/settings.yml'" < "$SEARXNG_SRC_DIR/settings.yml"
orb -m "$MACHINE" -u root bash -lc "cat > '$SEARXNG_APP_DIR/docker-compose.yml'" < "$SEARXNG_SRC_DIR/docker-compose.example.yml"
orb -m "$MACHINE" -u root bash -lc "cd '$SEARXNG_APP_DIR' && docker compose up -d --no-build" >/dev/null
for _ in $(seq 1 30); do
  [[ "$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Health.Status}}' searxng 2>/dev/null)" == healthy ]] && break
  sleep 2
done
[[ "$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Health.Status}}' searxng 2>/dev/null)" == healthy ]] || fail 'SearXNG container is not healthy'
printf '%s\n' 'SEARXNG=healthy'
orb -m "$MACHINE" -u root python3 - "$OPENCLAW_DATA_DIR/config/openclaw.json" <<'PY'
import json, os, sys, time
from pathlib import Path
path = Path(sys.argv[1])
config = json.loads(path.read_text())
changed = False
tools = config.setdefault("tools", {})
web = tools.setdefault("web", {})
search = web.setdefault("search", {})
if search.get("provider") != "searxng":
    search["provider"] = "searxng"
    changed = True
search.setdefault("maxResults", 5)
search.setdefault("timeoutSeconds", 30)
plugins = config.setdefault("plugins", {})
allow = plugins.setdefault("allow", [])
for name in ("openai", "browser", "searxng"):
    if name not in allow:
        allow.append(name)
        changed = True
entries = plugins.setdefault("entries", {})
searx = entries.setdefault("searxng", {})
if searx.get("enabled") is not True:
    searx["enabled"] = True
    changed = True
web_search = searx.setdefault("config", {}).setdefault("webSearch", {})
if web_search.get("baseUrl") != "http://searxng:8080":
    web_search["baseUrl"] = "http://searxng:8080"
    changed = True
entries.setdefault("openai", {}).setdefault("enabled", True)
entries.setdefault("browser", {}).setdefault("enabled", True)
if changed:
    stamp = time.strftime("%Y%m%d%H%M%S")
    backup = path.with_name(path.name + f".bak-websearch-{stamp}")
    backup.write_bytes(path.read_bytes())
    os.chmod(backup, 0o600)
    tmp = path.with_name(path.name + ".tmp-websearch")
    tmp.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    os.chmod(tmp, 0o600)
    os.chown(tmp, 1000, 1000)
    os.replace(tmp, path)
    os.chown(path, 1000, 1000)
    print("WEB_SEARCH_CONFIG=repaired")
else:
    print("WEB_SEARCH_CONFIG=present")
PY
orb -m "$MACHINE" -u root bash -lc 'install -d -o 1000 -g 1000 -m 0755 /DATA/AppData/openclaw/config/tmp'
orb -m "$MACHINE" -u root bash -lc 'cat > /DATA/AppData/openclaw/config/tmp/searxng.tgz' < "$SEARXNG_PLUGIN_TGZ"
orb -m "$MACHINE" -u root bash -lc 'chown 1000:1000 /DATA/AppData/openclaw/config/tmp/searxng.tgz; chmod 0644 /DATA/AppData/openclaw/config/tmp/searxng.tgz'
if ! orb -m "$MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/config/extensions/searxng/openclaw.plugin.json"; then
  if orb -m "$MACHINE" -u root docker inspect openclaw >/dev/null 2>&1; then
    orb -m "$MACHINE" -u root docker cp /DATA/AppData/openclaw/config/tmp/searxng.tgz openclaw:/tmp/searxng.tgz
    orb -m "$MACHINE" -u root docker exec -u node openclaw node /app/openclaw.mjs plugins install /tmp/searxng.tgz --accept-capabilities --acknowledge-install-policy-warning --force >/dev/null
  else
    orb -m "$MACHINE" -u root bash -lc "cd '$OPENCLAW_APP_DIR' && docker compose run --rm --no-deps --user 1000:1000 --entrypoint node openclaw /app/openclaw.mjs plugins install /home/node/.openclaw/tmp/searxng.tgz --accept-capabilities --acknowledge-install-policy-warning --force" >/dev/null
  fi
  orb -m "$MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/config/extensions/searxng/openclaw.plugin.json" || fail 'SearXNG web_search plugin failed to install'
  printf '%s\n' 'WEB_SEARCH_PLUGIN=installed'
else
  printf '%s\n' 'WEB_SEARCH_PLUGIN=present'
fi

deploy_stage openclaw-cli-preflight
# Rebuild the pinned host's persisted plugin index from the candidate image
# after a consistent state SQLite backup, but before any plugin/Skill preflight
# or container switch. A stale index can omit a healthy Amadeus bundle.
orb -m "$MACHINE" -u root bash -lc "cd '$OPENCLAW_APP_DIR' && docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js plugins registry --refresh --json > '$CHECKPOINT_DIR/plugin-registry-refresh.json' && chmod 600 '$CHECKPOINT_DIR/plugin-registry-refresh.json'"
orb -m "$MACHINE" -u root python3 - "$CHECKPOINT_DIR/plugin-registry-refresh.json" <<'PY'
import json,sys
from pathlib import Path
result=json.loads(Path(sys.argv[1]).read_text())
registry=result.get('registry') or {}
if result.get('refreshed') is not True or result.get('state') != 'fresh': raise SystemExit('plugin_registry_refresh_failed')
if not any(row.get('pluginId') == 'amadeus' for row in registry.get('plugins', [])): raise SystemExit('amadeus_missing_from_refreshed_registry')
if any(row.get('pluginId') == 'amadeus' for row in registry.get('diagnostics', [])): raise SystemExit('amadeus_registry_diagnostic_remains')
print('PLUGIN_REGISTRY_REFRESH=passed')
PY

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
for name in ['amadeus_product_radar','amadeus_media_organize','amadeus_nas','amadeus_homelab_status','amadeus_kook_group_members','amadeus_market_overview','amadeus_market_quote','amadeus_market_intraday','amadeus_market_session','amadeus_market_movers','amadeus_market_constituents','amadeus_macos_host_status','amadeus_macos_host_processes','amadeus_image_upscale','identity_resolve','identity_get_person','identity_bind_channel','identity_add_alias','identity_link_account','identity_list_candidates','identity_confirm_candidate','amadeus_notify_owner','amadeus_vps_service_info','amadeus_vps_live_status','amadeus_vps_usage','amadeus_vps_system_status','amadeus_vps_services','amadeus_vps_traffic_fuse','amadeus_vps_report']:
    if name not in amadeus: raise SystemExit('Amadeus preflight missing ' + name)
for name in ['pubg','amadeus','voice-reply','market','macos-host','image-upscale','vps']:
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
if config.get('tools', {}).get('deny') != ['tts', 'message']:
    raise SystemExit('agent-facing TTS and generic message tools must be denied; typed delivery owns speech')
tts = config.get('tts', {})
if tts.get('auto') != 'off' or tts.get('modelOverrides', {}).get('enabled') is not False:
    raise SystemExit('generic automatic TTS must be off; typed delivery owns synthesis')
if 'allow' in config.get('tools', {}):
    raise SystemExit('strict tools.allow list would hide future native tools')
if 'amadeus' not in config.get('plugins', {}).get('allow', []):
    raise SystemExit('Amadeus plugin is not in the OpenClaw plugin allowlist')
if 'searxng' not in config.get('plugins', {}).get('allow', []):
    raise SystemExit('searxng web_search provider plugin is not in the OpenClaw plugin allowlist')
if (config.get('tools', {}).get('web') or {}).get('search', {}).get('provider') != 'searxng':
    raise SystemExit('tools.web.search.provider must be searxng for Lab realtime web_search')
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
if config.get('agents', {}).get('defaults', {}).get('mediaModels', {}).get('image', {}).get('primary') != 'openai/amadeus-image':
    raise SystemExit('OpenClaw must use the logical amadeus-image capability')
expected_group_tools = ['web_search', 'web_fetch', 'image_generate', 'pubg_resolve_players', 'pubg_search_matches', 'pubg_query_stats', 'pubg_compare_stats', 'pubg_get_match', 'pubg_get_review_facts', 'pubg_get_period_review', 'pubg_query_team_damage', 'pubg_prefetch_telemetry', 'pubg_telemetry_sync_report', 'amadeus_macos_host_status', 'amadeus_macos_host_processes']
for channel in ('whatsapp', 'telegram'):
    channel_config = config.get('channels', {}).get(channel, {})
    scopes = [channel_config.get('groups', {})]
    scopes.extend(a['groups'] for a in channel_config.get('accounts', {}).values() if isinstance(a, dict) and 'groups' in a)
    for groups in scopes:
        if not isinstance(groups, dict):
            raise SystemExit('channel group map must be an object')
        for group in groups.values():
            if not isinstance(group, dict) or group.get('tools') != {'allow': expected_group_tools}:
                raise SystemExit('group capability policy must expose web/image plus the full read-only PUBG tool family')
            if channel == 'whatsapp' and group.get('toolsBySender', {}).get('e164:' + owner_phone, {}).get('allow') != ['*']:
                raise SystemExit('WhatsApp owner group tool profile must remain full')
            if channel == 'telegram' and group.get('toolsBySender'):
                raise SystemExit('Telegram group sender policy unexpectedly widened')
print('OWNER_TOOL_POLICY=full')
print('GROUP_CAPABILITY_TOOL_POLICY=scoped')
print('DM_SESSION_SCOPE=per-account-channel-peer')
PY

deploy_stage switch
if ((OPENCLAW_ONLY)); then
  orb -m "$MACHINE" -u root bash -lc "cd '$OPENCLAW_APP_DIR' && docker compose up -d --no-build --no-deps openclaw >/dev/null"
else
  orb -m "$MACHINE" -u root docker compose --project-directory "$RADAR_APP_DIR" -f "$RADAR_COMPOSE_FILE" up -d --no-build product-radar >/dev/null
  orb -m "$MACHINE" -u root bash -lc "cd '$OPENCLAW_APP_DIR' && docker compose up -d --no-build >/dev/null && docker compose restart openclaw >/dev/null"
  # The pinned WhatsApp module is volume-installed. A same-image compose up can
  # leave the Node process running with the old media agent; restart loads it.
fi

deploy_stage health
for attempt in $(seq 1 40); do
  if orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 3 http://127.0.0.1:18789/healthz >/dev/null 2>&1; then
    if ((AUTO_RELEASE || CANDIDATE)); then
      container_health="$(orb -m "$MACHINE" -u root docker inspect openclaw --format '{{.State.Health.Status}}' 2>/dev/null || true)"
      [[ "$container_health" == healthy ]] && break
    else
      break
    fi
  fi
  sleep 2
done
orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18789/healthz >/dev/null
if ((AUTO_RELEASE || CANDIDATE)); then
  container_health="$(orb -m "$MACHINE" -u root docker inspect openclaw --format '{{.State.Health.Status}}')"
  [[ "$container_health" == healthy ]] || fail "OpenClaw container health is $container_health after automatic Lab deploy."
  printf '%s\n' 'OPENCLAW_CONTAINER_HEALTH=healthy'
fi
# The switched container must load a module carrying every template hook.
verify_whatsapp_boundary_live
deploy_stage smoke
# Every apply path (the OpenClaw-only automatic release and the full Lab deploy) must end with the archive mounted from
# the configured host directory. A container recreated without it silently archives into an empty root-owned directory
# and every prefetch then fails with telemetry_archive_owner_invalid while the cron job still reports ok.
"$ROOT_DIR/scripts/check-openclaw-archive-mount.sh" --machine "$MACHINE" --expect "$PUBG_TELEMETRY_ARCHIVE_HOST_DIR" \
  || fail 'PUBG telemetry archive mount is not the configured host directory or is not usable by the OpenClaw node user; restore the protected checkpoint.'
printf 'PUBG_TELEMETRY_ARCHIVE_MOUNT=passed\n'
runtime_amadeus_version="$(orb -m "$MACHINE" -u root docker exec openclaw cat /opt/amadeus/VERSION | tr -d '[:space:]')"
[[ "$runtime_amadeus_version" == "$AMADEUS_VERSION" ]] || fail "Running OpenClaw reports Amadeus VERSION=$runtime_amadeus_version, expected $AMADEUS_VERSION."
printf 'RUNTIME_AMADEUS_VERSION=%s\n' "$runtime_amadeus_version"
started_at="$(orb -m "$MACHINE" -u root docker inspect openclaw --format '{{.State.StartedAt}}')"
registration_count="$(orb -m "$MACHINE" -u root docker logs --since "$started_at" openclaw 2>&1 | grep -F -c 'amadeus native capability plugin registered' || true)"
[[ "$registration_count" =~ ^[0-9]+$ && "$registration_count" -ge 1 ]] || fail 'Amadeus plugin did not register in the live Gateway; restore the protected checkpoint.'
printf 'AMADEUS_GATEWAY_REGISTRATION=passed\n'
if ((OPENCLAW_ONLY == 0)); then orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 5 http://127.0.0.1:5315/health >/dev/null; fi
if ((OPENCLAW_ONLY == 0 && MEDIA_ADAPTER_PRESENT)); then
  orb -m "$MACHINE" -u root docker exec openclaw sh -lc 'node -e "fetch(\"http://media-organizer-adapter:8765/healthz\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"' >/dev/null
elif ((OPENCLAW_ONLY == 0)); then
  printf '%s\n' 'MEDIA_ADAPTER_NETWORK=skipped_missing_service'
fi
if ((OPENCLAW_ONLY == 0)); then orb -m "$MACHINE" -u root docker exec openclaw sh -lc "ssh -i /run/secrets/mac_ssh_key -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null '$MAC_CONTROL_USER@$MAC_CONTROL_HOST' nas.status" >/dev/null; fi
# WhatsApp reconnects a few seconds after the switch; poll (up to ~60s) before
# the strict linked/running/connected check below instead of one snapshot.
for attempt in $(seq 1 12); do
  orb -m "$MACHINE" -u root bash -lc "docker exec openclaw node dist/index.js channels status --json > '$CHECKPOINT_DIR/channels-status.json'"
  orb -m "$MACHINE" -u root python3 -c "import json,sys; w=json.load(open(sys.argv[1])).get('channels',{}).get('whatsapp',{}); sys.exit(0 if all(w.get(k) is True for k in ('linked','running','connected')) else 1)" "$CHECKPOINT_DIR/channels-status.json" && break
  sleep 5
done
if ((AUTO_RELEASE || CANDIDATE)); then
  orb -m "$MACHINE" -u root python3 - "$CHECKPOINT_DIR/channels-status.json" <<'PY'
import json, sys
from pathlib import Path
channels = json.loads(Path(sys.argv[1]).read_text()).get('channels', {})
whatsapp = channels.get('whatsapp', {})
if not all(whatsapp.get(key) is True for key in ('linked', 'running', 'connected')):
    raise SystemExit('WhatsApp is not linked, running and connected after automatic Lab deploy')
print('WHATSAPP_HEALTH=linked,running,connected')
PY
  smoke_key="lab-release-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)-$STAMP"
  python3 - "$MACHINE" "$smoke_key" "$ROOT_DIR/scripts" <<'PY'
import json, subprocess, sys
sys.path.insert(0, sys.argv[3])
from lab_auto_release_contract import valid_pubg_stats_smoke
prompt = ('Use the native pubg_query_stats tool with team=true, selector={"type":"last_n_matches","count":5}, '
          'metrics=["matches","kills","damage"], and refresh=false. Do not guess or use memory. '
          'If the tool returns ok or partial, reply LAB_STATS_QUERY_OK. Otherwise reply '
          'LAB_STATS_QUERY_FAILED. Do not include player names, identifiers, or statistics in the reply.')
# The model occasionally picks a different selector (e.g. no_matches) even
# though the tool works; one fresh-session retry separates that from a real
# regression, which fails both attempts.
for attempt in (1, 2):
    try:
        response = subprocess.run(
            ['orb', '-m', sys.argv[1], '-u', 'root', 'docker', 'exec', 'openclaw', 'node', 'dist/index.js',
             'agent', '--agent', 'main', '--session-key', 'agent:main:' + sys.argv[2] + ('' if attempt == 1 else '-retry'), '--message', prompt,
             '--json', '--timeout', '180'], capture_output=True, text=True, check=False, timeout=200)
    except subprocess.TimeoutExpired as exc:
        if attempt == 2: raise SystemExit('PUBG stats query timed out; automatic rollback will restore the prior image') from exc
        print('PUBG_STATS_QUERY=retry reason=timeout'); continue
    try:
        payload = json.loads(response.stdout)
    except json.JSONDecodeError as exc:
        if attempt == 2: raise SystemExit('PUBG stats query returned invalid structured output; automatic rollback will restore the prior image') from exc
        print('PUBG_STATS_QUERY=retry reason=invalid_output'); continue
    if response.returncode == 0 and valid_pubg_stats_smoke(payload):
        break
    if attempt == 2: raise SystemExit('PUBG stats query was not verified; automatic rollback will restore the prior image')
    print('PUBG_STATS_QUERY=retry reason=not_verified')
print('PUBG_STATS_QUERY=passed')
PY
fi

ensure_cron() {
  local name="$1" expression="$2" message="$3" tools="$4" timezone="${5:-Asia/Shanghai}"
  local matching_ids existing_id
  matching_ids="$(orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron list --all --json \
    | python3 -c 'import json,sys; n=sys.argv[1]; v=json.load(sys.stdin); ids=[str(x.get("id")) for x in v.get("jobs",[]) if x.get("name")==n and x.get("id")]; len(ids)>1 and sys.exit("duplicate cron names"); print(ids[0] if ids else "")' "$name")"
  if [[ -z "$matching_ids" ]]; then
    orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron add \
      --name "$name" --cron "$expression" --tz "$timezone" --session isolated --agent main \
      --message "$message" --no-deliver --tools "$tools" --exact \
      --declaration-key "amadeus-$name-v1" --json >/dev/null
  else
    existing_id="$matching_ids"
    orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron edit "$existing_id" \
      --cron "$expression" --tz "$timezone" --session isolated --agent main \
      --message "$message" --no-deliver --tools "$tools" --exact --json >/dev/null
  fi
}
edit_existing_cron() {
  local name="$1" expression="$2" message="$3" tools="$4" timezone="${5:-Asia/Shanghai}"
  local matching_ids existing_id
  matching_ids="$(orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron list --all --json \
    | python3 -c 'import json,sys; n=sys.argv[1]; v=json.load(sys.stdin); ids=[str(x.get("id")) for x in v.get("jobs",[]) if x.get("name")==n and x.get("id")]; len(ids)!=1 and sys.exit("expected exactly one existing cron job"); print(ids[0])' "$name")"
  [[ -n "$matching_ids" ]] || fail "Expected existing OpenClaw cron job named '$name'; refusing to create a replacement."
  existing_id="$matching_ids"
  orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron edit "$existing_id" \
    --cron "$expression" --tz "$timezone" --session isolated --agent main \
    --message "$message" --no-deliver --tools "$tools" --exact --json >/dev/null
}
verify_cron() {
  local name="$1" expression="$2" timezone="${3:-Asia/Shanghai}"
  orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron list --all --json \
    | python3 -c '
import json,sys
name, expression, timezone = sys.argv[1:]
jobs = json.load(sys.stdin).get("jobs", [])
matches = [job for job in jobs if job.get("name") == name]
if len(matches) != 1:
    raise SystemExit(f"expected exactly one {name} job; found {len(matches)}")
job = matches[0]
schedule = job.get("schedule") or {}
delivery = job.get("delivery") or {}
if job.get("enabled") is not True or schedule.get("kind") != "cron" or schedule.get("expr") != expression or schedule.get("tz") != timezone:
    raise SystemExit(f"{name} schedule or enabled state does not match the deployment target")
if delivery.get("mode") != "none":
    raise SystemExit(f"{name} must use the existing owner outbox instead of cron direct delivery")
print("CRON_TARGET=passed")
' "$name" "$expression" "$timezone"
}
remove_cron() {
  local name="$1" existing_id
  existing_id="$(orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron list --all --json \
    | python3 -c 'import json,sys; n=sys.argv[1]; v=json.load(sys.stdin); print(next((x.get("id", "") for x in v.get("jobs",[]) if x.get("name")==n), ""))' "$name")"
  if [[ -n "$existing_id" ]]; then
    orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron rm "$existing_id" --json >/dev/null
  fi
}
if ((OPENCLAW_ONLY == 0)); then
remove_cron amadeus-briefing-morning
remove_cron amadeus-briefing-evening
edit_existing_cron amadeus-vps-morning '30 9 * * *' '调用 amadeus_vps_report，参数 notifyOwner=true、reportPeriod=morning。VPS 晨间报告的版式、单位与数据判断全部由该工具固定生成并投递到 WhatsApp owner outbox，不要自行改写或另行调用其他 VPS 工具；手动或补跑由工具自动使用独立 manual key，不得占用正式 key。' 'amadeus_vps_report'
edit_existing_cron amadeus-vps-evening '30 21 * * *' '调用 amadeus_vps_report，参数 notifyOwner=true、reportPeriod=evening。VPS 晚间报告的版式、单位与数据判断全部由该工具固定生成并投递到 WhatsApp owner outbox，不要自行改写或另行调用其他 VPS 工具；手动或补跑由工具自动使用独立 manual key，不得占用正式 key。' 'amadeus_vps_report'
verify_cron amadeus-vps-morning '30 9 * * *' Asia/Shanghai
verify_cron amadeus-vps-evening '30 21 * * *' Asia/Shanghai

ensure_cron amadeus-mac-host-morning '30 9 * * *' '调用 amadeus_homelab_status，参数 notifyOwner=true、reportPeriod=morning。报告必须以 MacHostAgent 的真实 M204 macOS host 数据为准，包含当前 CPU 与当天 avg/p95/max/maxAt、Memory Pressure、Swap、功耗、Macintosh HD、Avalon 容量/挂载、异常、关键服务和独立 OpenWrt 状态；host telemetry unavailable 必须明确保留。使用正式 eventKey=mac-host-report:当天日期:morning，source=mac-host-report，固定 WhatsApp owner outbox/delivery；手动或补跑使用独立 manual key，不得发送到 Telegram、KOOK 或群聊。' 'amadeus_homelab_status'
ensure_cron amadeus-mac-host-evening '0 23 * * *' '调用 amadeus_homelab_status，参数 notifyOwner=true、reportPeriod=evening。报告必须以 MacHostAgent 的真实 M204 macOS host 数据为准，包含当日历史聚合、Memory Pressure、Swap、功耗、Macintosh HD、Avalon 容量/挂载、异常、关键服务和独立 OpenWrt 状态；unknown/unavailable 不得写成健康。使用正式 eventKey=mac-host-report:当天日期:evening，source=mac-host-report，固定 WhatsApp owner outbox/delivery；手动或补跑使用独立 manual key，不得发送到 Telegram、KOOK 或群聊。' 'amadeus_homelab_status'
ensure_cron amadeus-pubg-telemetry-hourly '5 * * * *' '只调用 pubg_prefetch_telemetry，参数 team=true、maxMatches=500、maxFetches=20、concurrency=2。该任务每小时刷新所有配置 PUBG 玩家最新对局，只获取本地不存在的新 Match API 详情，再为新对局或到期重试对局获取 Telemetry 并写入持久化缓存；严格保留工具返回的 status、cacheStatus、availability、dataUpdatedAt 和计数，不要把 status=FETCHED/cacheStatus=MISS/availability=AVAILABLE 说成数据缺失；不要调用其他工具、不要发送通知，定时任务使用 no-deliver。' 'pubg_prefetch_telemetry'
ensure_cron amadeus-pubg-sync-daily '0 0 * * *' '调用 pubg_telemetry_sync_report，参数 team=true。报告统计上一自然日；仅当 status/data 有效时把 data.notification 这个完整的 owner_notification 结构化对象原样传给 amadeus_notify_owner，保留 theme、significance、eventType、eventKey、source、headline、facts、summary、dataUpdatedAt、occurredAt 和 worldLineClosing，不得改写事实。' 'pubg_telemetry_sync_report amadeus_notify_owner'
ensure_cron amadeus-market-open '30 9 * * 1-5' '调用 amadeus_market_overview（phase=open）与 amadeus_market_session；由 Longbridge trading day/session 事实判断是否为有效开盘检查，不能把固定时钟当作市场真相。有效时把 overview.notification 的完整结构化对象原样传给 amadeus_notify_owner；非交易日、休市、OAuth reauth 或 provider unavailable 时直接结束，不得改写行情或数据时间。' 'amadeus_market_overview amadeus_market_session amadeus_notify_owner' 'America/New_York'
ensure_cron amadeus-market-close '0 16 * * 1-5' '调用 amadeus_market_overview（phase=close）与 amadeus_market_session；由 Longbridge trading day/session 事实判断是否为有效收盘检查，不能把固定时钟当作市场真相。有效时把 overview.notification 的完整结构化对象原样传给 amadeus_notify_owner；非交易日、休市、OAuth reauth 或 provider unavailable 时直接结束，不得改写行情或数据时间。' 'amadeus_market_overview amadeus_market_session amadeus_notify_owner' 'America/New_York'
orb -m "$MACHINE" -u root bash -lc "docker exec openclaw node dist/index.js cron list --json > '$CHECKPOINT_DIR/cron-list.json'"
fi

if ((OPENCLAW_ONLY == 0)); then
HOOK_PATH="$CODEX_NOTIFY_HOOK_PATH"
HOOK_BACKUP_DIR="$CODEX_NOTIFY_BACKUP_ROOT/$CHECKPOINT_ID"
mkdir -p "$HOOK_BACKUP_DIR"
mkdir -p "$(dirname -- "$HOOK_PATH")"
if [[ -f "$HOOK_PATH" ]]; then cp -p "$HOOK_PATH" "$HOOK_BACKUP_DIR/codex-notify.before.sh"; fi
install -m 755 "$ROOT_DIR/integrations/openclaw/codex-notify.sh" "$HOOK_PATH"
fi

if ((CANDIDATE)); then
  ACCEPTANCE_KEY="amadeus-candidate-deploy:$CHECKPOINT_ID"
  DEPLOYMENT_SUMMARY="候选 OpenClaw 运行时已部署到当前 CasaOS 主机 ${MACHINE}，等待真实验收；此通知不是版本发布。来源提交 ${COMMIT}，checkpoint ${CHECKPOINT_ID}。"
  NOTIFICATION_SOURCE='amadeus-candidate-deploy'
  NOTIFICATION_HEADLINE="Amadeus 候选运行时 · ${CHECKPOINT_ID}"
  NOTIFICATION_SEVERITY='warning'
  NOTIFICATION_SIGNIFICANCE='major'
  NOTIFICATION_THEME='worldline_observation'
else
  ACCEPTANCE_KEY="amadeus-release:$AMADEUS_VERSION"
  DEPLOYMENT_SUMMARY="${RELEASE_NOTES}

已部署到 Amadeus M204 & Lab 世界线"
  NOTIFICATION_SOURCE='amadeus-release'
  NOTIFICATION_HEADLINE="Amadeus $AMADEUS_VERSION · 世界线收束"
  NOTIFICATION_SEVERITY='success'
  NOTIFICATION_SIGNIFICANCE='major'
  NOTIFICATION_THEME='worldline_convergence'
fi
deploy_stage owner-notify
for owner_outbox in "$CHECKPOINT_DIR/owner-smoke" "$OPENCLAW_DATA_DIR/notifications"; do
  "$ROOT_DIR/scripts/notify-owner.sh" \
    --remote-machine "$MACHINE" \
    --outbox-dir "$owner_outbox" \
    --event-key "$ACCEPTANCE_KEY" \
    --source "$NOTIFICATION_SOURCE" \
    --headline "$NOTIFICATION_HEADLINE" \
    --summary "$DEPLOYMENT_SUMMARY" \
    --severity "$NOTIFICATION_SEVERITY" \
    --significance "$NOTIFICATION_SIGNIFICANCE" \
    --theme "$NOTIFICATION_THEME" \
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
[[ "$owner_notification_status" == sent ]] || fail 'Owner deployment notification remained pending after 30 seconds.'

deploy_stage post-deploy
if ((AUTO_RELEASE || CANDIDATE)); then
  POST_DEPLOY_EVIDENCE_DIR="$HOME/.local/state/amadeus/lab-auto-release/evidence/$CHECKPOINT_ID"
else
  POST_DEPLOY_EVIDENCE_DIR="$SKULD_BACKUP_ROOT/deploy/$CHECKPOINT_ID"
  [[ "$POST_DEPLOY_EVIDENCE_DIR" == "$EXTERNAL_STORAGE_ROOT/"* ]] || fail 'post-deploy evidence must be stored on the verified external volume.'
fi
mkdir -p "$POST_DEPLOY_EVIDENCE_DIR"
chmod 700 "$POST_DEPLOY_EVIDENCE_DIR"
if ((CANDIDATE || AUTO_RELEASE)); then
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

deploy_stage done
printf 'CHECKPOINT=%s\n' "$CHECKPOINT_DIR"
printf 'POST_DEPLOY_EVIDENCE=%s\n' "$POST_DEPLOY_EVIDENCE_DIR"
printf 'OPENCLAW_IMAGE=%s\n' "$IMAGE"
printf 'PRODUCT_RADAR_IMAGE=%s\n' "$RADAR_IMAGE"
printf '%s\n' 'OPENCLAW_HEALTH=passed'
if ((OPENCLAW_ONLY == 0)); then printf '%s\n' 'PRODUCT_RADAR_HEALTH=passed'; else printf '%s\n' 'PRODUCT_RADAR=untouched'; fi
if ((MEDIA_ADAPTER_PRESENT)); then printf '%s\n' 'MEDIA_ADAPTER_NETWORK=passed'; fi
if ((OPENCLAW_ONLY == 0)); then printf '%s\n' 'NAS_SSH_READONLY_SMOKE=passed'; fi
printf '%s\n' "OWNER_NOTIFICATION=$owner_notification_status"
printf 'OWNER_OUTBOX_SMOKE=%s\n' passed
printf '%s\n' "LOG_POLICY=$log_policy_status"
printf '%s\n' "POST_DEPLOY_MAINTENANCE=$post_deploy_maintenance"
printf '%s\n' "AMADEUS_NETWORK=$AMADEUS_NETWORK_NAME"
if ((CANDIDATE)); then
  printf '%s\n' "Lab candidate $AMADEUS_VERSION@$SOURCE_REVISION live-verified; formal tag deferred until Arthur approval."
elif ((AUTO_RELEASE)); then
  printf '%s\n' "Lab $AMADEUS_VERSION formal deployment passed its live health checks."
else
  printf '%s\n' "Amadeus $AMADEUS_VERSION migration completed."
fi
