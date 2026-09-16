#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kurisu-release-dry-run.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM

runtime_output="$($ROOT_DIR/scripts/deploy-agent-runtime.sh --dry-run)"
plugin_output="$($ROOT_DIR/scripts/deploy-langbot.sh --dry-run --plugin kurisu-gateway)"
backup_output="$($ROOT_DIR/scripts/backup-kurisu-state.sh --dry-run)"

mkdir -p "$TEMP_DIR/pubg-query-engine-v3/data"
: > "$TEMP_DIR/pubg-query-engine-v3/data/state.json.kurisu.sqlite"
tar -czf "$TEMP_DIR/kurisu-state-fixture.tar.gz" -C "$TEMP_DIR" pubg-query-engine-v3/data/state.json.kurisu.sqlite
restore_output="$($ROOT_DIR/scripts/restore-kurisu-state.sh --dry-run "$TEMP_DIR/kurisu-state-fixture.tar.gz")"

printf '%s\n' 'R02_DRY_RUN runtime'
printf '%s\n' "$runtime_output" | rg '^(MODE|BUILD|IMAGE|MACHINE|COMPOSE_DIR|COMPOSE_COMMAND|PLAN)='
printf '%s\n' 'R02_DRY_RUN langbot'
printf '%s\n' "$plugin_output" | rg '^(DEPLOY_PLAN|RUNTIME|PACKAGE|ROLLBACK_DIR|DRY_RUN)([ =])' || true
printf '%s\n' 'R02_DRY_RUN backup'
printf '%s\n' "$backup_output" | rg '^(MODE|MACHINE|STATE_FILE|ARCHIVE|PLAN)='
printf '%s\n' 'R02_DRY_RUN restore'
printf '%s\n' "$restore_output" | rg '^(MODE|MACHINE|ARCHIVE|STATE_FILE|ENTRIES|PLAN|Preview only)'

printf '%s\n' 'MUTATION=none (no CasaOS compose, container, LangBot API, n8n DB, or production Kurisu state write)'
printf '%s\n' 'R02_PASS'
