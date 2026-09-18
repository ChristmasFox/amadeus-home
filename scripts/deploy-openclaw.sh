#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MACHINE="ubuntu"
OPENCLAW_APP_DIR="/var/lib/casaos/apps/openclaw"
OPENCLAW_DATA_DIR="/DATA/AppData/openclaw"
RADAR_APP_DIR="/var/lib/casaos/apps/product-radar"
LANGBOT_APP_DIR="/var/lib/casaos/apps/langbot"
N8N_APP_DIR="/var/lib/casaos/apps/n8n"
N8N_SANDBOX_APP_DIR="/var/lib/casaos/apps/n8n-sandbox"
LANGBOT_DATA_DIR="/DATA/AppData/langbot"
N8N_DATA_DIR="/DATA/AppData/n8n"
N8N_SANDBOX_DATA_DIR="/DATA/AppData/n8n-sandbox"
IMAGE=""
RADAR_IMAGE=""
APPLY=0
BUILD=0
BUILD_OPENCLAW=0
BUILD_RADAR=0
AUTO_BUILD=0
NO_BUILD=0
FULL_VERIFY=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy-openclaw.sh --dry-run
  ./scripts/deploy-openclaw.sh --apply --build
  ./scripts/deploy-openclaw.sh --apply --build-auto
  ./scripts/deploy-openclaw.sh --apply --build-openclaw
  ./scripts/deploy-openclaw.sh --apply --build-radar
  ./scripts/deploy-openclaw.sh --apply --no-build
  ./scripts/deploy-openclaw.sh --apply --image <openclaw-image> --radar-image <radar-image>

Default is a dry-run. --build performs a full two-image release. --build-auto
compares the current Git tree with the live image commit and builds only affected
images. --build-openclaw and --build-radar build one image. --no-build reuses
the live images for workspace/compose/config-only updates and rejects stale
images when plugin or service source changed.
USAGE
}

