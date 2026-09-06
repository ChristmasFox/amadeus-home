# Codex Global Completion Notification Bridge

状态：后续阶段，尚未实现。

## 必须完成

- 全局 `~/.codex/config.toml` notify 配置指向 `$CODEX_HOME`/用户全局安装的 script，不依赖 agent-monorepo cwd。
- Git source 保存 portable notify script 和安装/校验脚本；script 只传递 completion payload，带 timeout、日志和 fail-open 网络行为。
- n8n Git workflow：Webhook → Validate shared secret/completion event → Format → Telegram DM → KOOK DM。
- recipient 只从外部 `TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID` 读取，固定 `person`，不得使用 inbound chat/context/payload recipient。
- Telegram/KOOK 各自独立错误隔离，记录 `sent`/`failed`；`threadId + turnId` 去重。
- 完成 runtime/LangBot sender 接线、外部 secrets 恢复、n8n 导入/激活和双平台 smoke；不得把真实 credential 写入 Git。
