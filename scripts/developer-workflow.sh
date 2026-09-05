#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="plan"
BASE_REF="HEAD"
CHECK_SECRETS=0
FILES=()

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/developer-workflow.sh [--plan|--run] [--base <git-ref>] [--check-secrets]
  ./scripts/developer-workflow.sh --files <path> [<path> ...]

Default input is the current branch/worktree diff plus untracked, non-ignored files.
--files is intended for deterministic classification checks and CI-style callers.
--run executes only FAST/RUNTIME local checks. It never runs Docker, Compose, or deployment.
USAGE
}

fail() {
  printf '%s\n' "$*" >&2
  exit 2
}

while (($#)); do
  case "$1" in
    --plan)
      MODE="plan"
      ;;
    --run)
      MODE="run"
      ;;
    --base)
      (($# >= 2)) || fail '--base requires a git ref.'
      BASE_REF="$2"
      shift
      ;;
    --check-secrets)
      CHECK_SECRETS=1
      ;;
    --files)
      shift
      (($# > 0)) || fail '--files requires at least one path.'
      FILES=("$@")
      break
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

if ((${#FILES[@]} == 0)); then
  while IFS= read -r path; do
    [[ -n "$path" ]] && FILES+=("$path")
  done < <(
    {
      if [[ "$BASE_REF" == "HEAD" ]]; then
        git diff --name-only --diff-filter=ACMR HEAD
      else
        git diff --name-only --diff-filter=ACMR "${BASE_REF}...HEAD"
        git diff --name-only --diff-filter=ACMR HEAD
      fi
      git ls-files --others --exclude-standard
    } | awk 'NF && !seen[$0]++' | LC_ALL=C sort
  )
fi

is_env_path() {
  case "$1" in
    .env|.env.*|*/.env|*/.env.*|*.env|*.env.*) return 0 ;;
    *) return 1 ;;
  esac
}

has_runtime=0
has_homehub=0
has_review=0
has_platform=0
has_data=0
has_generic_runtime=0
has_fast=0
has_release_build=0
has_release_config=0
has_langbot_plugin=0
has_langbot_patch=0
env_count=0
unknown_paths=()
runtime_test_files=()

add_runtime_test() {
  local candidate="$1"
  local existing
  for existing in "${runtime_test_files[@]-}"; do
    [[ -z "$existing" ]] && continue
    [[ "$existing" == "$candidate" ]] && return
  done
  runtime_test_files+=("$candidate")
}

for path in "${FILES[@]-}"; do
  [[ -z "$path" ]] && continue
  if is_env_path "$path"; then
    env_count=$((env_count + 1))
    continue
  fi

  case "$path" in
    integrations/langbot/patches/*)
      has_langbot_patch=1
      ;;
    integrations/langbot/plugins/*)
      has_langbot_plugin=1
      ;;
    .dockerignore|Dockerfile|Dockerfile.*|*/Dockerfile|*/Dockerfile.*|package.json|*/package.json|pnpm-lock.yaml)
      has_release_build=1
      ;;
    apps/agent-runtime/deploy/*|infra/docker/*|infra/cloudflare/*|scripts/deploy-agent-runtime.sh)
      has_release_config=1
      ;;
    scripts/developer-workflow.sh|scripts/test-developer-workflow.sh|scripts/smoke-agent-runtime.sh)
      has_fast=1
      ;;
    apps/agent-runtime/src/homehub/*|packages/homehub-domain/src/*|packages/homehub-domain/tsconfig.json)
      has_runtime=1
      has_homehub=1
      ;;
    apps/agent-runtime/src/review/*)
      has_runtime=1
      has_review=1
      ;;
    apps/agent-runtime/src/platform/*)
      has_runtime=1
      has_platform=1
      ;;
    apps/agent-runtime/src/data/*)
      has_runtime=1
      has_data=1
      ;;
    apps/agent-runtime/src/*|apps/agent-runtime/teams/*|apps/agent-runtime/pubg-query.schema.json|apps/agent-runtime/tsconfig.json)
      has_runtime=1
      has_generic_runtime=1
      ;;
    apps/agent-runtime/tests/*.test.ts)
      has_fast=1
      add_runtime_test "$path"
      ;;
    */tests/*|*/test/*|*.test.ts|*.spec.ts|*.md|docs/*|.agent/*|README.md|AGENTS.md|skills/*)
      has_fast=1
      ;;
    *)
      unknown_paths+=("$path")
      ;;
  esac
done

env_only=0
if ((${#FILES[@]} > 0 && env_count == ${#FILES[@]})); then
  env_only=1
fi

LEVEL="FAST"
WORKFLOW="FAST"
DOCKER_BUILD="forbidden"
COMPOSE_MODE="none"

if ((env_only)); then
  LEVEL="RELEASE"
  WORKFLOW="ENV_RECREATE_NO_BUILD"
  COMPOSE_MODE="explicit --apply: docker compose up -d --no-build"
elif ((has_release_build)); then
  LEVEL="RELEASE"
  WORKFLOW="RELEASE_BUILD_REQUIRED"
  DOCKER_BUILD="required only in explicit RELEASE"
  COMPOSE_MODE="explicit --apply: docker compose up -d --no-build after image transfer"
elif ((has_langbot_patch)); then
  LEVEL="RELEASE"
  WORKFLOW="LANGBOT_IMAGE"
  DOCKER_BUILD="LangBot image only; explicit deploy-langbot --apply --patches --activate-image"
  COMPOSE_MODE="explicit --apply only"
elif ((has_release_config)); then
  LEVEL="RELEASE"
  WORKFLOW="RELEASE_CONFIG_NO_BUILD"
  COMPOSE_MODE="explicit --apply: docker compose up -d --no-build"
elif ((has_runtime)); then
  LEVEL="RUNTIME"
  WORKFLOW="RUNTIME"
elif ((has_langbot_plugin)); then
  LEVEL="FAST"
  WORKFLOW="LANGBOT_PLUGIN"
elif ((has_fast)); then
  LEVEL="FAST"
  WORKFLOW="FAST"
fi

printf 'CHANGE_SCOPE_LEVEL=%s\n' "$LEVEL"
printf 'CHANGE_SCOPE_WORKFLOW=%s\n' "$WORKFLOW"
printf 'DOCKER_BUILD=%s\n' "$DOCKER_BUILD"
printf 'COMPOSE_MODE=%s\n' "$COMPOSE_MODE"
printf 'CHANGED_PATHS=%s\n' "${#FILES[@]}"
printf 'LANGBOT_PLUGIN_WORKFLOW=%s\n' "$([[ $has_langbot_plugin -eq 1 ]] && printf required || printf not-required)"
printf 'LANGBOT_IMAGE_WORKFLOW=%s\n' "$([[ $has_langbot_patch -eq 1 ]] && printf required || printf not-required)"
for path in "${FILES[@]-}"; do
  [[ -z "$path" ]] && continue
  printf 'PATH=%s\n' "$path"
done
if ((${#unknown_paths[@]})); then
  printf 'UNKNOWN_PATHS=%s\n' "${unknown_paths[*]}"
fi

case "$WORKFLOW" in
  FAST)
    printf '%s\n' 'VERIFY=targeted tests (when changed), affected package typecheck, git diff --check; Docker/Compose/deploy are prohibited by default.'
    ;;
  RUNTIME)
    printf '%s\n' 'VERIFY=affected runtime/domain typecheck, mapped targeted tests, local endpoint smoke, git diff --check; Docker/Compose/deploy are prohibited by default.'
    ;;
  RELEASE_BUILD_REQUIRED)
    printf '%s\n' 'VERIFY=explicit RELEASE only: test -> secrets check -> immutable commit-tag image build -> CasaOS compose update --no-build -> health -> smoke -> rollback checkpoint.'
    ;;
  ENV_RECREATE_NO_BUILD|RELEASE_CONFIG_NO_BUILD)
    printf '%s\n' 'VERIFY=explicit CasaOS config apply with docker compose up -d --no-build, then health/smoke. Do not build an image.'
    ;;
  LANGBOT_PLUGIN)
    printf '%s\n' 'VERIFY=plugin workflow: build/test the affected plugin and use scripts/deploy-langbot.sh --dry-run before any explicit --apply. Do not build a runtime image.'
    ;;
  LANGBOT_IMAGE)
    printf '%s\n' 'VERIFY=LangBot patch/image workflow: scripts/deploy-langbot.sh --dry-run --patches, then explicit --apply --patches --activate-image.'
    ;;
esac

if [[ "$MODE" != "run" ]]; then
  exit 0
fi

run() {
  printf '+ '
  printf '%q ' "$@"
  printf '\n'
  "$@"
}

if [[ "$WORKFLOW" != "FAST" && "$WORKFLOW" != "RUNTIME" ]]; then
  fail "${WORKFLOW} is plan-only here. Use its explicit workflow; this command will not build or deploy."
fi

run git diff --check

if [[ "$WORKFLOW" == "FAST" ]]; then
  if ((${#runtime_test_files[@]})); then
    run pnpm --filter @agent/agent-runtime typecheck
    run pnpm --filter @agent/agent-runtime exec tsx --test "${runtime_test_files[@]#apps/agent-runtime/}"
  else
    printf '%s\n' 'No affected package test/typecheck was inferred for this FAST change.'
  fi
else
  if ((has_homehub)) && ((has_generic_runtime == 0 && has_review == 0 && has_platform == 0 && has_data == 0)); then
    run pnpm --filter @agent/homehub-domain build
  else
    run pnpm --filter @agent/agent-runtime typecheck
  fi

  if ((${#runtime_test_files[@]} == 0)); then
    if ((has_homehub)); then
      add_runtime_test 'apps/agent-runtime/tests/homehub-v1.test.ts'
      add_runtime_test 'apps/agent-runtime/tests/whoami.test.ts'
    fi
    if ((has_review)); then
      add_runtime_test 'apps/agent-runtime/tests/review-v3-2.test.ts'
      add_runtime_test 'apps/agent-runtime/tests/review-v3-3.test.ts'
    fi
    if ((has_platform)); then
      add_runtime_test 'apps/agent-runtime/tests/platform-adapter.test.ts'
      add_runtime_test 'apps/agent-runtime/tests/whoami.test.ts'
    fi
    if ((has_data)); then
      add_runtime_test 'apps/agent-runtime/tests/runtime-data-layer.test.ts'
      add_runtime_test 'apps/agent-runtime/tests/n8n-data-gateway.test.ts'
    fi
    if ((${#runtime_test_files[@]} == 0)); then
      add_runtime_test 'apps/agent-runtime/tests/v3-acceptance.test.ts'
    fi
  fi

  test_args=()
  for test_file in "${runtime_test_files[@]}"; do
    test_args+=("${test_file#apps/agent-runtime/}")
  done
  run pnpm --filter @agent/agent-runtime exec tsx --test "${test_args[@]}"
  run ./scripts/smoke-agent-runtime.sh
fi

if ((CHECK_SECRETS)); then
  run pnpm check:secrets
fi
