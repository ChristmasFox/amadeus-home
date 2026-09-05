#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_ONLY=0
INIT_ENV="${INIT_ENV:-0}"

usage() {
  cat <<'EOF'
用法: scripts/bootstrap.sh [--check] [--dry-run] [--init-env]

--check / --dry-run 只检查，不安装依赖或修改本地文件。
--init-env          缺少 .env 时从 .env.example 创建本地占位配置。
EOF
}

for argument in "$@"; do
  case "$argument" in
    --check|--dry-run) CHECK_ONLY=1 ;;
    --init-env) INIT_ENV=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf '未知参数: %s\n' "$argument" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$CHECK_ONLY" -eq 1 ]; then
  printf '%s\n' 'Bootstrap check mode: no installation or local configuration changes.'
fi

missing=0
note_missing() {
  printf 'MISSING: %s\n' "$1"
  missing=$((missing + 1))
}

check_command() {
  local command_name="$1"
  if command -v "$command_name" >/dev/null 2>&1; then
    printf 'OK: %s (%s)\n' "$command_name" "$("$command_name" --version 2>/dev/null | head -n 1 || true)"
    return 0
  fi
  note_missing "$command_name"
  return 1
}

install_formula_if_missing() {
  local formula="$1"
  local command_name="$2"
  if command -v "$command_name" >/dev/null 2>&1; then
    return 0
  fi
  if [ "$CHECK_ONLY" -eq 1 ]; then
    note_missing "$command_name (brew formula: $formula)"
    return 0
  fi
  brew install "$formula"
}

install_cask_if_missing() {
  local cask="$1"
  local command_name="$2"
  if command -v "$command_name" >/dev/null 2>&1; then
    return 0
  fi
  if [ "$CHECK_ONLY" -eq 1 ]; then
    note_missing "$command_name (brew cask: $cask)"
    return 0
  fi
  brew install --cask "$cask"
}

os_name="$(uname -s)"
printf 'Platform: %s\n' "$os_name"

if [ "$os_name" = "Darwin" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    if [ "$CHECK_ONLY" -eq 1 ]; then
      note_missing 'Homebrew'
    else
      printf '%s\n' 'Installing Homebrew from the official installer...'
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
  fi

  if command -v brew >/dev/null 2>&1; then
    install_formula_if_missing git git
    install_formula_if_missing node node
    install_formula_if_missing pnpm pnpm
    install_formula_if_missing tmux tmux
    install_formula_if_missing cloudflared cloudflared
    install_cask_if_missing orbstack orb
  fi
else
  check_command git || true
  check_command node || true
  check_command pnpm || true
  check_command tmux || true
  check_command cloudflared || true
  check_command docker || true
  printf '%s\n' 'Linux dependencies are not installed automatically; use the distribution package manager and Docker-compatible runtime.'
fi

if command -v node >/dev/null 2>&1 && ! command -v pnpm >/dev/null 2>&1 && [ "$CHECK_ONLY" -eq 0 ]; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@9.9.0 --activate
  else
    npm install --global pnpm@9.9.0
  fi
fi

if command -v pnpm >/dev/null 2>&1; then
  printf 'OK: pnpm %s\n' "$(pnpm --version)"
  if [ "$CHECK_ONLY" -eq 0 ] && [ -f "$REPO_ROOT/pnpm-lock.yaml" ]; then
    (cd "$REPO_ROOT" && pnpm install --frozen-lockfile)
  fi
else
  note_missing 'pnpm 9.9.x'
fi

if command -v orb >/dev/null 2>&1; then
  printf '%s\n' 'OK: OrbStack CLI detected; canonical deployment target is machine ubuntu.'
else
  printf '%s\n' 'WARN: orb is unavailable; install/start OrbStack before running CasaOS services.'
fi

if command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'OK: Docker CLI detected; use it through OrbStack ubuntu for persistent services.'
else
  printf '%s\n' 'WARN: Docker CLI is unavailable; OrbStack normally provides it on macOS.'
fi

if [ "$INIT_ENV" -eq 1 ] && [ "$CHECK_ONLY" -eq 0 ] && [ ! -e "$REPO_ROOT/.env" ]; then
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
  chmod 600 "$REPO_ROOT/.env"
  printf '%s\n' 'Created local .env from .env.example; fill secrets out-of-band.'
fi

if [ "$missing" -gt 0 ]; then
  printf 'Bootstrap completed with %s missing dependency check(s).\n' "$missing" >&2
  exit 1
fi

printf '%s\n' 'Bootstrap dependency checks passed.'
