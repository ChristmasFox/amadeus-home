#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$REPO_ROOT"
MACHINE="$ORBSTACK_MACHINE"
if [ -d /Volumes/Avalon ]; then
  DEFAULT_BACKUP_ROOT="/Volumes/Avalon/backups/agent-monorepo"
else
  DEFAULT_BACKUP_ROOT="$REPO_ROOT/.backups"
fi
BACKUP_ROOT="${BACKUP_ROOT:-$DEFAULT_BACKUP_ROOT}"
BACKUP_APP_DIRS="${BACKUP_APP_DIRS:-openclaw product-radar 9router immich changedetection media-organizer-adapter}"
INCLUDE_SECRETS=0
DRY_RUN=0

usage() {
  cat <<'EOF'
用法: scripts/backup.sh [选项]

默认从 host profile 指定的 OrbStack machine 的 /DATA/AppData 读取项目和兼容性数据，并在仓库外
/Volumes/Avalon/backups/agent-monorepo 创建归档；没有共享卷时使用
仓库内被忽略的 .backups/。

选项:
  --include-secrets       调用加密 secrets export（需要 Git 外的 passphrase file）
  --backup-root PATH      覆盖归档目录
  --apps "a b c"          覆盖要备份的 AppData 目录
  --machine NAME          覆盖 OrbStack machine，默认取 host profile（ubuntu）
  --dry-run               只显示计划，不读取或写入数据
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --include-secrets) INCLUDE_SECRETS=1 ;;
    --backup-root)
      shift
      [ "$#" -gt 0 ] || { printf '%s\n' '--backup-root requires a path' >&2; exit 2; }
      BACKUP_ROOT="$1"
      ;;
    --apps)
      shift
      [ "$#" -gt 0 ] || { printf '%s\n' '--apps requires a space-separated list' >&2; exit 2; }
      BACKUP_APP_DIRS="$1"
      ;;
    --machine)
      shift
      [ "$#" -gt 0 ] || { printf '%s\n' '--machine requires a name' >&2; exit 2; }
      MACHINE="$1"
      ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf '未知参数: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if ! command -v orb >/dev/null 2>&1; then
  printf '%s\n' 'OrbStack CLI not found; backups must run from a host with orb access.' >&2
  exit 1
fi

read -r -a app_names <<< "$BACKUP_APP_DIRS"
if [ "${#app_names[@]}" -eq 0 ]; then
  printf '%s\n' 'No AppData directories selected.' >&2
  exit 2
fi
for app in "${app_names[@]}"; do
  case "$app" in
    ''|*[!A-Za-z0-9_-]*)
      printf 'Invalid AppData directory name: %s\n' "$app" >&2
      exit 2
      ;;
  esac
done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive_dir="$BACKUP_ROOT/$stamp"
data_archive="$archive_dir/data-$stamp.tar.gz"
secret_bundle_ref='not-created'
manifest="$archive_dir/manifest.txt"

printf 'Backup plan\n'
printf '  machine: %s\n' "$MACHINE"
printf '  app data: %s\n' "$BACKUP_APP_DIRS"
printf '  destination: %s\n' "$archive_dir"
printf '  include secrets: %s\n' "$INCLUDE_SECRETS"

if [ "$DRY_RUN" -eq 1 ]; then
  exit 0
fi

mkdir -p "$archive_dir"
chmod 700 "$archive_dir"

# Stream the archive from Ubuntu so the host never needs direct access to /DATA.
orb -m "$MACHINE" -u root bash -lc '
set -Eeuo pipefail
for app in "$@"; do
  if [ -e "/DATA/AppData/$app" ]; then
    printf "%s\n" "$app"
  fi
done | tar --exclude="*/secrets/*" --exclude="*/.env" --exclude="*.env" --exclude="*/secret*" -C /DATA/AppData -czf - -T -
' _ "${app_names[@]}" > "$data_archive"
chmod 600 "$data_archive"

