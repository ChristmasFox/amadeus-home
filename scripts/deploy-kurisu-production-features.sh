#!/usr/bin/env bash
set -euo pipefail

# Activate external Runtime notification configuration, write tools and the
# Radar central handoff. It never prints token values; n8n's existing global
# CODEX_NOTIFY_SECRET and digest delivery config stay outside Git.
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-kurisu-production-features.sh [--dry-run|--apply]

Prepare the external Kurisu runtime env from the active Daily Tech & Market
Digest, patch the two canonical CasaOS compose files with read-only secret
mounts, and recreate Runtime and Product Radar with --no-build. The caller
must build/deploy the Runtime image and import the versioned n8n workflow
separately before the new digest sender is enabled.
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'MACHINE=%s\n' "$MACHINE"
printf '%s\n' 'PLAN=derive non-secret KOOK delivery metadata from active digest, mount existing n8n notification secret and LangBot API token, enable Runtime notifications/write tools, centralize Radar notification handoff, and recreate affected CasaOS apps with --no-build.'
if ((APPLY == 0)); then exit 0; fi

orb -m "$MACHINE" -u root python3 - <<'PY'
import json
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

root = Path('/DATA/AppData')
runtime_dir = root / 'pubg-query-engine-v3'
n8n_db = root / 'n8n/database.sqlite'
digest_config = root / 'n8n/daily-digest/config/digest.json'
notification_secret = root / 'n8n/secrets/codex-notify-secret'
langbot_token = root / 'product-radar/secrets/langbot-api-token'
for path in (runtime_dir, n8n_db, digest_config, notification_secret, langbot_token):
    if not path.exists() or not path.is_file() and path != runtime_dir:
        raise SystemExit(f'required external path is unavailable: {path}')
if not notification_secret.read_text().strip() or not langbot_token.read_text().strip():
    raise SystemExit('required external secret file is empty')
# Both n8n and the Runtime deliberately run as the unprivileged `node` user
# (uid/gid 1000).  A root-only bind mount looks present in docker inspect but
# makes Runtime silently start with an empty ingress secret.  Keep the secret
# root-owned while granting that one shared service group read access.
os.chown(notification_secret, 0, 1000)
notification_secret.chmod(0o640)

con = sqlite3.connect(f'file:{n8n_db}?mode=ro', uri=True)
row = con.execute("select value from variables where key='CODEX_NOTIFY_SECRET'").fetchone()
if not row or not str(row[0] or '').strip():
    raise SystemExit('n8n CODEX_NOTIFY_SECRET variable is unavailable')
delivery = json.loads(digest_config.read_text()).get('delivery', {})
target_type = str(delivery.get('targetType') or '').strip()
target_id = str(delivery.get('targetId') or '').strip()
bot_id = str(delivery.get('botUuid') or '').strip()
if target_type not in {'person', 'group'} or not target_id or not bot_id:
    raise SystemExit('digest delivery config is incomplete')
radar_env = Path('/var/lib/casaos/apps/product-radar/.env')
if not radar_env.exists():
    raise SystemExit('Product Radar external env is unavailable')
radar_values = {}
for line in radar_env.read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        radar_values[key.strip()] = value.strip()
telegram_recipient = radar_values.get('TELEGRAM_ADMIN_USER_ID', '')
telegram_bot = radar_values.get('PRODUCT_RADAR_TELEGRAM_BOT_ID', '')
kook_recipient = radar_values.get('KOOK_ADMIN_USER_ID', '')
kook_bot = radar_values.get('PRODUCT_RADAR_KOOK_BOT_ID', '')
if not all((telegram_recipient, telegram_bot, kook_recipient, kook_bot)):
    raise SystemExit('Product Radar admin notification targets are incomplete')

stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
env_file = runtime_dir / 'kurisu.env'
if env_file.exists(): shutil.copy2(env_file, env_file.with_name(env_file.name + f'.codex-backup.{stamp}'))
env_file.write_text('\n'.join([
    'KURISU_NLU_ROLLOUT=native_agent_global',
    'KURISU_NOTIFICATIONS_ENABLE=1',
    'KURISU_NOTIFICATION_POLL_MS=5000',
    'KURISU_NOTIFICATION_SECRET_FILE=/run/secrets/kurisu_notification_secret',
    'KURISU_NOTIFICATION_PRINCIPAL_KEY=kook:digest',
    'KURISU_NOTIFICATION_LANGBOT_URL=http://langbot:5300',
    'KURISU_NOTIFICATION_LANGBOT_HEADER=X-API-Key',
    'KURISU_NOTIFICATION_LANGBOT_API_KEY_FILE=/run/secrets/langbot-api-token',
    f'KURISU_NOTIFICATION_TELEGRAM_RECIPIENT={telegram_recipient}',
    f'KURISU_NOTIFICATION_TELEGRAM_BOT_ID={telegram_bot}',
    'KURISU_NOTIFICATION_TELEGRAM_TARGET_TYPE=person',
    f'KURISU_NOTIFICATION_KOOK_RECIPIENT={kook_recipient}',
    f'KURISU_NOTIFICATION_KOOK_BOT_ID={kook_bot}',
    'KURISU_NOTIFICATION_KOOK_TARGET_TYPE=person',
    f'KURISU_NOTIFICATION_BRIEFING_KOOK_RECIPIENT={target_id}',
    f'KURISU_NOTIFICATION_BRIEFING_KOOK_BOT_ID={bot_id}',
    f'KURISU_NOTIFICATION_BRIEFING_KOOK_TARGET_TYPE={target_type}',
    'KURISU_ENABLE_WRITE_TOOLS=1',
    '',
]))
env_file.chmod(0o640)

