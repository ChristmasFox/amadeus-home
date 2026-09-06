# Codex Global Completion Notification Bridge checkpoint

日期：2026-09-06（Asia/Shanghai）

## 交付

- 全局配置 `/Users/blacksidev/.codex/config.toml` 的 root-level `notify` 指向
  `/Users/blacksidev/.codex/bin/codex-notify.sh`；Git source 为 `integrations/codex/codex-notify.sh`。
- notify script 兼容 Codex legacy argv payload（当前 `type=agent-turn-complete` + hyphenated keys），归一化
  event/threadId/turnId/cwd/projectName/lastAssistantMessage/timestamp；非 completion 过滤、2s connect/5s
  total timeout、secret-safe logging、network fail-open。
- n8n workflow source `integrations/n8n/workflows/codex-completion-notification.workflow.json`，生产
  ID `codex-completion-notification-20260906`，Webhook `/webhook/codex-complete`，已激活。
- n8n external Data Table `codex-completion-idempotency-20260906` 的 `eventKey` 唯一索引实现
  `threadId + turnId` at-most-once；shared secret 和 Admin IDs 通过外部文件/global variables 恢复。
- Telegram/KOOK 两个 LangBot outbound sender 固定 `target_type: person`，只读取
  `TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID`，不读取 payload recipient/chat/channel；两个节点
  `continueOnFail`，分别记录 sent/failed。

## 验证

- `codex --strict-config --help`：通过。
- `scripts/smoke-codex-notify.sh`：通过（argv/stdin normalization、event filter、redaction、timeout/fail-open、log safety）。
- `scripts/test-codex-notification-workflow.sh`：通过（workflow topology、fixed person target、idempotency、independent delivery recorder）。
- `scripts/smoke-codex-notification-runtime.sh`：通过（缺 secret rejected、双平台 sent、cwd-derived project、duplicate suppressed）。
- 真实 global `codex exec` from `/tmp`：Codex exit 0，n8n execution recorded `telegram=sent`、`kook=sent`。
- 受控 failure isolation：Telegram failed/KOOK sent；Telegram sent/KOOK failed；随后 Admin IDs/shared secret
  与原外部配置匹配恢复。
- `pnpm check:secrets` 与 `git diff --check`：通过。

## 外部恢复/回滚

- notify secret files：`~/.codex/secrets/codex-notify-secret`、`/DATA/AppData/n8n/secrets/codex-notify-secret`，值不入 Git。
- LangBot API credential `LangBot API` 由目标 n8n 重新绑定。
- 最后 workflow rollback backup：`/home/node/.n8n/workflow-backups/codex-codex-completion-notification-20260906-before-20260906-114742.json`。
- n8n DB/Data Table/variables backups 均留在 `/DATA/AppData/n8n` 外部运行时路径；不上传公共仓库。

GOAL STATUS: COMPLETE
