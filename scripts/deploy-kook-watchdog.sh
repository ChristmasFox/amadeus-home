#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE="ubuntu"
REMOTE_REPO="${KOOK_WATCHDOG_REMOTE_REPO:-/Users/blacksidev/agent-monorepo}"
APPLY=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/deploy-kook-watchdog.sh [--dry-run] [--apply] [--machine <name>]

The default is a dry-run. --apply installs the repository watchdog and its
systemd timer into the CasaOS machine, enables the timer, and runs one immediate
probe. It does not build or recreate the LangBot image.
USAGE
}

fail() {
  printf '%s\n' "$*" >&2
  exit 2
}

while (($#)); do
  case "$1" in
    --dry-run)
      APPLY=0
      ;;
    --apply)
      APPLY=1
      ;;
    --machine)
      (($# >= 2)) || fail '--machine requires a value.'
      MACHINE="$2"
      shift
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

WATCHDOG_SOURCE="$ROOT_DIR/scripts/kook_watchdog.py"
SERVICE_SOURCE="$ROOT_DIR/infra/systemd/kook-watchdog.service"
TIMER_SOURCE="$ROOT_DIR/infra/systemd/kook-watchdog.timer"

for source in "$WATCHDOG_SOURCE" "$SERVICE_SOURCE" "$TIMER_SOURCE"; do
  [ -f "$source" ] || fail "Missing deployment source: $source"
done

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf 'MACHINE=%s\n' "$MACHINE"
printf 'REMOTE_REPO=%s\n' "$REMOTE_REPO"
printf '%s\n' 'INSTALL_TARGET=/usr/local/libexec/kook-watchdog.py,/etc/systemd/system/kook-watchdog.service,/etc/systemd/system/kook-watchdog.timer'
printf '%s\n' 'POLICY=3 consecutive offline probes; 15 minute cooldown; max 3 restarts per 6 hours'

if ((APPLY == 0)); then
  printf '%s\n' 'PLAN=install root-owned watchdog, enable timer, run one live probe; no image build or LangBot compose recreation.'
  exit 0
fi

command -v orb >/dev/null 2>&1 || fail 'orb command is required for CasaOS deployment.'

remote_repo="$(printf '%q' "$REMOTE_REPO")"
backup_stamp="$(date +%Y%m%d-%H%M%S)"
orb -m "$MACHINE" -u root bash -lc "
  set -Eeuo pipefail
  repo=$remote_repo
  source_script=\"\$repo/scripts/kook_watchdog.py\"
  source_service=\"\$repo/infra/systemd/kook-watchdog.service\"
  source_timer=\"\$repo/infra/systemd/kook-watchdog.timer\"
  test -f \"\$source_script\"
  test -f \"\$source_service\"
  test -f \"\$source_timer\"

  install -d -o root -g root -m 0755 /usr/local/libexec
  install -d -o root -g root -m 0700 /DATA/AppData/langbot/monitoring

  backup_dir=/var/lib/casaos/backups/kook-watchdog.codex-$backup_stamp
  backup_needed=0
  for target in /usr/local/libexec/kook-watchdog.py /etc/systemd/system/kook-watchdog.service /etc/systemd/system/kook-watchdog.timer; do
    if [ -e \"\$target\" ]; then
      if [ \"\$backup_needed\" -eq 0 ]; then
        install -d -o root -g root -m 0700 \"\$backup_dir\"
        backup_needed=1
      fi
      cp -p \"\$target\" \"\$backup_dir/\"
    fi
  done
  if [ \"\$backup_needed\" -eq 1 ]; then
    echo \"BACKUP_DIR=\$backup_dir\"
  fi

  install -o root -g root -m 0755 \"\$source_script\" /usr/local/libexec/kook-watchdog.py
  install -o root -g root -m 0644 \"\$source_service\" /etc/systemd/system/kook-watchdog.service
  install -o root -g root -m 0644 \"\$source_timer\" /etc/systemd/system/kook-watchdog.timer
  systemctl daemon-reload
  systemctl enable --now kook-watchdog.timer
  systemctl start kook-watchdog.service
  systemctl is-enabled kook-watchdog.timer
  systemctl is-active kook-watchdog.timer
"

printf '%s\n' 'Deployment completed: the timer is enabled and one immediate watchdog run was requested.'
