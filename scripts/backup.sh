#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
if [ -d /Volumes/Avalon ]; then
  DEFAULT_BACKUP_ROOT="/Volumes/Avalon/backups/agent-monorepo"
else
  DEFAULT_BACKUP_ROOT="$REPO_ROOT/.backups"
fi
BACKUP_ROOT="${BACKUP_ROOT:-$DEFAULT_BACKUP_ROOT}"
BACKUP_APP_DIRS="${BACKUP_APP_DIRS:-langbot n8n n8n-sandbox pubg-query-engine-v3}"
INCLUDE_SECRETS=0
DRY_RUN=0

usage() {
  cat <<'EOF'
用法: scripts/backup.sh [选项]

默认从 OrbStack ubuntu 的 /DATA/AppData 读取项目数据，并在仓库外
/Volumes/Avalon/backups/agent-monorepo 创建归档；没有共享卷时使用
仓库内被忽略的 .backups/。

选项:
  --include-secrets       额外生成单独的 secrets-*.tar.gz（权限 0600）
  --backup-root PATH      覆盖归档目录
  --apps "a b c"          覆盖要备份的 AppData 目录
  --machine NAME          覆盖 OrbStack machine，默认 ubuntu
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
secret_archive="$archive_dir/secrets-$stamp.tar.gz"
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
  printf '%s\n' 'Writing a separate secrets archive; keep it offline and encrypted at rest.'
  orb -m "$MACHINE" -u root bash -lc '
set -Eeuo pipefail
for app in "$@"; do
  root="/DATA/AppData/$app"
  [ -e "$root/.env" ] && printf "%s\n" "$app/.env"
  for candidate in "$root"/*.env; do
    [ -e "$candidate" ] || continue
    relative="${candidate#/DATA/AppData/}"
    printf "%s\n" "$relative"
  done
  [ -d "$root/secrets" ] && printf "%s\n" "$app/secrets"
done | tar --ignore-failed-read -C /DATA/AppData -czf - -T -
' _ "${app_names[@]}" > "$secret_archive"
  chmod 600 "$secret_archive"
fi

repo_commit="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || printf '%s' 'uncommitted')"
{
  printf 'created_at_utc=%s\n' "$stamp"
  printf 'repo_commit=%s\n' "$repo_commit"
  printf 'machine=%s\n' "$MACHINE"
  printf 'app_data=%s\n' "$BACKUP_APP_DIRS"
  printf 'data_archive=%s\n' "$(basename "$data_archive")"
  printf 'secrets_archive=%s\n' "$([ "$INCLUDE_SECRETS" -eq 1 ] && basename "$secret_archive" || printf '%s' 'not-created')"
  printf 'note=Redis is rebuildable cache; add its AppData explicitly with --apps if a full local snapshot is required.\n'
} > "$manifest"
chmod 600 "$manifest"

printf 'Data archive: %s\n' "$data_archive"
printf 'Manifest: %s\n' "$manifest"
if [ "$INCLUDE_SECRETS" -eq 1 ]; then
  printf 'Secrets archive: %s\n' "$secret_archive"
fi