fail() { printf '%s\n' "$*" >&2; exit 2; }
base64_file() { base64 < "$1" | tr -d '\n'; }
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
    plugins/pubg/*|plugins/amadeus/*|packages/pubg-domain/*|infra/docker/casaos/openclaw/Dockerfile|scripts/patch-openclaw-channel-identity.mjs|.dockerignore|package.json|pnpm-lock.yaml|pnpm-workspace.yaml) return 0 ;;
    *) return 1 ;;
  esac
}
is_radar_image_path() {
  case "$1" in
    apps/product-radar/*) return 0 ;;
    *) return 1 ;;
  esac
}
image_needs_rebuild() {
  local image="$1" target="$2" source_commit path
  source_commit="$(image_source_commit "$image")" || fail "$target image tag must contain a git commit and timestamp: $image"
  git -C "$ROOT_DIR" cat-file -e "$source_commit^{commit}" 2>/dev/null || fail "Image source commit is not available locally: $source_commit"
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

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --build) BUILD=1; BUILD_OPENCLAW=1; BUILD_RADAR=1 ;;
    --build-auto) AUTO_BUILD=1 ;;
    --build-openclaw) BUILD_OPENCLAW=1 ;;
    --build-radar) BUILD_RADAR=1 ;;
    --no-build) NO_BUILD=1 ;;
    --full-verify) FULL_VERIFY=1 ;;
    --image) (($# >= 2)) || fail '--image requires a value.'; IMAGE="$2"; shift ;;
    --radar-image) (($# >= 2)) || fail '--radar-image requires a value.'; RADAR_IMAGE="$2"; shift ;;
    --machine) (($# >= 2)) || fail '--machine requires a value.'; MACHINE="$2"; shift ;;
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
printf 'OPENCLAW_IMAGE=%s\n' "$shown_image"
printf 'PRODUCT_RADAR_IMAGE=%s\n' "$shown_radar_image"
printf 'MACHINE=%s\n' "$MACHINE"

if ((APPLY == 0)); then
  printf '%s\n' 'PLAN=on apply, reuse live images by default; --build-auto rebuilds only affected images; --build remains the explicit full two-image migration path.'
  exit 0
fi

[[ -n "$IMAGE" && -n "$RADAR_IMAGE" ]] || fail 'Apply requires resolvable OpenClaw and Product Radar images.'
git -C "$ROOT_DIR" diff --check
git -C "$ROOT_DIR" diff --quiet || fail 'Refusing apply with unstaged changes; commit reviewed source first.'
git -C "$ROOT_DIR" diff --cached --quiet || fail 'Refusing apply with staged-but-uncommitted changes.'

if ((BUILD_OPENCLAW == 0)); then assert_image_fresh "$IMAGE" openclaw; fi
if ((BUILD_RADAR == 0)); then assert_image_fresh "$RADAR_IMAGE" radar; fi

(
  cd "$ROOT_DIR"
  if [[ -f /Users/blacksidev/.nvm/nvm.sh ]]; then
    source /Users/blacksidev/.nvm/nvm.sh
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
      bash -n scripts/deploy-openclaw.sh integrations/openclaw/codex-notify.sh scripts/notify-owner.sh scripts/provision-vps-readonly.sh
      sh -n infra/vps/amadeus-vps-readonly-probe.sh
      python3 -m py_compile scripts/openclaw_prepare.py
    fi
  fi
  node --check scripts/patch-openclaw-channel-identity.mjs
  pnpm check:secrets
)

if ((BUILD_OPENCLAW)); then
  docker buildx build --platform linux/arm64 --load --progress=plain --file "$ROOT_DIR/infra/docker/casaos/openclaw/Dockerfile" --tag "$IMAGE" "$ROOT_DIR"
  docker --context orbstack save "$IMAGE" | orb -m "$MACHINE" -u root docker load
else
  orb -m "$MACHINE" -u root docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "OpenClaw image not found: $IMAGE"
fi
if ((BUILD_RADAR)); then
  docker buildx build --platform linux/arm64 --load --progress=plain --file "$ROOT_DIR/apps/product-radar/Dockerfile" --tag "$RADAR_IMAGE" "$ROOT_DIR/apps/product-radar"
  docker --context orbstack save "$RADAR_IMAGE" | orb -m "$MACHINE" -u root docker load
else
  orb -m "$MACHINE" -u root docker image inspect "$RADAR_IMAGE" >/dev/null 2>&1 || fail "Product Radar image not found: $RADAR_IMAGE"
fi

CHECKPOINT_ID="amadeus-openclaw-$STAMP"
CHECKPOINT_DIR="$OPENCLAW_DATA_DIR/backups/$CHECKPOINT_ID"
OPENCLAW_COMPOSE_FILE="$OPENCLAW_APP_DIR/docker-compose.yml"
RADAR_COMPOSE_FILE="$RADAR_APP_DIR/docker-compose.yml"
RADAR_ENV_FILE="$RADAR_APP_DIR/.env"
PREPARE="$ROOT_DIR/scripts/openclaw_prepare.py"
PATCH_RUNTIME="$ROOT_DIR/scripts/patch-openclaw-channel-identity.mjs"
for source in \
  "$ROOT_DIR/infra/docker/casaos/openclaw/docker-compose.example.yml" \
  "$ROOT_DIR/infra/docker/casaos/product-radar/docker-compose.example.yml" \
  "$ROOT_DIR/integrations/openclaw/openclaw.json.example" \
  "$ROOT_DIR/packages/pubg-domain/config/default-team.json" \
  "$ROOT_DIR/integrations/openclaw/workspace/AGENTS.md" \
  "$ROOT_DIR/integrations/openclaw/workspace/SOUL.md" \
  "$ROOT_DIR/integrations/openclaw/workspace/USER.md" \
  "$ROOT_DIR/integrations/openclaw/workspace/MEMORY.md" "$PREPARE" "$PATCH_RUNTIME"; do
  [[ -f "$source" ]] || fail "Missing deployment source: $source"
done

OPENCLAW_COMPOSE_B64="$(base64_file "$ROOT_DIR/infra/docker/casaos/openclaw/docker-compose.example.yml")"
RADAR_COMPOSE_B64="$(base64_file "$ROOT_DIR/infra/docker/casaos/product-radar/docker-compose.example.yml")"
CONFIG_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/openclaw.json.example")"
TEAM_B64="$(base64_file "$ROOT_DIR/packages/pubg-domain/config/default-team.json")"
AGENTS_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace/AGENTS.md")"
SOUL_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace/SOUL.md")"
USER_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace/USER.md")"
MEMORY_B64="$(base64_file "$ROOT_DIR/integrations/openclaw/workspace/MEMORY.md")"

orb -m "$MACHINE" -u root python3 - \
  "$CHECKPOINT_DIR" \
  "$OPENCLAW_COMPOSE_FILE" openclaw-compose.before.yml \
  "$RADAR_COMPOSE_FILE" product-radar-compose.before.yml \
  "$RADAR_ENV_FILE" product-radar.env.before \
  "$LANGBOT_APP_DIR" langbot-app.before \
  "$N8N_APP_DIR" n8n-app.before \
  "$N8N_SANDBOX_APP_DIR" n8n-sandbox-app.before \
  /var/lib/casaos/apps/media-organizer-adapter/docker-compose.yml media-organizer-compose.before.yml \
  "$OPENCLAW_DATA_DIR/config/openclaw.json" openclaw-config.before.json \
  "$OPENCLAW_DATA_DIR/openclaw.env" openclaw.env.before \
  "$OPENCLAW_DATA_DIR/secrets" openclaw-secrets.before \
  "$OPENCLAW_DATA_DIR/data/pubg.sqlite" pubg.sqlite.before \
  "$OPENCLAW_DATA_DIR/data/vps-usage-state.json" vps-usage-state.json.before \
  "$OPENCLAW_DATA_DIR/workspace" openclaw-workspace.before <<'PY'
import json, shutil, subprocess, sys
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
for name in ['openclaw','product-radar','media-organizer-adapter','langbot','langbot_plugin_runtime','n8n','n8n-sandbox-api','n8n-sandbox-runner-1']:
    try: containers[name] = subprocess.check_output(['docker','inspect','--format','{{.State.Status}}',name], text=True).strip()
    except subprocess.CalledProcessError: containers[name] = 'absent'
(checkpoint / 'checkpoint.json').write_text(json.dumps({
    'createdAt': datetime.now(timezone.utc).isoformat(),
    'checkpointId': checkpoint.name,
    'containersBeforeSwitch': containers,
    'note': 'External checkpoint; contains runtime secrets/data needed for recovery.'
}, ensure_ascii=False, indent=2) + '\n')
print('CHECKPOINT=' + str(checkpoint))
PY

orb -m "$MACHINE" -u root python3 - \
  "$OPENCLAW_DATA_DIR" "$CONFIG_B64" "$TEAM_B64" "$AGENTS_B64" "$SOUL_B64" "$USER_B64" "$MEMORY_B64" < "$PREPARE"

orb -m "$MACHINE" -u root docker exec -i openclaw node - \
  --whatsapp-root /home/node/.openclaw/npm/projects < "$PATCH_RUNTIME"

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

orb -m "$MACHINE" -u root docker network inspect langbot_langbot_network >/dev/null 2>&1 || orb -m "$MACHINE" -u root docker network create langbot_langbot_network >/dev/null
orb -m "$MACHINE" -u root docker network inspect 9router_default >/dev/null 2>&1 || fail '9router_default network is unavailable.'
orb -m "$MACHINE" -u root docker compose --project-directory "$RADAR_APP_DIR" -f "$RADAR_COMPOSE_FILE" config >/dev/null
orb -m "$MACHINE" -u root bash -lc "cd '$OPENCLAW_APP_DIR' && docker compose config >/dev/null && docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js config validate --json > '$CHECKPOINT_DIR/config-validate.json' && docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js plugins inspect pubg --runtime --json > '$CHECKPOINT_DIR/plugin-pubg-preflight.json' && docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js plugins inspect amadeus --runtime --json > '$CHECKPOINT_DIR/plugin-amadeus-preflight.json' && docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js skills list --json > '$CHECKPOINT_DIR/skills-preflight.json'"

orb -m "$MACHINE" -u root python3 - \
  "$CHECKPOINT_DIR/plugin-pubg-preflight.json" "$CHECKPOINT_DIR/plugin-amadeus-preflight.json" "$CHECKPOINT_DIR/skills-preflight.json" <<'PY'
import json, sys
from pathlib import Path
pubg = json.dumps(json.loads(Path(sys.argv[1]).read_text()), ensure_ascii=False)
amadeus = json.dumps(json.loads(Path(sys.argv[2]).read_text()), ensure_ascii=False)
skills = json.dumps(json.loads(Path(sys.argv[3]).read_text()), ensure_ascii=False)
for name in ['pubg_resolve_players','pubg_search_matches','pubg_query_stats','pubg_compare_stats','pubg_get_match','pubg_get_review_facts']:
    if name not in pubg: raise SystemExit('PUBG preflight missing ' + name)
for name in ['amadeus_product_radar','amadeus_media_organize','amadeus_nas','amadeus_homelab_status','amadeus_kook_group_members','identity_resolve','identity_get_person','identity_bind_channel','identity_add_alias','identity_link_account','identity_list_candidates','identity_confirm_candidate','amadeus_notify_owner','amadeus_vps_service_info','amadeus_vps_live_status','amadeus_vps_usage','amadeus_vps_system_status','amadeus_vps_services']:
    if name not in amadeus: raise SystemExit('Amadeus preflight missing ' + name)
for name in ['pubg','amadeus','vps']:
    if '"name": "' + name + '"' not in skills: raise SystemExit('bundled Skill missing ' + name)
print('OPENCLAW_PREFLIGHT=passed')
PY

orb -m "$MACHINE" -u root python3 - "$OPENCLAW_DATA_DIR/config/openclaw.json" <<'PY'
import json, sys
from pathlib import Path
config = json.loads(Path(sys.argv[1]).read_text())
if config.get('tools', {}).get('profile') != 'full':
    raise SystemExit('owner tool policy is not tools.profile=full')
if 'allow' in config.get('tools', {}):
    raise SystemExit('strict tools.allow list would hide future native tools')
if 'amadeus' not in config.get('plugins', {}).get('allow', []):
    raise SystemExit('Amadeus plugin is not in the OpenClaw plugin allowlist')
owner_targets = config.get('commands', {}).get('ownerAllowFrom', [])
if len(owner_targets) != 1 or not str(owner_targets[0]).startswith('whatsapp:+'):
    raise SystemExit('exactly one WhatsApp owner identity is required')
owner_phone = str(owner_targets[0]).split(':', 1)[1]
whatsapp = config.get('channels', {}).get('whatsapp', {})
if whatsapp.get('dmPolicy') != 'allowlist' or owner_phone not in whatsapp.get('allowFrom', []):
    raise SystemExit('WhatsApp DM allowlist is not restricted to the owner identity')
wildcard_group = whatsapp.get('groups', {}).get('*', {})
if 'tools' in wildcard_group or 'toolsBySender' in wildcard_group:
    raise SystemExit('WhatsApp group tool policy must inherit the full agent profile')
print('OWNER_TOOL_POLICY=full')
PY

for old_compose in "$N8N_SANDBOX_APP_DIR/docker-compose.yml" "$N8N_APP_DIR/docker-compose.yml" "$LANGBOT_APP_DIR/docker-compose.yml"; do
  if orb -m "$MACHINE" -u root test -f "$old_compose" >/dev/null 2>&1; then
    orb -m "$MACHINE" -u root docker compose -f "$old_compose" down --remove-orphans >/dev/null
  fi
done

orb -m "$MACHINE" -u root python3 - "$CHECKPOINT_DIR/retired-apps" "$CHECKPOINT_DIR/retired-data" \
  "$LANGBOT_APP_DIR" "$N8N_APP_DIR" "$N8N_SANDBOX_APP_DIR" \
  "$LANGBOT_DATA_DIR" "$N8N_DATA_DIR" "$N8N_SANDBOX_DATA_DIR" <<'PY'
import shutil, sys
from pathlib import Path
apps, data = Path(sys.argv[1]), Path(sys.argv[2])
apps.mkdir(parents=True, exist_ok=True); data.mkdir(parents=True, exist_ok=True)
for raw in sys.argv[3:6]:
    source = Path(raw)
    if source.exists(): shutil.move(str(source), str(apps / source.name))
for raw in sys.argv[6:]:
    source = Path(raw)
    if source.exists(): shutil.move(str(source), str(data / source.name))
print('LEGACY_APP_PATHS=retired')
print('LEGACY_APPDATA=retired')
PY

orb -m "$MACHINE" -u root docker compose --project-directory "$RADAR_APP_DIR" -f "$RADAR_COMPOSE_FILE" up -d --no-build product-radar >/dev/null
orb -m "$MACHINE" -u root bash -lc "cd '$OPENCLAW_APP_DIR' && docker compose up -d --no-build >/dev/null"

for attempt in $(seq 1 40); do
  if orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 3 http://127.0.0.1:18789/healthz >/dev/null 2>&1; then break; fi
  sleep 2
done
orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18789/healthz >/dev/null
orb -m "$MACHINE" -u root curl --fail --silent --show-error --max-time 5 http://127.0.0.1:5315/health >/dev/null
orb -m "$MACHINE" -u root docker exec openclaw sh -lc 'node -e "fetch(\"http://media-organizer-adapter:8765/healthz\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"' >/dev/null
orb -m "$MACHINE" -u root docker exec openclaw sh -lc 'ssh -i /run/secrets/mac_ssh_key -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null blacksidev@host.docker.internal nas.status' >/dev/null
orb -m "$MACHINE" -u root bash -lc "docker exec openclaw node dist/index.js channels status --json > '$CHECKPOINT_DIR/channels-status.json'"

ensure_cron() {
  local name="$1" expression="$2" message="$3" tools="$4"
  local existing_id
  existing_id="$(orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron list --json \
    | python3 -c 'import json,sys; n=sys.argv[1]; v=json.load(sys.stdin); print(next((x.get("id", "") for x in v.get("jobs",[]) if x.get("name")==n), ""))' "$name")"
  if [[ -z "$existing_id" ]]; then
    orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron add \
      --name "$name" --cron "$expression" --tz Asia/Shanghai --session isolated --agent main \
      --message "$message" --no-deliver --tools "$tools" --exact \
      --declaration-key "amadeus-$name-v1" --json >/dev/null
  else
    orb -m "$MACHINE" -u root docker exec openclaw node dist/index.js cron edit "$existing_id" \
      --cron "$expression" --tz Asia/Shanghai --session isolated --agent main \
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
ensure_cron amadeus-vps-morning '30 9 * * *' '调用 amadeus_vps_live_status、amadeus_vps_usage、amadeus_vps_system_status、amadeus_vps_services；根据返回事实生成简洁中文 VPS 晨间状态报告，流量段必须单独输出一行恰好十个 █/░ 字符加 usedPercent（按 floor(usedPercent/10) 计算，低于 1% 也不能省略，例如 ░░░░░░░░░░ 0.9%），突出 offline/API error/SSH unreachable/critical service inactive/disk high/traffic low/CPU throttling 和 unknown，不得把 unknown 当健康；然后调用 amadeus_notify_owner，eventKey 使用 vps-report:当天日期:morning，source=vps-report，title=🛰 VPS 晨间状态，message 为完整报告。只发送 WhatsApp owner DM，不要 cron fallback delivery。' 'amadeus_vps_live_status amadeus_vps_usage amadeus_vps_system_status amadeus_vps_services amadeus_notify_owner'
ensure_cron amadeus-vps-evening '0 23 * * *' '调用 amadeus_vps_live_status、amadeus_vps_usage、amadeus_vps_system_status、amadeus_vps_services；根据返回事实生成简洁中文 VPS 晚间状态报告，流量段必须单独输出一行恰好十个 █/░ 字符加 usedPercent（按 floor(usedPercent/10) 计算，低于 1% 也不能省略，例如 ░░░░░░░░░░ 0.9%），突出 offline/API error/SSH unreachable/critical service inactive/disk high/traffic low/CPU throttling 和 unknown，不得把 unknown 当健康；然后调用 amadeus_notify_owner，eventKey 使用 vps-report:当天日期:evening，source=vps-report，title=🛰 VPS 晚间状态，message 为完整报告。只发送 WhatsApp owner DM，不要 cron fallback delivery。' 'amadeus_vps_live_status amadeus_vps_usage amadeus_vps_system_status amadeus_vps_services amadeus_notify_owner'
orb -m "$MACHINE" -u root bash -lc "docker exec openclaw node dist/index.js cron list --json > '$CHECKPOINT_DIR/cron-list.json'"

HOOK_PATH="/Users/blacksidev/.codex/bin/codex-notify.sh"
HOOK_BACKUP_DIR="/Users/blacksidev/.codex/backups/$CHECKPOINT_ID"
mkdir -p "$HOOK_BACKUP_DIR"
if [[ -f "$HOOK_PATH" ]]; then cp -p "$HOOK_PATH" "$HOOK_BACKUP_DIR/codex-notify.before.sh"; fi
install -m 755 "$ROOT_DIR/integrations/openclaw/codex-notify.sh" "$HOOK_PATH"

ACCEPTANCE_KEY="amadeus-owner-smoke:$CHECKPOINT_ID"
orb -m "$MACHINE" -u root python3 - "$OPENCLAW_DATA_DIR/notifications" "$ACCEPTANCE_KEY" <<'PY'
import hashlib, json, os, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
directory = Path(sys.argv[1])
event = {'version':1,'eventKey':sys.argv[2],'source':'amadeus-release','title':'Amadeus 迁移验收','message':'OpenClaw 原生 owner 通知 outbox 已开始经 WhatsApp owner DM 验证。','occurredAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z')}
directory.mkdir(parents=True, exist_ok=True); os.chmod(directory, 0o700); os.chown(directory, 1000, 1000)
event_id = hashlib.sha256(event['eventKey'].encode()).hexdigest()[:40]
pending, sent = directory / (event_id + '.pending.json'), directory / (event_id + '.sent.json')
if not pending.exists() and not sent.exists():
    fd, temporary = tempfile.mkstemp(prefix='.' + event_id + '.', suffix='.tmp', dir=directory)
    os.fchmod(fd, 0o600); os.chown(temporary, 1000, 1000)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle: json.dump(event, handle, ensure_ascii=False); handle.write('\n')
    os.replace(temporary, pending)
print('OWNER_SMOKE=queued')
PY

owner_smoke_id="$(printf '%s' "$ACCEPTANCE_KEY" | shasum -a 256 | cut -c1-40)"
for attempt in $(seq 1 12); do
  if orb -m "$MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/notifications/$owner_smoke_id.sent.json" >/dev/null 2>&1; then break; fi
  sleep 5
done
orb -m "$MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/notifications/$owner_smoke_id.sent.json" || fail 'WhatsApp owner outbox smoke did not reach sent state.'

if orb -m "$MACHINE" -u root docker ps -a --format '{{.Names}}' | grep -E '^(langbot|langbot_plugin_runtime|n8n|n8n-sandbox-api|n8n-sandbox-runner-1|n8n-sandbox-tls-init)$' >/dev/null 2>&1; then
  fail 'A retired LangBot/n8n container still exists.'
fi
for retired_path in "$LANGBOT_APP_DIR" "$N8N_APP_DIR" "$N8N_SANDBOX_APP_DIR" "$LANGBOT_DATA_DIR" "$N8N_DATA_DIR" "$N8N_SANDBOX_DATA_DIR"; do
  orb -m "$MACHINE" -u root test ! -e "$retired_path" || fail "Retired path still exists: $retired_path"
done

printf 'CHECKPOINT=%s\n' "$CHECKPOINT_DIR"
printf 'OPENCLAW_IMAGE=%s\n' "$IMAGE"
printf 'PRODUCT_RADAR_IMAGE=%s\n' "$RADAR_IMAGE"
printf '%s\n' 'OPENCLAW_HEALTH=passed'
printf '%s\n' 'PRODUCT_RADAR_HEALTH=passed'
printf '%s\n' 'MEDIA_ADAPTER_NETWORK=passed'
printf '%s\n' 'NAS_SSH_READONLY_SMOKE=passed'
printf '%s\n' 'OWNER_WHATSAPP_OUTBOX_SMOKE=passed'
printf '%s\n' 'LEGACY_RUNTIME=retired'
printf '%s\n' 'Amadeus OpenClaw migration completed.'
