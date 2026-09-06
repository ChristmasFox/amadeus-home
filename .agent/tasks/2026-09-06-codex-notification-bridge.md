# Codex Global Completion Notification Bridge

状态：COMPLETE / DEPLOYED / VERIFIED（2026-09-06）。

## 必须完成

- 全局 `~/.codex/config.toml` notify 配置指向 `$CODEX_HOME`/用户全局安装的 script，不依赖 agent-monorepo cwd。
- Git source 保存 portable notify script 和安装/校验脚本；script 只传递 completion payload，带 timeout、日志和 fail-open 网络行为。
- n8n Git workflow：Webhook → Validate shared secret/completion event → Format → Telegram DM → KOOK DM。
- recipient 只从外部 `TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID` 读取，固定 `person`，不得使用 inbound chat/context/payload recipient。
- Telegram/KOOK 各自独立错误隔离，记录 `sent`/`failed`；`threadId + turnId` 去重。
- 完成 runtime/LangBot sender 接线、外部 secrets 恢复、n8n 导入/激活和双平台 smoke；不得把真实 credential 写入 Git。

## 证据

- 全局 Codex config/script 已安装并通过 `codex --strict-config` 与 `/tmp` cwd turn smoke。
- n8n workflow 已激活；shared secret、Admin variables 和 idempotency Data Table 均在仓库外恢复。
- 双平台 runtime smoke：Telegram/KOOK sent，重复请求 duplicate suppressed，非 completion/缺 secret 被拒绝。
- 受控 failure isolation：Telegram failed/KOOK sent 与 Telegram sent/KOOK failed 均通过，测试后配置已恢复。
