#!/usr/bin/env bash
set -Eeuo pipefail

MACHINE="${ORBSTACK_MACHINE:-ubuntu}"
ARCHIVE=""
CONFIRM=0
DRY_RUN=0
ALLOW_RUNNING=0
INCLUDE_SECRETS=0

usage() {
  cat <<'EOF'
用法: scripts/restore.sh [选项] ARCHIVE.tar.gz

归档会先做路径安全校验；默认只显示预览。真正恢复必须显式使用
--confirm，并且目标服务必须已停止。

选项:
  --confirm                确认写入 /DATA/AppData
  --include-secrets        标记这是单独的 secrets 归档
  --allow-running          允许在服务运行时恢复（不推荐）
  --machine NAME           覆盖 OrbStack machine，默认 ubuntu
  --dry-run                只校验归档，不执行远端操作
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --confirm) CONFIRM=1 ;;
    --include-secrets) INCLUDE_SECRETS=1 ;;
    --allow-running) ALLOW_RUNNING=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --machine)
      shift
      [ "$#" -gt 0 ] || { printf '%s\n' '--machine requires a name' >&2; exit 2; }
      MACHINE="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    -*)
      printf '未知参数: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
    *)
      [ -z "$ARCHIVE" ] || { printf '%s\n' 'Only one archive may be supplied.' >&2; exit 2; }
      ARCHIVE="$1"
      ;;
  esac
  shift
done

[ -n "$ARCHIVE" ] || { usage >&2; exit 2; }
[ -f "$ARCHIVE" ] || { printf 'Archive not found: %s\n' "$ARCHIVE" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { printf '%s\n' 'tar is required.' >&2; exit 1; }

entry_list="$(mktemp "${TMPDIR:-/tmp}/agent-monorepo-restore-entries.XXXXXX")"
trap 'rm -f "$entry_list"' EXIT
tar -tzf "$ARCHIVE" > "$entry_list"

if awk '
  /^\// || /(^|\/)\.\.(\/|$)/ || /^-/ { bad = 1 }
  END { exit bad ? 0 : 1 }
' "$entry_list"; then
  printf '%s\n' 'Archive contains an absolute, traversal, or option-like path.' >&2
  exit 1
fi

printf 'Restore plan\n'
printf '  machine: %s\n' "$MACHINE"
printf '  archive: %s\n' "$ARCHIVE"
printf '  secrets archive: %s\n' "$INCLUDE_SECRETS"
printf '  entries: %s\n' "$(wc -l < "$entry_list" | tr -d ' ')"
sed -n '1,80p' "$entry_list"

if [ "$DRY_RUN" -eq 1 ] || [ "$CONFIRM" -eq 0 ]; then
  printf '%s\n' 'Preview only. Add --confirm after stopping the target services to restore.'
  exit 0
fi

command -v orb >/dev/null 2>&1 || { printf '%s\n' 'OrbStack CLI not found.' >&2; exit 1; }

if [ "$ALLOW_RUNNING" -eq 0 ]; then
  running="$(orb -m "$MACHINE" -u root docker ps --format '{{.Names}}' 2>/dev/null || true)"
  if printf '%s\n' "$running" | awk '$1 == "langbot" || $1 == "n8n" || $1 == "pubg-query-engine-v3" || $1 == "langbot_plugin_runtime" { found = 1 } END { exit found ? 0 : 1 }'; then
    printf '%s\n' 'Target services are running. Stop them first or pass --allow-running explicitly.' >&2
    exit 1
  fi
fi

restore_command='
set -Eeuo pipefail
staging="$(mktemp -d /tmp/agent-monorepo-restore.XXXXXX)"
trap "rm -rf \"$staging\"" EXIT
tar --no-same-owner --no-same-permissions -xzf - -C "$staging"
mkdir -p /DATA/AppData
cp -a "$staging"/. /DATA/AppData/
'

if [ "$INCLUDE_SECRETS" -eq 1 ]; then
  printf '%s\n' 'Restoring secret files; verify archive permissions and rotate if provenance is uncertain.'
fi
orb -m "$MACHINE" -u root bash -lc "$restore_command" < "$ARCHIVE"
printf '%s\n' 'Restore completed. Run scripts/doctor.sh before starting the application stack.'
