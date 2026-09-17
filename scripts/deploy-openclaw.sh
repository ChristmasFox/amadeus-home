#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="ubuntu"
COMPOSE_DIR="/var/lib/casaos/apps/openclaw"
DATA_DIR="/DATA/AppData/openclaw"
OLD_PUBG_COMPOSE_DIR="/var/lib/casaos/apps/pubg-query-engine-v3"
OLD_OPENCLAW_COMPOSE_DIR="/var/lib/casaos/apps/big-bear-openclaw"
N8N_DB="/DATA/AppData/n8n/database.sqlite"
LANGBOT_DB="/DATA/AppData/langbot/data/langbot.db"
RADAR_COMPOSE_FILE="/var/lib/casaos/apps/product-radar/docker-compose.yml"
LEGACY_STATE="/DATA/AppData/pubg-query-engine-v3/data/state.json"
LEGACY_FEATURES="/DATA/AppData/pubg-query-engine-v3/data/features.json"
LEGACY_API_KEY="/DATA/AppData/pubg-query-engine-v3/secrets/pubg-api-key"
LEGACY_IDENTITY="/DATA/AppData/pubg-query-engine-v3/admin-identity.env"
IMAGE=""
APPLY=0
BUILD=0
CLEANUP=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy-openclaw.sh [--dry-run] [--apply] [--build] [--cleanup]
      [--image <tag>] [--machine <name>] [--compose-dir <path>]

Default is a dry-run. --apply performs the one-time OpenClaw PUBG switch:
preflight, external config/secret preparation, old Telegram/n8n consumer stop,
migration dry-run and apply, then new CasaOS startup. --cleanup retires the
dedicated old PUBG and unused legacy OpenClaw app definitions after health passes.
USAGE
}

fail() {
  printf '%s\n' "$*" >&2
  exit 2
}

quote_remote() {
  printf '%q' "$1"
}

base64_file() {
  base64 < "$1" | tr -d '\n'
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --build) BUILD=1 ;;
    --cleanup) CLEANUP=1 ;;
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
    --help|-h)
      usage
      exit 0
      ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

[[ "$IMAGE" != *$'\n'* ]] || fail 'Image tag must not contain newlines.'
[[ "$IMAGE" != *[[:space:]]* ]] || fail 'Image tag must not contain whitespace.'
if ((CLEANUP)) && ((APPLY == 0)); then
  fail '--cleanup requires --apply.'
fi
if ((BUILD)) && [[ -z "$IMAGE" ]]; then
  IMAGE="local/openclaw-pubg:git-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)-$(date -u +%Y%m%d%H%M%S)"
fi

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'BUILD=%s\n' "$([[ $BUILD -eq 1 ]] && printf explicit || printf disabled)"
printf 'CLEANUP=%s\n' "$([[ $CLEANUP -eq 1 ]] && printf explicit || printf disabled)"
printf 'IMAGE=%s\n' "${IMAGE:-requires --image for apply without --build}"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'COMPOSE_DIR=%s\n' "$COMPOSE_DIR"
printf '%s\n' 'COMPOSE_COMMAND=docker compose up -d --no-build'

if ((APPLY == 0)); then
  if ((BUILD)); then
    printf '%s\n' 'PLAN=run tests, secret scan, host BuildKit image build/load, external preparation, one-time migration, old consumer stop, health checks, and optional legacy cleanup.'
  else
    printf '%s\n' 'PLAN=no image build or runtime write; apply requires an existing --image and performs the one-time switch.'
  fi
  exit 0
fi
[[ -n "$IMAGE" ]] || fail 'Apply without --build requires --image <tag>.'

git -C "$ROOT_DIR" diff --check
(
  cd "$ROOT_DIR"
  source /Users/blacksidev/.nvm/nvm.sh
  nvm use 24.16.0 >/dev/null
  pnpm build:pubg
  pnpm typecheck:pubg
  pnpm test:pubg
  pnpm check:secrets
)

