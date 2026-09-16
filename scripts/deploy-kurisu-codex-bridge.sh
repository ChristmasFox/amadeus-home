#!/usr/bin/env bash
set -euo pipefail

APPLY=0
while (($#)); do
  case "$1" in --apply) APPLY=1;; --dry-run) ;; *) echo "Usage: $0 [--dry-run|--apply]" >&2; exit 2;; esac
  shift
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_ID="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/com.local.homehub.mac-host-agent.plist"
TOKEN_FILE="/Users/Shared/HomeHub/mac-host-agent.token"
WORKTREE_ROOT="/Users/Shared/HomeHub/kurisu-codex-worktrees"
CODEX_BIN="${KURISU_CODEX_COMMAND:-$HOME/.nvm/versions/node/v22.20.0/bin/codex}"

printf 'MODE=%s\n' "$([[ $APPLY -eq 1 ]] && printf apply || printf dry-run)"
printf '%s\n' 'PLAN=configure the existing authenticated macOS HostAgent with one agent-monorepo worktree registry and the installed Codex App Server; no shell or arbitrary cwd endpoint is added.'
[[ -x "$CODEX_BIN" ]] || { echo 'Configured Codex CLI is unavailable.' >&2; exit 1; }
[[ -s "$TOKEN_FILE" ]] || { echo 'MacHostAgent token is unavailable.' >&2; exit 1; }
if ((APPLY == 0)); then exit 0; fi

mkdir -p "$WORKTREE_ROOT"
chmod 700 "$WORKTREE_ROOT"
backup="$PLIST.codex-backup.$(date +%Y%m%d-%H%M%S)"
[[ -f "$PLIST" ]] && cp "$PLIST" "$backup"
python3 - "$PLIST" "$ROOT_DIR" "$TOKEN_FILE" "$WORKTREE_ROOT" "$CODEX_BIN" <<'PY'
import plistlib, sys
path, root, token, worktrees, codex = sys.argv[1:]
payload = {
 'Label':'com.local.homehub.mac-host-agent',
 'ProgramArguments':['/opt/homebrew/bin/python3', f'{root}/infra/macos/mac_host_agent.py', '--host','0.0.0.0','--port','49152','--token-file',token,'--codex-project-id','agent-monorepo','--codex-project-root',root,'--codex-worktree-root',worktrees,'--codex-command',codex],
 'EnvironmentVariables':{'MAC_HOST_AGENT_TOKEN_FILE':token}, 'RunAtLoad':True, 'KeepAlive':True,
 'StandardOutPath':'/Users/Shared/HomeHub/mac-host-agent.stdout.log', 'StandardErrorPath':'/Users/Shared/HomeHub/mac-host-agent.stderr.log',
}
with open(path,'wb') as f: plistlib.dump(payload,f)
PY
launchctl bootout "gui/$USER_ID/com.local.homehub.mac-host-agent" 2>/dev/null || true
launchctl bootstrap "gui/$USER_ID" "$PLIST"
for _ in $(seq 1 20); do
  result="$(curl --silent --max-time 3 -H "Authorization: Bearer $(<"$TOKEN_FILE")" http://127.0.0.1:49152/v1/codex/health || true)"
  [[ "$result" == *'"enabled":true'* ]] && break
  sleep 1
done
[[ "$result" == *'"enabled":true'* ]] || { echo 'Codex bridge did not become ready.' >&2; exit 1; }
printf 'CODEX_BRIDGE_READY\n'
[[ -n "${backup:-}" ]] && printf 'ROLLBACK_PLIST=%s\n' "$backup"
