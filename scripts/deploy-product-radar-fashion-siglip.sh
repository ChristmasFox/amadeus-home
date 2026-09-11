#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="ubuntu"
COMPOSE_DIR="/var/lib/casaos/apps/product-radar"
COMPOSE_TEMPLATE="$ROOT_DIR/infra/docker/casaos/product-radar/docker-compose.example.yml"
APPLY=0
BUILD=0
PRODUCT_IMAGE=""
FASHION_IMAGE=""

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy-product-radar-fashion-siglip.sh [--dry-run] [--apply] [--build]
      [--machine <name>] [--compose-dir <path>]

Default is a dry-run. RELEASE deployment requires --apply --build and will:
run Product Radar checks, scan secrets, build both commit-tagged images, transfer
them to Ubuntu, back up CasaOS compose/.env, activate hybrid matching with Sharp
fallback, recreate with `docker compose up -d --no-build`, and verify both health
endpoints plus FashionSigLIP readiness.
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
    --build) BUILD=1 ;;
    --machine)
      (($# >= 2)) || fail '--machine requires a value.'
      MACHINE="$2"
      shift
      ;;
    --compose-dir)
      (($# >= 2)) || fail '--compose-dir requires a value.'
      COMPOSE_DIR="$2"
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

if ((BUILD)); then
  commit_tag="git-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
  PRODUCT_IMAGE="local/product-radar:$commit_tag"
  FASHION_IMAGE="local/product-radar-fashion-siglip:$commit_tag"
fi

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'BUILD=%s\n' "$([[ $BUILD -eq 1 ]] && printf explicit || printf disabled)"
printf 'PRODUCT_IMAGE=%s\n' "${PRODUCT_IMAGE:-unchanged-compose-image}"
printf 'FASHION_IMAGE=%s\n' "${FASHION_IMAGE:-unchanged-compose-image}"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'COMPOSE_DIR=%s\n' "$COMPOSE_DIR"
printf '%s\n' 'COMPOSE_COMMAND=docker compose up -d --no-build'

if ((APPLY == 0)); then
  if ((BUILD)); then
    printf '%s\n' 'PLAN=explicit RELEASE would run tests, secret scan, two BuildKit builds, image transfer, CasaOS backup/config activation, --no-build recreate, health and FashionSigLIP readiness checks.'
  else
    printf '%s\n' 'PLAN=no image build; an explicit --apply --build is required for this model release.'
  fi
  exit 0
fi

((BUILD)) || fail 'FashionSigLIP deployment requires explicit --build so the model and Node adapter stay on one immutable commit tag.'
[[ -f "$COMPOSE_TEMPLATE" ]] || fail "Compose template not found: $COMPOSE_TEMPLATE"

git -C "$ROOT_DIR" diff --check
git -C "$ROOT_DIR" diff --quiet || fail 'Refusing RELEASE build with unstaged/uncommitted worktree changes.'
git -C "$ROOT_DIR" diff --cached --quiet || fail 'Refusing RELEASE build with staged-but-uncommitted changes.'

(
  cd "$ROOT_DIR"
  pnpm --filter @agent/product-radar typecheck
  pnpm --filter @agent/product-radar test
  pnpm check:secrets
)

docker buildx build --load --progress=plain \
  --build-arg HTTP_PROXY= \
  --build-arg HTTPS_PROXY= \
  --build-arg ALL_PROXY= \
  --build-arg NO_PROXY= \
  --file "$ROOT_DIR/apps/fashion-siglip/Dockerfile" \
  --tag "$FASHION_IMAGE" \
  "$ROOT_DIR/apps/fashion-siglip"

docker buildx build --load --progress=plain \
  --file "$ROOT_DIR/apps/product-radar/Dockerfile" \
  --tag "$PRODUCT_IMAGE" \
  "$ROOT_DIR/apps/product-radar"

docker save "$PRODUCT_IMAGE" "$FASHION_IMAGE" | orb -m "$MACHINE" -u root docker load

template_content="$(<"$COMPOSE_TEMPLATE")"
remote_compose_file="$COMPOSE_DIR/docker-compose.yml"
remote_product_image="$PRODUCT_IMAGE"
remote_fashion_image="$FASHION_IMAGE"

# The template is sent over stdin/argv; no credential or .env value is copied
# from the Mac. The remote script keeps timestamped backups before activation.
orb -m "$MACHINE" -u root python3 - "$remote_compose_file" "$remote_product_image" "$remote_fashion_image" "$template_content" <<'PY'
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

compose_file = Path(sys.argv[1])
product_image = sys.argv[2]
fashion_image = sys.argv[3]
template = sys.argv[4]
if not compose_file.exists():
    raise SystemExit(f"compose file not found: {compose_file}")
old = compose_file.read_text()
required = ("services:", "product-radar:", "changedetection:", "langbot_network:")
if any(marker not in old for marker in required):
    raise SystemExit("refusing to replace an unexpected Product Radar compose file")
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
compose_backup = compose_file.with_name(compose_file.name + f".codex-backup.{stamp}")
shutil.copy2(compose_file, compose_backup)
compose_file.write_text(template)

env_file = compose_file.with_name(".env")
if not env_file.exists():
    raise SystemExit(f"external env file not found: {env_file}")
env_backup = env_file.with_name(env_file.name + f".codex-backup.{stamp}")
shutil.copy2(env_file, env_backup)
env_text = env_file.read_text()

def set_env(text: str, name: str, value: str) -> str:
    line = f"{name}={value}"
    pattern = re.compile(rf"^{re.escape(name)}=.*$", re.MULTILINE)
    return pattern.sub(line, text, count=1) if pattern.search(text) else text.rstrip("\n") + "\n" + line + "\n"

env_text = set_env(env_text, "PRODUCT_RADAR_IMAGE", product_image)
env_text = set_env(env_text, "FASHION_SIGLIP_IMAGE", fashion_image)
env_text = set_env(env_text, "PRODUCT_RADAR_IMAGE_MATCHER_PROVIDER", "hybrid")
env_file.write_text(env_text)
print(f"ROLLBACK_COMPOSE={compose_backup}")
print(f"ROLLBACK_ENV={env_backup}")
PY

orb -m "$MACHINE" -u root bash -lc "
  set -euo pipefail
  cd $(printf '%q' "$COMPOSE_DIR")
  docker compose config >/dev/null
  docker image inspect $(printf '%q' "$PRODUCT_IMAGE") >/dev/null
  docker image inspect $(printf '%q' "$FASHION_IMAGE") >/dev/null
  docker compose up -d --no-build
  for _ in \$(seq 1 30); do
    if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:5315/health >/dev/null 2>&1; then break; fi
    sleep 2
  done
  curl --fail --silent --show-error --max-time 5 http://127.0.0.1:5315/health
  fashion_status=''
  for _ in \$(seq 1 180); do
    fashion_status=\$(docker inspect --format '{{.State.Health.Status}}' product-radar-fashion-siglip 2>/dev/null || true)
    if [ "\$fashion_status" = healthy ]; then break; fi
    if [ "\$fashion_status" = unhealthy ] || [ "\$fashion_status" = exited ]; then
      docker logs --tail 60 product-radar-fashion-siglip >&2 || true
      exit 1
    fi
    sleep 5
  done
  test "\$fashion_status" = healthy
  docker exec product-radar node -e 'fetch("http://fashion-siglip:8000/health").then(async r=>{if(!r.ok)process.exit(1); console.log(await r.text())}).catch(()=>process.exit(1))'
  docker ps --filter name=product-radar --format '{{.Names}} {{.Image}} {{.Status}}'
"

printf '%s\n' 'FashionSigLIP deployment checks passed. Keep the printed remote compose/.env backups for rollback; old Watch references continue through Sharp fallback, while newly prepared references use FashionSigLIP when the sidecar is healthy.'