if ((BUILD)); then
  git -C "$ROOT_DIR" diff --quiet || fail 'Refusing RELEASE build with unstaged/uncommitted worktree changes.'
  git -C "$ROOT_DIR" diff --cached --quiet || fail 'Refusing RELEASE build with staged-but-uncommitted changes.'
  docker buildx build --platform linux/arm64 --load --progress=plain \
    --file "$ROOT_DIR/infra/docker/casaos/openclaw/Dockerfile" \
    --tag "$IMAGE" "$ROOT_DIR"
  docker save "$IMAGE" | orb -m "$MACHINE" -u root docker load
else
  orb -m "$MACHINE" -u root docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "Remote image not found: $IMAGE"
fi

CHECKPOINT_ID="openclaw-pubg-$(date -u +%Y%m%d-%H%M%S)"
CHECKPOINT_DIR="$DATA_DIR/backups/$CHECKPOINT_ID"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
TEMPLATE_FILE="$ROOT_DIR/infra/docker/casaos/openclaw/docker-compose.example.yml"
CONFIG_TEMPLATE="$ROOT_DIR/integrations/openclaw/openclaw.json.example"
TEAM_TEMPLATE="$ROOT_DIR/packages/pubg-domain/config/default-team.json"
AGENTS_TEMPLATE="$ROOT_DIR/integrations/openclaw/workspace/AGENTS.md"
SOUL_TEMPLATE="$ROOT_DIR/integrations/openclaw/workspace/SOUL.md"
USER_TEMPLATE="$ROOT_DIR/integrations/openclaw/workspace/USER.md"

for required_file in "$TEMPLATE_FILE" "$CONFIG_TEMPLATE" "$TEAM_TEMPLATE" "$AGENTS_TEMPLATE" "$SOUL_TEMPLATE" "$USER_TEMPLATE"; do
  [[ -f "$required_file" ]] || fail "Missing deployment source: $required_file"
done

orb -m "$MACHINE" -u root python3 - \
  "$N8N_DB" "$LANGBOT_DB" "$LEGACY_STATE" "$LEGACY_FEATURES" \
  "$LEGACY_API_KEY" "$LEGACY_IDENTITY" "9router_default" <<'PY'
import subprocess
import sys
from pathlib import Path

missing = [str(Path(value)) for value in sys.argv[1:7] if not Path(value).is_file()]
if missing:
    raise SystemExit('missing legacy source(s): ' + ', '.join(missing))
try:
    subprocess.run(['docker', 'network', 'inspect', sys.argv[7]], check=True, stdout=subprocess.DEVNULL)
except subprocess.CalledProcessError as exc:
    raise SystemExit('required 9router network is unavailable') from exc
print('PREFLIGHT=passed')
PY

TELEGRAM_BOT_UUID="$(orb -m "$MACHINE" -u root python3 - "$LANGBOT_DB" <<'PY'
import sqlite3
import sys

conn = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
rows = conn.execute("select uuid from bots where lower(adapter) = 'telegram' and enable != 0").fetchall()
conn.close()
if len(rows) != 1:
    raise SystemExit('expected exactly one enabled legacy LangBot Telegram bot, found ' + str(len(rows)))
print(rows[0][0])
PY
)"

TEAM_B64="$(base64_file "$TEAM_TEMPLATE")"
CONFIG_B64="$(base64_file "$CONFIG_TEMPLATE")"
COMPOSE_B64="$(base64_file "$TEMPLATE_FILE")"
AGENTS_B64="$(base64_file "$AGENTS_TEMPLATE")"
SOUL_B64="$(base64_file "$SOUL_TEMPLATE")"
USER_B64="$(base64_file "$USER_TEMPLATE")"

orb -m "$MACHINE" -u root python3 - \
  "$CHECKPOINT_DIR" \
  "$COMPOSE_FILE" \
  "$OLD_PUBG_COMPOSE_DIR/docker-compose.yml" \
  "$OLD_OPENCLAW_COMPOSE_DIR/docker-compose.yml" \
  "$RADAR_COMPOSE_FILE" \
  "$LANGBOT_DB" "$N8N_DB" "$LEGACY_STATE" "$LEGACY_FEATURES" \
  "$DATA_DIR/data/pubg.sqlite" < "$ROOT_DIR/scripts/openclaw_checkpoint.py"