if [ "$INCLUDE_SECRETS" -eq 1 ]; then
  [[ -n "$SKULD_SECRET_PASSPHRASE_FILE" ]] || { printf '%s\n' 'SKULD_SECRET_PASSPHRASE_FILE is required for --include-secrets.' >&2; exit 2; }
  secret_output="$(SKULD_BACKUP_ROOT="$BACKUP_ROOT" bash "$REPO_ROOT/scripts/export-skuld-secrets.sh" --apply --passphrase-file "$SKULD_SECRET_PASSPHRASE_FILE" --output-dir "$BACKUP_ROOT")"
  secret_bundle_ref="$(printf '%s\n' "$secret_output" | sed -n 's/^SECRET_BUNDLE=//p')"
  [[ -n "$secret_bundle_ref" ]] || { printf '%s\n' 'encrypted secret bundle path was not returned' >&2; exit 1; }
fi

repo_commit="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || printf '%s' 'uncommitted')"
{
  printf 'created_at_utc=%s\n' "$stamp"
  printf 'repo_commit=%s\n' "$repo_commit"
  printf 'machine=%s\n' "$MACHINE"
  printf 'app_data=%s\n' "$BACKUP_APP_DIRS"
  printf 'data_archive=%s\n' "$(basename "$data_archive")"
  printf 'encrypted_secret_bundle=%s\n' "$secret_bundle_ref"
  printf 'immich_media_policy=external-protected-media-is-not-tarred\n'
  printf 'immich_media_root=%s\n' "$IMMICH_MEDIA_ROOT"
  printf 'external_storage_root=%s\n' "$EXTERNAL_STORAGE_ROOT"
  printf 'external_storage_volume_uuid=%s\n' "${EXTERNAL_STORAGE_VOLUME_UUID:-unconfigured}"
  printf 'note=Redis/model cache are rebuildable; Immich PostgreSQL, 9Router data, changedetection state, and media-adapter state are included when present.\n'
} > "$manifest"
chmod 600 "$manifest"

python3 - "$archive_dir/backup-manifest.json" "$stamp" "$repo_commit" "$BACKUP_APP_DIRS" "$IMMICH_MEDIA_ROOT" "$EXTERNAL_STORAGE_VOLUME_UUID" "$secret_bundle_ref" <<'PY'
import json
import os
import subprocess
import sys
from pathlib import Path

target, stamp, commit, apps, media_root, volume_uuid, secret_bundle = sys.argv[1:]
def guest_value(command):
    try:
        return subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return None
machine = os.environ.get('ORBSTACK_MACHINE', 'ubuntu')
media_bytes = guest_value(['orb', '-m', machine, '-u', 'root', 'du', '-sx', '--apparent-size', '--block-size=1', '/DATA/Gallery/immich'])
media_files = guest_value(['orb', '-m', machine, '-u', 'root', 'bash', '-lc', "find /DATA/Gallery/immich -type f -printf '\\n' | wc -l"])
try:
    media_file_count = int(media_files or '0')
except ValueError:
    media_file_count = 0
Path(target).write_text(json.dumps({
    'schemaVersion': 1,
    'createdAtUtc': stamp,
    'repoCommit': commit,
    'apps': apps.split(),
    'immichMedia': {
        'root': media_root,
        'volumeUuid': volume_uuid or None,
        'sourceBytes': int((media_bytes or '0').split()[0]),
        'fileCount': media_file_count,
        'portableArchive': False,
    },
    'encryptedSecretBundle': secret_bundle,
}, ensure_ascii=False, indent=2) + '\n')
PY
chmod 600 "$archive_dir/backup-manifest.json"

printf 'Data archive: %s\n' "$data_archive"
printf 'Manifest: %s\n' "$manifest"
if [ "$INCLUDE_SECRETS" -eq 1 ]; then
  printf 'Encrypted secret bundle: %s\n' "$secret_bundle_ref"
fi
