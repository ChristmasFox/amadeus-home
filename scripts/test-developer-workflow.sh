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

printf '%s\n' 'Developer workflow scope tests passed.'
