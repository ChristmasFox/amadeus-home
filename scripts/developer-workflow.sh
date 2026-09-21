#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE=plan
BASE_REF=HEAD
CHECK_SECRETS=0
FILES=()

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/developer-workflow.sh [--plan|--run] [--base <git-ref>] [--check-secrets]
  ./scripts/developer-workflow.sh --files <path> [<path> ...]

The default input is the current diff plus untracked, non-ignored files.
--run executes only local checks; it never builds a Docker image or changes CasaOS.
USAGE
}

fail() { printf '%s\n' "$*" >&2; exit 2; }

while (($#)); do
  case "$1" in
    --plan) MODE=plan ;;
    --run) MODE=run ;;
    --base) (($# >= 2)) || fail '--base requires a git ref.'; BASE_REF="$2"; shift ;;
    --check-secrets) CHECK_SECRETS=1 ;;
    --files) shift; (($# > 0)) || fail '--files requires at least one path.'; FILES=("$@"); break ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

if ((${#FILES[@]} == 0)); then
  while IFS= read -r path; do
    [[ -n "$path" ]] && FILES+=("$path")
  done < <({
    if [[ "$BASE_REF" == HEAD ]]; then
      git diff --name-only --diff-filter=ACMR HEAD
    else
      git diff --name-only --diff-filter=ACMR "${BASE_REF}...HEAD"
      git diff --name-only --diff-filter=ACMR HEAD
    fi
    git ls-files --others --exclude-standard
  } | awk 'NF && !seen[$0]++' | LC_ALL=C sort)
fi

is_env_path() {
  case "$1" in .env|.env.*|*/.env|*/.env.*|*.env|*.env.*) return 0 ;; *) return 1 ;; esac
}

has_pubg=0
has_identity=0
has_amadeus=0
has_presentation=0
has_product=0
has_package_meta=0
has_openclaw_deploy=0
has_storage=0
has_skuld_docs=0
has_backup=0
has_fast=0
env_count=0
unknown=()

for path in "${FILES[@]-}"; do
  [[ -n "$path" ]] || continue
  if is_env_path "$path"; then env_count=$((env_count + 1)); continue; fi
  case "$path" in
    packages/pubg-domain/*|plugins/pubg/*) has_pubg=1 ;;
    packages/presentation/*) has_presentation=1 ;;
    packages/identity/*) has_identity=1 ;;
    plugins/amadeus/*) has_amadeus=1 ;;
    apps/product-radar/src/*|apps/product-radar/tests/*|apps/product-radar/scripts/*|apps/product-radar/tsconfig.json) has_product=1 ;;
    infra/docker/casaos/openclaw/*|integrations/openclaw/*|scripts/deploy-openclaw.sh)
      has_openclaw_deploy=1
      [[ "$path" == */Dockerfile || "$path" == Dockerfile* ]] && has_package_meta=1
      ;;
    scripts/storage-*|scripts/backup.sh|scripts/service-aware-backup.sh|scripts/sqlite-consistent-snapshot.py|scripts/reclaim-immich-old-source.sh|scripts/migrate-immich-media.sh|scripts/secrets-inventory.sh|scripts/export-skuld-secrets.sh|scripts/import-skuld-secrets.sh|scripts/test-*skuld*|scripts/test-storage-*)
      has_storage=1
      [[ "$path" == *backup* || "$path" == *secret* ]] && has_backup=1
      ;;
    docs/OPERATION_SKULD_*|docs/SERVICE_AWARE_BACKUP_REGISTRY.json|docs/VALIDATION_MATRIX.md)
      has_skuld_docs=1
      ;;
    package.json|pnpm-lock.yaml|pnpm-workspace.yaml|.dockerignore|*/Dockerfile|Dockerfile|Dockerfile.*|*/Dockerfile.*) has_package_meta=1 ;;
    docs/*|.agent/*|README.md|AGENTS.md|VERSION|RELEASE_NOTES.md|scripts/check-architecture.mjs|scripts/test-check-architecture.mjs|scripts/developer-workflow.sh|scripts/test-developer-workflow.sh|scripts/notify-owner.sh|*.md|*/tests/*|*/test/*|*.test.ts|*.spec.ts) has_fast=1 ;;
    *) unknown+=("$path") ;;
  esac
done

env_only=0
if ((${#FILES[@]} > 0 && env_count == ${#FILES[@]})); then env_only=1; fi

LEVEL=FAST
WORKFLOW=FAST
DOCKER_BUILD=forbidden
COMPOSE_MODE=none
if ((env_only)); then
  LEVEL=RELEASE; WORKFLOW=ENV_RECREATE_NO_BUILD
  COMPOSE_MODE='explicit --apply: docker compose up -d --no-build'
elif ((has_package_meta)); then
  LEVEL=RELEASE; WORKFLOW=RELEASE_BUILD_REQUIRED
  DOCKER_BUILD='required only in explicit RELEASE'
  COMPOSE_MODE='explicit --apply: docker compose up -d --no-build after image transfer'
elif ((has_openclaw_deploy)); then
  LEVEL=RELEASE; WORKFLOW=OPENCLAW_RELEASE_CONFIG
  COMPOSE_MODE='explicit --apply: scripts/deploy-openclaw.sh --apply --build-auto|--no-build'
elif ((has_storage || has_backup)); then
  LEVEL=FAST; WORKFLOW=STORAGE_RUNTIME
  COMPOSE_MODE='none'
elif ((has_skuld_docs)); then
  LEVEL=FAST; WORKFLOW=SKULD_CONSISTENCY
  COMPOSE_MODE='none'
elif ((has_pubg || has_identity || has_amadeus)); then
  LEVEL=RUNTIME; WORKFLOW=PUBG_DOMAIN_PLUGIN
  if ((has_identity || has_amadeus)) && ((has_pubg == 0)); then WORKFLOW=AMADEUS_IDENTITY; fi
elif ((has_presentation)); then
  LEVEL=RUNTIME; WORKFLOW=PRESENTATION
elif ((has_product)); then
  LEVEL=RUNTIME; WORKFLOW=PRODUCT_RADAR
fi

printf 'CHANGE_SCOPE_LEVEL=%s\n' "$LEVEL"
printf 'CHANGE_SCOPE_WORKFLOW=%s\n' "$WORKFLOW"
printf 'DOCKER_BUILD=%s\n' "$DOCKER_BUILD"
printf 'COMPOSE_MODE=%s\n' "$COMPOSE_MODE"
DOCKER_IMAGE_SET=none
if ((has_package_meta)); then DOCKER_IMAGE_SET=both; fi
if ((has_pubg || has_identity || has_amadeus || has_openclaw_deploy)); then DOCKER_IMAGE_SET=openclaw; fi
if ((has_product)); then if [[ "$DOCKER_IMAGE_SET" == openclaw ]]; then DOCKER_IMAGE_SET=both; else DOCKER_IMAGE_SET=product-radar; fi; fi
if ((has_presentation)); then DOCKER_IMAGE_SET=both; fi
printf 'DOCKER_IMAGE_SET=%s\n' "$DOCKER_IMAGE_SET"
printf 'CHANGED_PATHS=%s\n' "${#FILES[@]}"
for path in "${FILES[@]-}"; do printf 'PATH=%s\n' "$path"; done
if ((${#unknown[@]})); then printf 'UNKNOWN_PATHS=%s\n' "${unknown[*]}"; fi

case "$WORKFLOW" in
  FAST) printf '%s\n' 'VERIFY=targeted local tests, affected typecheck, git diff --check; Docker/Compose/deploy are prohibited by default.' ;;
  PUBG_DOMAIN_PLUGIN) printf '%s\n' 'VERIFY=pnpm typecheck:pubg, pnpm test:pubg, git diff --check; deployment remains explicit.' ;;
  AMADEUS_IDENTITY) printf '%s\n' 'VERIFY=pnpm typecheck:amadeus, pnpm test:amadeus, git diff --check; deployment remains explicit.' ;;
  PRESENTATION) printf '%s\n' 'VERIFY=presentation typecheck/tests, pnpm check:architecture, git diff --check; deployment remains explicit.' ;;
  PRODUCT_RADAR) printf '%s\n' 'VERIFY=Product Radar typecheck/tests, git diff --check; deployment remains explicit.' ;;
  STORAGE_RUNTIME) printf '%s\n' 'VERIFY=bash -n changed shell, pnpm test:storage-runtime, migration/readiness fixtures; no package-wide tests.' ;;
  SKULD_CONSISTENCY) printf '%s\n' 'VERIFY=JSON parse, pnpm test:skuld-consistency, git diff --check; no Docker/Compose/deploy.' ;;
  RELEASE_BUILD_REQUIRED) printf '%s\n' 'VERIFY=tests -> secrets -> immutable image build -> CasaOS compose --no-build -> health/smoke.' ;;
  OPENCLAW_RELEASE_CONFIG) printf '%s\n' 'VERIFY=explicit OpenClaw apply with migration/checkpoint and docker compose up -d --no-build.' ;;
  ENV_RECREATE_NO_BUILD) printf '%s\n' 'VERIFY=explicit environment/config apply with docker compose up -d --no-build.' ;;
esac

if [[ "$MODE" != run ]]; then exit 0; fi
printf '+ git diff --check\n'
git diff --check
printf '+ pnpm check:architecture\n'
pnpm check:architecture
if ((has_storage || has_backup)); then
  printf '+ pnpm test:storage-runtime\n'; pnpm test:storage-runtime
  printf '+ pnpm test:migration-readiness\n'; pnpm test:migration-readiness
  printf '+ pnpm test:service-aware-backup\n'; pnpm test:service-aware-backup
fi
if ((has_skuld_docs)); then
  printf '+ pnpm test:skuld-consistency\n'; pnpm test:skuld-consistency
fi
if ((has_pubg)); then
  printf '+ pnpm typecheck:pubg\n'; pnpm typecheck:pubg
  printf '+ pnpm test:pubg\n'; pnpm test:pubg
fi
if ((has_identity || has_amadeus)); then
  printf '+ pnpm typecheck:amadeus\n'; pnpm typecheck:amadeus
  printf '+ pnpm test:amadeus\n'; pnpm test:amadeus
fi
if ((has_presentation)); then
  printf '+ pnpm --filter @agent/presentation typecheck\n'; pnpm --filter @agent/presentation typecheck
  printf '+ pnpm --filter @agent/presentation test\n'; pnpm --filter @agent/presentation test
fi
if ((has_product)); then
  printf '+ pnpm typecheck:product-radar\n'; pnpm typecheck:product-radar
  printf '+ pnpm test:product-radar\n'; pnpm test:product-radar
fi
if ((CHECK_SECRETS)); then
  printf '+ pnpm check:secrets\n'; pnpm check:secrets
fi
