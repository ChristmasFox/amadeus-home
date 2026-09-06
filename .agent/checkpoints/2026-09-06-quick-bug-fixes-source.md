# 2026-09-06 Quick Bug Fixes — Source Stage

## Scope

- PUBG KD display is fixed to exactly one decimal across the TypeScript runtime, legacy V2 Python renderer, and legacy n8n daily-stats workflow. Zero-death KD remains `—`, never infinity.
- macOS NAS status now uses a versioned structured payload and mobile-friendly formatter with expanded host/system/resource/network/power/cloudflared information; disk output uses `df -Ph`.
- Telegram LangBot patch strips complete, unclosed, and isolated `<think>` markup at the outbound and streaming boundaries and suppresses think-only messages.
- HomeHub status keeps macOS host CPU/memory UNKNOWN when no macOS Host Executor exists, but explains the Docker/container boundary in Chinese and localizes executor-unavailable service rows.

## Validation

- `pnpm test`: passed, 117 passed / 1 skipped.
- `pnpm --filter @agent/agent-runtime typecheck`: passed.
- `pnpm test:legacy-v2`: passed, 31 tests.
- NAS formatter tests: passed, 4 tests.
- Telegram patch tests: passed, 4 tests.
- Live LangBot source patch smoke and idempotency: passed; full patch chain compiled against deployed source.
- `./scripts/deploy-langbot.sh --dry-run --patches`: passed.
- NAS `zsh -n` and `SSH_ORIGINAL_COMMAND=nas.status`: passed; human-readable `460Gi`/`7.3Ti` disk values observed.
- `pnpm check:secrets`: passed.
- `git diff --check`: passed.

## Production activation evidence

- Runtime image `local/pubg-query-engine-v3:git-1b52d2c89f3e` deployed; compose backup `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-132837`.
- HomeHub Docker smoke passed: socket present, 7 allowlisted containers listed, `/status` reports real service states and host metrics explicitly unavailable.
- n8n `PUBG 今日战绩` imported and active; live export confirms `toFixed(1)`; backup `/home/node/.n8n/workflow-backups/codex-pubg-daily-stats-20260830-before-20260906-132906.json`.
- LangBot patched image `local/langbot-agent:5a051b8756c4-20260906-132959` active; compose backup `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260906-133002`; live source contains the think filter.
- External NAS forced command deployed; backup `/Users/blacksidev/.local/bin/nas-control.codex-backup.20260906-132920`; real `nas.status` smoke passed and emitted human-readable `460Gi`/`7.3Ti` disk units.
- Real runtime `/v3/query`「最近20场战绩」smoke returned KD `1.5 / 0.9 / 0.7 / 0.4`, team KD `1.0`, and no `∞`/`Infinity`.
- Active LangBot virtualenv helper smoke passed for complete, unclosed, isolated, and caption think markup.
- `scripts/doctor.sh`: 0 failures / 0 warnings.

## Pending activation

The new `macos-nas-control` formatter is not installed through LangBot because no external LangBot API credential is available in the current shell. Keep the plugin API key outside Git and run the documented apply command after restoring it; never edit the runtime plugin directory directly.