orb -m "$MACHINE" -u root python3 - \
  "$DATA_DIR" "$TEAM_B64" "$CONFIG_B64" "$AGENTS_B64" "$SOUL_B64" "$USER_B64" \
  "$LEGACY_API_KEY" "$LANGBOT_DB" "$LEGACY_IDENTITY" "$DATA_DIR/openclaw.env" \
  < "$ROOT_DIR/scripts/openclaw_prepare.py"

orb -m "$MACHINE" -u root python3 - \
  "$COMPOSE_DIR" "$COMPOSE_FILE" "$COMPOSE_B64" "$IMAGE" <<'PY'
import base64
import os
import re
import sys
from pathlib import Path

compose_dir = Path(sys.argv[1])
compose_file = Path(sys.argv[2])
content = base64.b64decode(sys.argv[3]).decode()
image = sys.argv[4]
if not re.fullmatch(r'[A-Za-z0-9._/@:-]+', image):
    raise SystemExit('invalid image tag')
matches = list(re.finditer(r'(?m)^(\s*)image:\s*.*$', content))
if len(matches) != 1:
    raise SystemExit('deployment compose must contain exactly one image line')
match = matches[0]
content = content[:match.start()] + match.group(1) + 'image: ' + image + content[match.end():]
compose_dir.mkdir(parents=True, exist_ok=True)
compose_file.write_text(content)
os.chmod(compose_file, 0o644)
print('COMPOSE=installed')
PY

remote_compose_dir="$(quote_remote "$COMPOSE_DIR")"
remote_checkpoint="$(quote_remote "$CHECKPOINT_DIR")"
remote_image="$(quote_remote "$IMAGE")"

orb -m "$MACHINE" -u root bash -lc "set -euo pipefail; cd $remote_compose_dir; docker compose config >/dev/null; docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js config validate --json > $remote_checkpoint/config-validate.json; docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js plugins inspect pubg --runtime --json > $remote_checkpoint/plugin-inspect.json; docker compose run --rm --no-deps --entrypoint node openclaw dist/index.js skills list --json > $remote_checkpoint/skills-list.json"

orb -m "$MACHINE" -u root python3 - "$CHECKPOINT_DIR/plugin-inspect.json" <<'PY'
import json
import sys
from pathlib import Path

value = json.loads(Path(sys.argv[1]).read_text())
text = json.dumps(value, ensure_ascii=False)
expected = [
    'pubg_resolve_players', 'pubg_search_matches', 'pubg_query_stats',
    'pubg_compare_stats', 'pubg_get_match', 'pubg_get_review_facts',
]
if 'loaded' not in text or any(name not in text for name in expected):
    raise SystemExit('OpenClaw PUBG plugin did not report all six loaded tools')
print('PLUGIN_PREFLIGHT=passed')
PY

orb -m "$MACHINE" -u root python3 - "$CHECKPOINT_DIR/skills-list.json" <<'PY'
import json
import sys
from pathlib import Path

value = json.loads(Path(sys.argv[1]).read_text())
skills = [item for item in value.get('skills', []) if item.get('name') == 'pubg']
if not skills or any(not str(item.get('description', '')).strip() for item in skills):
    raise SystemExit('OpenClaw did not load the PUBG bundled Skill with a description')
print('SKILL_PREFLIGHT=passed count=%s' % len(skills))
PY

OLD_LANGBOT_RUNNING=0
OLD_N8N_RUNNING=0
OLD_LANGBOT_STOPPED=0
OLD_N8N_STOPPED=0

restore_legacy_on_error() {
  status=$?
  if ((status != 0)); then
    if ((OLD_LANGBOT_STOPPED == 1)) && ((OLD_LANGBOT_RUNNING == 1)); then
      orb -m "$MACHINE" -u root docker start langbot >/dev/null 2>&1 || true
    fi
    if ((OLD_N8N_STOPPED == 1)) && ((OLD_N8N_RUNNING == 1)); then
      orb -m "$MACHINE" -u root docker start n8n >/dev/null 2>&1 || true
    fi
  fi
  exit "$status"
}
trap restore_legacy_on_error EXIT

