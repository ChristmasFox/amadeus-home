#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

assert_line() {
  local output="$1" expected="$2"
  grep -Fqx "$expected" <<<"$output" || {
    printf 'Expected workflow output to contain: %s\n%s\n' "$expected" "$output" >&2
    exit 1
  }
}

scope() { ./scripts/developer-workflow.sh --files "$@"; }

pubg="$(scope packages/pubg-domain/src/index.ts)"
assert_line "$pubg" 'CHANGE_SCOPE_LEVEL=RUNTIME'
assert_line "$pubg" 'CHANGE_SCOPE_WORKFLOW=PUBG_DOMAIN_PLUGIN'
assert_line "$pubg" 'DOCKER_BUILD=forbidden'

plugin="$(scope plugins/pubg/src/index.ts)"
assert_line "$plugin" 'CHANGE_SCOPE_WORKFLOW=PUBG_DOMAIN_PLUGIN'

identity="$(scope packages/identity/src/index.ts)"
assert_line "$identity" 'CHANGE_SCOPE_LEVEL=RUNTIME'
assert_line "$identity" 'CHANGE_SCOPE_WORKFLOW=AMADEUS_IDENTITY'

amadeus="$(scope plugins/amadeus/src/identity.ts)"
assert_line "$amadeus" 'CHANGE_SCOPE_WORKFLOW=AMADEUS_IDENTITY'

presentation="$(scope packages/presentation/src/index.ts)"
assert_line "$presentation" 'CHANGE_SCOPE_LEVEL=RUNTIME'
assert_line "$presentation" 'CHANGE_SCOPE_WORKFLOW=PRESENTATION'

product="$(scope apps/product-radar/src/core/application.ts)"
assert_line "$product" 'CHANGE_SCOPE_LEVEL=RUNTIME'
assert_line "$product" 'CHANGE_SCOPE_WORKFLOW=PRODUCT_RADAR'

docs="$(scope docs/ARCHITECTURE.md)"
assert_line "$docs" 'CHANGE_SCOPE_LEVEL=FAST'
assert_line "$docs" 'CHANGE_SCOPE_WORKFLOW=FAST'

image="$(scope infra/docker/casaos/openclaw/Dockerfile)"
assert_line "$image" 'CHANGE_SCOPE_LEVEL=RELEASE'
assert_line "$image" 'CHANGE_SCOPE_WORKFLOW=RELEASE_BUILD_REQUIRED'
assert_line "$image" 'DOCKER_BUILD=required only in explicit RELEASE'

config="$(scope scripts/deploy-openclaw.sh)"
assert_line "$config" 'CHANGE_SCOPE_LEVEL=RELEASE'
assert_line "$config" 'CHANGE_SCOPE_WORKFLOW=OPENCLAW_RELEASE_CONFIG'

env_output="$(scope .env.example)"
assert_line "$env_output" 'CHANGE_SCOPE_LEVEL=RELEASE'
assert_line "$env_output" 'CHANGE_SCOPE_WORKFLOW=ENV_RECREATE_NO_BUILD'
assert_line "$env_output" 'COMPOSE_MODE=explicit --apply: docker compose up -d --no-build'


storage="$(scope scripts/storage-health.sh scripts/storage-maintenance.sh)"
assert_line "$storage" 'CHANGE_SCOPE_WORKFLOW=STORAGE_RUNTIME'
assert_line "$storage" 'DOCKER_BUILD=forbidden'
assert_line "$storage" 'DOCKER_IMAGE_SET=none'
backup="$(scope scripts/service-aware-backup.sh docs/SERVICE_AWARE_BACKUP_REGISTRY.json)"
assert_line "$backup" 'CHANGE_SCOPE_WORKFLOW=STORAGE_RUNTIME'
manifest="$(scope docs/OPERATION_SKULD_MIGRATION_MANIFEST.json docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md)"
assert_line "$manifest" 'CHANGE_SCOPE_WORKFLOW=SKULD_CONSISTENCY'
product_only="$(scope apps/product-radar/src/core/application.ts)"
assert_line "$product_only" 'DOCKER_IMAGE_SET=product-radar'
shared="$(scope packages/presentation/src/index.ts apps/product-radar/src/core/application.ts)"
assert_line "$shared" 'DOCKER_IMAGE_SET=both'

printf '%s\n' 'Developer workflow scope tests passed.'


compact_success="$(./scripts/run-check.sh 'compact success' printf '%s\n' full-output-hidden)"
grep -Fq 'CHECK_PASS|compact success' <<<"$compact_success"
[[ "$(printf '%s\n' "$compact_success" | wc -l | tr -d ' ')" -eq 1 ]]
compact_failure="$(set +e; ./scripts/run-check.sh 'compact failure' bash -c 'for i in $(seq 1 120); do echo diagnostic-$i; done; exit 7' 2>&1; true)"
grep -Fq 'CHECK_FAIL|compact failure|exit=7' <<<"$compact_failure"
grep -Fq 'diagnostic-120' <<<"$compact_failure"
if grep -Fxq 'diagnostic-1' <<<"$compact_failure"; then
  printf '%s\n' 'compact runner emitted unbounded failure output' >&2
  exit 1
fi
cache_dir="$(mktemp -d "${TMPDIR:-/tmp}/workflow-cache.XXXXXX")"
first="$(VALIDATION_CACHE_DIR="$cache_dir" VALIDATION_CACHE_KEY=stable ./scripts/run-check.sh 'cache first' true)"
second="$(VALIDATION_CACHE_DIR="$cache_dir" VALIDATION_CACHE_KEY=stable ./scripts/run-check.sh 'cache reused' false)"
grep -Fq 'CHECK_PASS|cache first' <<<"$first"
grep -Fq 'CHECK_REUSED|cache reused|key=stable' <<<"$second"
third="$(VALIDATION_CACHE_DIR="$cache_dir" VALIDATION_CACHE_KEY=changed set +e; true)" || true
rm -rf "$cache_dir"
printf '%s\n' 'Validation efficiency fixtures passed.'
