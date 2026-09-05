#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="ubuntu"
APP="pubg-query-engine-v3"
COMPOSE_DIR="/var/lib/casaos/apps/pubg-query-engine-v3"
IMAGE=""
APPLY=0
BUILD=0
CLEAR_PROXY=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy-agent-runtime.sh [--dry-run] [--apply] [--build] [--image <tag>]
      [--machine <name>] [--compose-dir <path>] [--no-proxy]

Default is a dry-run and never builds an image. --apply always recreates CasaOS with
`docker compose up -d --no-build`. --build is explicit RELEASE behavior: it runs the
release checks, builds a commit-tagged image with host BuildKit, transfers it to Ubuntu,
then updates the CasaOS compose image and recreates with --no-build.
USAGE
}

fail() {
  printf '%s\n' "$*" >&2
  exit 2
}

quote_remote() {
  printf '%q' "$1"
}

while (($#)); do
  case "$1" in
    --dry-run)
      APPLY=0
      ;;
    --apply)
      APPLY=1
      ;;
    --build)
      BUILD=1
      ;;
    --image)
      (($# >= 2)) || fail '--image requires a tag.'
      IMAGE="$2"
      shift
      ;;
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
    --no-proxy)
      CLEAR_PROXY=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
  shift
done

if ((BUILD)) && [[ -z "$IMAGE" ]]; then
  IMAGE="local/pubg-query-engine-v3:git-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
fi

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'BUILD=%s\n' "$([[ $BUILD -eq 1 ]] && printf explicit || printf disabled)"
printf 'IMAGE=%s\n' "${IMAGE:-unchanged-compose-image}"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'COMPOSE_DIR=%s\n' "$COMPOSE_DIR"
printf '%s\n' 'COMPOSE_COMMAND=docker compose up -d --no-build'

if ((APPLY == 0)); then
  if ((BUILD)); then
    printf '%s\n' 'PLAN=explicit RELEASE would run tests, secret scan, BuildKit build, image transfer, compose image update, --no-build recreate, health and smoke checks.'
  else
    printf '%s\n' 'PLAN=no image build; an explicit --apply would only use the selected/existing image with --no-build.'
  fi
  exit 0
fi

if ((BUILD)); then
  git -C "$ROOT_DIR" diff --check
  git -C "$ROOT_DIR" diff --quiet || fail 'Refusing RELEASE build with unstaged/uncommitted worktree changes.'
  git -C "$ROOT_DIR" diff --cached --quiet || fail 'Refusing RELEASE build with staged-but-uncommitted changes.'

  (
    cd "$ROOT_DIR"
    pnpm test
    pnpm check:secrets
  )

  build_command=(
    docker buildx build
    --load
    --progress=plain
    --file "$ROOT_DIR/apps/agent-runtime/Dockerfile"
    --tag "$IMAGE"
    "$ROOT_DIR"
  )
  if ((CLEAR_PROXY)); then
    build_command=(
      docker buildx build
      --load
      --progress=plain
      --build-arg HTTP_PROXY=
      --build-arg HTTPS_PROXY=
      --build-arg ALL_PROXY=
      --build-arg NO_PROXY=
      --file "$ROOT_DIR/apps/agent-runtime/Dockerfile"
      --tag "$IMAGE"
      "$ROOT_DIR"
    )
  fi
  "${build_command[@]}"

  docker save "$IMAGE" | orb -m "$MACHINE" -u root docker load
fi

remote_compose_dir="$(quote_remote "$COMPOSE_DIR")"
remote_image="$(quote_remote "$IMAGE")"
orb -m "$MACHINE" -u root bash -lc "
  set -euo pipefail
  compose_dir=${remote_compose_dir}
  image=${remote_image}
  compose_file=\"\$compose_dir/docker-compose.yml\"
  test -f \"\$compose_file\"

  if [ -n \"\$image\" ]; then
    docker image inspect \"\$image\" >/dev/null
    image_count=\$(grep -c '^[[:space:]]*image:' \"\$compose_file\" || true)
    if [ \"\$image_count\" -ne 1 ]; then
      echo \"Refusing to update \$compose_file: expected exactly one image line, found \$image_count.\" >&2
      exit 1
    fi
    backup=\"\${compose_file}.codex-backup.\$(date +%Y%m%d-%H%M%S)\"
    cp -p \"\$compose_file\" \"\$backup\"
    sed -i -E \"s|^([[:space:]]*image:[[:space:]]*).*|\\1\$image|\" \"\$compose_file\"
    echo \"ROLLBACK_COMPOSE=\$backup\"
  fi

  cd \"\$compose_dir\"
  docker compose config >/dev/null
  docker compose up -d --no-build

  for _ in \$(seq 1 30); do
    if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:5310/healthz >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  curl --fail --silent --show-error --max-time 5 http://127.0.0.1:5310/healthz >/dev/null
  curl --fail --silent --show-error --max-time 5 http://127.0.0.1:5310/homehub/health >/dev/null
  docker ps --filter name=${APP} --format '{{.Names}} {{.Image}} {{.Status}}'
"

printf '%s\n' 'Deployment checks passed. Record the image tag, remote compose backup path, health/smoke result, and rollback instruction in the required repository checkpoint.'
