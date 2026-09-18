# OpenClaw Identity reply metadata bridge（本地 follow-up）

日期：2026-09-18（Asia/Shanghai）
状态：IMPLEMENTED_LOCAL_RELEASE_PENDING

## 变更

- `plugins/amadeus` 使用 pinned OpenClaw 2026.9.4 的 typed `api.on("before_dispatch")`
  捕获 `replyToSender`、channel、account、conversation 和 session metadata。
- 只把 channel-native sender id 放入按 session 隔离、5 分钟 TTL 的进程内 bridge；不保存正文、
  display name 或完整消息。`agent_end` 清理该 session，显式 `toolBindings.identity.replySender`
  仍优先。
- 没有可信 channel/reply id 时删除旧 bridge，Identity 继续返回
  `trusted_reply_sender_metadata_unavailable`；mention 仍只读取结构化 host binding，不从昵称或
  prompt 推断。

## 本地证据

- `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm check:secrets`：PASS。
- `@agent/amadeus-plugin` 6 tests PASS，覆盖 typed hook registration、reply session isolation、
  owner gate、alias candidate/confirmation 和 provider account link。
- `python3 -m py_compile scripts/openclaw_prepare.py`、`bash -n scripts/deploy-openclaw.sh`、
  `git diff --check`：PASS。

## 尚未完成

- 源码 follow-up 尚未重新 build/apply 到 CasaOS；现有线上 image 仍是前一 checkpoint 的
  `git-05471a8618f1-20260918091819`。
- 仍需真实 Telegram/WhatsApp 私聊和群聊入站，验证 reply binding、mention binding、PUBG
  account/link、alias candidate/confirm 和重启后非空 SQLite 持久化；不得用伪造 ID、mock、health
  或 provider trace 冒充真实平台验收。