old_langbot_state="$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Running}}' langbot 2>/dev/null || true)"
if [[ "$old_langbot_state" == "true" ]]; then
  OLD_LANGBOT_RUNNING=1
  orb -m "$MACHINE" -u root docker stop langbot >/dev/null
  OLD_LANGBOT_STOPPED=1
fi
old_n8n_state="$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Running}}' n8n 2>/dev/null || true)"
if [[ "$old_n8n_state" == "true" ]]; then
  OLD_N8N_RUNNING=1
  orb -m "$MACHINE" -u root docker stop n8n >/dev/null
  OLD_N8N_STOPPED=1
fi

old_radar_state="$(orb -m "$MACHINE" -u root docker inspect --format '{{.State.Running}}' product-radar 2>/dev/null || true)"
orb -m "$MACHINE" -u root python3 - "$LANGBOT_DB" "$N8N_DB" "$RADAR_COMPOSE_FILE" "$TELEGRAM_BOT_UUID" < "$ROOT_DIR/scripts/openclaw_retire_legacy.py"

if ((OLD_N8N_STOPPED == 1)) && ((OLD_N8N_RUNNING == 1)); then
  orb -m "$MACHINE" -u root docker start n8n >/dev/null
  OLD_N8N_STOPPED=0
fi

if [[ "$old_radar_state" == "true" ]]; then
  orb -m "$MACHINE" -u root bash -lc 'set -euo pipefail; cd /var/lib/casaos/apps/product-radar; docker compose up -d --no-build product-radar'
fi

run_migration() {
  local report_name="$1"
  local apply_flag="${2:-}"
  local remote_report="$(quote_remote "$CHECKPOINT_DIR/migration-$report_name.json")"
  local command="docker run --rm --user 0:0 --entrypoint node --mount type=bind,source=$(quote_remote "$DATA_DIR/data"),target=/data --mount type=bind,source=$(quote_remote "$N8N_DB"),target=/migration/n8n.sqlite,readonly --mount type=bind,source=$(quote_remote "$LEGACY_STATE"),target=/migration/state.json,readonly --mount type=bind,source=$(quote_remote "$LEGACY_FEATURES"),target=/migration/features.json,readonly $remote_image /app/extensions/pubg/dist/migrate.js --target /data/pubg.sqlite --n8n /migration/n8n.sqlite --state /migration/state.json --features /migration/features.json --migration-id $(quote_remote "$CHECKPOINT_ID") $apply_flag > $remote_report"
  orb -m "$MACHINE" -u root bash -lc "set -euo pipefail; $command"
}

run_migration dry-run
orb -m "$MACHINE" -u root python3 - "$CHECKPOINT_DIR/migration-dry-run.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text())
if report.get('errors'):
    raise SystemExit('PUBG migration dry-run reported source errors: ' + json.dumps(report['errors'], ensure_ascii=False))
if int(report.get('uniqueMatchIds', 0)) <= 0:
    raise SystemExit('PUBG migration dry-run found no match IDs')
print('MIGRATION_DRY_RUN input=%s unique=%s duplicates=%s invalid=%s features=%s' % (
    report.get('inputMatchRows', 0), report.get('uniqueMatchIds', 0),
    report.get('duplicateInputs', 0), report.get('invalidInputs', 0),
    report.get('featureRows', 0)))
PY

run_migration apply --apply
orb -m "$MACHINE" -u root python3 - "$CHECKPOINT_DIR/migration-apply.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text())
if report.get('errors'):
    raise SystemExit('PUBG migration apply reported source errors: ' + json.dumps(report['errors'], ensure_ascii=False))
print('MIGRATION_APPLY inserted=%s updated=%s duplicates=%s invalid=%s features=%s' % (
    report.get('inserted', 0), report.get('updated', 0),
    report.get('duplicateInputs', 0), report.get('invalidInputs', 0),
    report.get('importedFeatures', 0)))
PY

orb -m "$MACHINE" -u root python3 - "$DATA_DIR/data/pubg.sqlite" "$CHECKPOINT_ID" <<'PY'
import sqlite3
import sys

