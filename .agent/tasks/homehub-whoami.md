# HomeHub `/whoami` 待办

状态：已完成（代码与本地验证）；真实 Telegram/KOOK 入站烟测仍待目标环境任务。

## 目标

- [x] 实现只读 `/whoami` 命令，支持 Telegram 和 KOOK 的私聊、群聊/频道，并通过现有
  `NormalizedBotMessage`、`IdentityRegistry`、`Context`、`Presentation` 和平台 Adapter
  返回结构化身份信息。

## 必须满足

- [x] `platformUserId` 必须来自平台事件中的真实稳定用户 ID：Telegram `from.id`、KOOK
  `author_id`；不得使用 nickname、displayName 或 username 作为身份依据。
- [x] 未绑定时返回 `internalUser: unbound`，并明确返回 `role: unbound` 或 `PUBLIC`，不得猜测身份。
- [x] 命令不得写数据库、绑定账号、授予权限、执行 Action 或调用危险工具。
- [x] 补充 Telegram 私聊/群聊、KOOK 私聊/频道、同昵称不同 userId、无状态修改测试。

## 完成协议

已更新 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md`、`.agent/state.md` 并写入日期
checkpoint；匹配测试、`pnpm check:secrets` 和 `git diff --check` 已通过。
