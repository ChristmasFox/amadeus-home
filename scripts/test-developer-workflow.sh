#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

assert_contains() {
  local output="$1"
  local expected="$2"
  if ! grep -Fqx "$expected" <<<"$output" >/dev/null; then
    printf '%s\n' "Expected workflow output to contain: $expected" >&2
    printf '%s\n' 'Actual output:' >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
}

assert_text_contains() {
  local output="$1"
  local expected="$2"
  if ! grep -F "$expected" <<<"$output" >/dev/null; then
    printf '%s\n' "Expected text to contain: $expected" >&2
    printf '%s\n' 'Actual text:' >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
}

scope() {
  ./scripts/developer-workflow.sh --files "$@"
}

runtime_output="$(scope packages/homehub-domain/src/index.ts)"
assert_contains "$runtime_output" 'CHANGE_SCOPE_LEVEL=RUNTIME'
assert_contains "$runtime_output" 'CHANGE_SCOPE_WORKFLOW=RUNTIME'
assert_contains "$runtime_output" 'DOCKER_BUILD=forbidden'

fast_output="$(scope docs/ARCHITECTURE.md)"
assert_contains "$fast_output" 'CHANGE_SCOPE_LEVEL=FAST'
assert_contains "$fast_output" 'CHANGE_SCOPE_WORKFLOW=FAST'
assert_contains "$fast_output" 'DOCKER_BUILD=forbidden'

nested_docs_output="$(scope apps/agent-runtime/README.md)"
assert_contains "$nested_docs_output" 'CHANGE_SCOPE_LEVEL=FAST'
assert_contains "$nested_docs_output" 'DOCKER_BUILD=forbidden'

release_output="$(scope apps/agent-runtime/Dockerfile)"
assert_contains "$release_output" 'CHANGE_SCOPE_LEVEL=RELEASE'
assert_contains "$release_output" 'CHANGE_SCOPE_WORKFLOW=RELEASE_BUILD_REQUIRED'
assert_contains "$release_output" 'DOCKER_BUILD=required only in explicit RELEASE'

env_output="$(scope .env.example)"
assert_contains "$env_output" 'CHANGE_SCOPE_LEVEL=RELEASE'
assert_contains "$env_output" 'CHANGE_SCOPE_WORKFLOW=ENV_RECREATE_NO_BUILD'
assert_contains "$env_output" 'DOCKER_BUILD=forbidden'
assert_contains "$env_output" 'COMPOSE_MODE=explicit --apply: docker compose up -d --no-build'

plugin_output="$(scope integrations/langbot/plugins/pubg-stats-v3/plugin.py)"
assert_contains "$plugin_output" 'CHANGE_SCOPE_WORKFLOW=LANGBOT_PLUGIN'
assert_contains "$plugin_output" 'DOCKER_BUILD=forbidden'

patch_output="$(scope integrations/langbot/patches/example.patch)"
assert_contains "$patch_output" 'CHANGE_SCOPE_WORKFLOW=LANGBOT_IMAGE'
assert_contains "$patch_output" 'LANGBOT_IMAGE_WORKFLOW=required'

deploy_output="$(./scripts/deploy-agent-runtime.sh --dry-run)"
assert_contains "$deploy_output" 'BUILD=disabled'
assert_contains "$deploy_output" 'COMPOSE_COMMAND=docker compose up -d --no-build'

deploy_build_output="$(./scripts/deploy-agent-runtime.sh --dry-run --build)"
assert_contains "$deploy_build_output" 'BUILD=explicit'
assert_text_contains "$deploy_build_output" 'IMAGE=local/pubg-query-engine-v3:git-'

# Stub OrbStack so --apply behavior can be inspected without touching CasaOS.
tmp_dir="$(mktemp -d)"
capture_file="$tmp_dir/orb-command.txt"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM
cat > "$tmp_dir/orb" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "${FAKE_ORB_CAPTURE:?}"
SH
chmod +x "$tmp_dir/orb"
apply_output="$(PATH="$tmp_dir:$PATH" FAKE_ORB_CAPTURE="$capture_file" ./scripts/deploy-agent-runtime.sh --apply --image local/pubg-query-engine-v3:git-test)"
assert_text_contains "$apply_output" 'Deployment checks passed.'
apply_command="$(cat "$capture_file")"
assert_text_contains "$apply_command" 'docker compose up -d --no-build'

printf '%s\n' 'Developer workflow scope tests passed.'