def patch_compose(path: Path, app: str) -> Path:
    text = path.read_text()
    backup = path.with_name(path.name + f'.codex-backup.{stamp}')
    shutil.copy2(path, backup)
    if app == 'runtime':
        if '/DATA/AppData/pubg-query-engine-v3/kurisu.env' not in text:
            marker = '    env_file:\n'
            if marker not in text: raise SystemExit('runtime compose env_file block is missing')
            lines = text.splitlines(True)
            start = lines.index(marker)
            insert = start + 1
            while insert < len(lines) and lines[insert].startswith('      - '): insert += 1
            lines.insert(insert, '      - /DATA/AppData/pubg-query-engine-v3/kurisu.env\n')
            text = ''.join(lines)
        mounts = [
            '      - /DATA/AppData/n8n/secrets/codex-notify-secret:/run/secrets/kurisu_notification_secret:ro\n',
            '      - /DATA/AppData/product-radar/secrets/langbot-api-token:/run/secrets/langbot-api-token:ro\n',
        ]
        marker = '    volumes:\n'
        if marker not in text: raise SystemExit('runtime compose volumes block is missing')
        for mount in mounts:
            if mount.strip() not in text: text = text.replace(marker, marker + mount, 1)
    else:
        values = [
            '      PRODUCT_RADAR_NOTIFICATION_OWNER: central\n',
            '      PRODUCT_RADAR_KURISU_NOTIFICATION_URL: http://pubg-query-engine-v3:5310/kurisu/notifications/events\n',
            '      PRODUCT_RADAR_KURISU_NOTIFICATION_SECRET_FILE: /run/secrets/kurisu_notification_secret\n',
            '      PRODUCT_RADAR_KURISU_PRINCIPAL_KEY: kook:digest\n',
        ]
        marker = '    ports:\n'
        if marker not in text: raise SystemExit('product-radar compose ports marker is missing')
        for value in values:
            key = value.split(':', 1)[0].strip()
            if key not in text: text = text.replace(marker, value + marker, 1)
        mount = '      - /DATA/AppData/n8n/secrets/codex-notify-secret:/run/secrets/kurisu_notification_secret:ro\n'
        marker = '    volumes:\n'
        if marker not in text: raise SystemExit('product-radar compose volumes block is missing')
        if mount.strip() not in text: text = text.replace(marker, marker + mount, 1)
    path.write_text(text)
    return backup

runtime_backup = patch_compose(Path('/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml'), 'runtime')
radar_backup = patch_compose(Path('/var/lib/casaos/apps/product-radar/docker-compose.yml'), 'radar')
print(f'ROLLBACK_RUNTIME_COMPOSE={runtime_backup}')
print(f'ROLLBACK_RADAR_COMPOSE={radar_backup}')
print(f'RUNTIME_ENV={env_file}')
PY

orb -m "$MACHINE" -u root bash -lc '
  set -euo pipefail
  # Secret file permission changes are not part of the Compose config hash.
  # Runtime reads the ingress secret at process start, so force recreation is
  # required even when all compose lines are already present.
  cd /var/lib/casaos/apps/pubg-query-engine-v3 && docker compose config >/dev/null && docker compose up -d --force-recreate --no-build
  cd /var/lib/casaos/apps/product-radar && docker compose config >/dev/null && docker compose up -d --force-recreate --no-build
  for _ in $(seq 1 30); do
    curl --fail --silent --max-time 3 http://127.0.0.1:5310/healthz >/dev/null && curl --fail --silent --max-time 3 http://127.0.0.1:5315/health >/dev/null && break
    sleep 2
  done
  curl --fail --silent --max-time 5 http://127.0.0.1:5310/healthz >/dev/null
  curl --fail --silent --max-time 5 http://127.0.0.1:5315/health >/dev/null
  docker inspect pubg-query-engine-v3 --format "{{range .Config.Env}}{{println .}}{{end}}" | grep -Fx "KURISU_NOTIFICATIONS_ENABLE=1" >/dev/null
  docker inspect product-radar --format "{{range .Config.Env}}{{println .}}{{end}}" | grep -Fx "PRODUCT_RADAR_NOTIFICATION_OWNER=central" >/dev/null
  docker exec pubg-query-engine-v3 sh -lc "test -r /run/secrets/kurisu_notification_secret && test -s /run/secrets/kurisu_notification_secret"
  echo KURISU_PRODUCTION_FEATURES_CONFIGURED
'
