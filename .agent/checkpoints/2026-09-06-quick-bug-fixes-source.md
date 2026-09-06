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

## Pending activation

Source changes still require a clean commit before RELEASE actions. Runtime image, LangBot patched image, n8n workflow import, and external NAS forced-command installation are handled by explicit apply commands. No credentials are stored in Git.