conn = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
matches = conn.execute('select count(*) from matches').fetchone()[0]
players = conn.execute('select count(*) from match_players').fetchone()[0]
features = conn.execute('select count(*) from telemetry_features').fetchone()[0]
migrations = conn.execute('select count(*) from migration_runs where id = ?', (sys.argv[2],)).fetchone()[0]
conn.close()
if matches <= 0 or migrations != 1:
    raise SystemExit('new PUBG SQLite verification failed')
print('PUBG_SQLITE=verified matches=%s players=%s features=%s migration_runs=%s' % (matches, players, features, migrations))
PY

orb -m "$MACHINE" -u root chown -R 1000:1000 "$DATA_DIR/data"
orb -m "$MACHINE" -u root bash -lc "set -euo pipefail; cd $remote_compose_dir; docker compose up -d --no-build; for attempt in \$(seq 1 30); do if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:18789/healthz >/dev/null 2>&1; then break; fi; sleep 2; done; curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18789/healthz >/dev/null; docker exec openclaw node dist/index.js channels status --json > $remote_checkpoint/channels-status.json"

orb -m "$MACHINE" -u root python3 - "$CHECKPOINT_DIR/channels-status.json" <<'PY'
import json
import sys
from pathlib import Path

value = json.loads(Path(sys.argv[1]).read_text())
text = json.dumps(value, ensure_ascii=False).lower()
if 'telegram' not in text or not any(item in text for item in ['running', 'connected', 'healthy', 'ok']):
    raise SystemExit('OpenClaw Telegram channel did not report a healthy state')
print('TELEGRAM_CHANNEL=verified')
PY

if ((OLD_LANGBOT_STOPPED == 1)) && ((OLD_LANGBOT_RUNNING == 1)); then
  orb -m "$MACHINE" -u root docker start langbot >/dev/null
  OLD_LANGBOT_STOPPED=0
fi

orb -m "$MACHINE" -u root python3 - "$LANGBOT_DB" <<'PY'
import sqlite3
import sys

conn = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
enabled = conn.execute("select count(*) from bots where lower(adapter) = 'telegram' and enable != 0").fetchone()[0]
conn.close()
if enabled:
    raise SystemExit('legacy LangBot Telegram bot became enabled again')
print('LEGACY_TELEGRAM=still_disabled')
PY

if ((CLEANUP)); then
  remote_old_pubg="$(quote_remote "$OLD_PUBG_COMPOSE_DIR/docker-compose.yml")"
  remote_old_openclaw="$(quote_remote "$OLD_OPENCLAW_COMPOSE_DIR/docker-compose.yml")"
  orb -m "$MACHINE" -u root bash -lc "set -euo pipefail; if docker inspect --format '{{.State.Running}}' pubg-query-engine-v3 >/dev/null 2>&1; then docker stop pubg-query-engine-v3 >/dev/null; fi; if docker inspect pubg-query-engine-v3 >/dev/null 2>&1; then docker rm pubg-query-engine-v3 >/dev/null; fi; if docker inspect big-bear-openclaw >/dev/null 2>&1; then if [ \"\$(docker inspect --format '{{.State.Running}}' big-bear-openclaw)\" = true ]; then docker stop big-bear-openclaw >/dev/null; fi; docker rm big-bear-openclaw >/dev/null; fi; if [ -f $remote_old_pubg ]; then mv $remote_old_pubg $remote_checkpoint/legacy-pubg-compose.retired.yml; fi; if [ -f $remote_old_openclaw ]; then mv $remote_old_openclaw $remote_checkpoint/legacy-openclaw-compose.retired.yml; fi"
  printf '%s\n' 'LEGACY_APP_DEFINITIONS=retired'
else
  printf '%s\n' 'LEGACY_APP_DEFINITIONS=retained (rerun with --cleanup for final one-time retirement)'
fi

trap - EXIT
printf 'CHECKPOINT=%s\n' "$CHECKPOINT_DIR"
printf '%s\n' 'OpenClaw PUBG deployment checks passed.'
