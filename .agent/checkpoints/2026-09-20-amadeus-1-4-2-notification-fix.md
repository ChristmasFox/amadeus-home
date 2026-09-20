# Amadeus deployment notification fix checkpoint

日期：2026-09-20（Asia/Shanghai）

## Root cause

- `scripts/deploy-openclaw.sh` 初次 1.4.2 部署只把 `owner_notification` 写入外部 checkpoint 的 `owner-smoke` 目录。
- `OWNER_SMOKE=queued` / `OWNER_OUTBOX_SMOKE=passed` 只证明 checkpoint 合同文件存在，不是生产 outbox 入队，也不是 WhatsApp delivery evidence。
- 因此部署健康检查全部通过，但没有触发 owner notification worker。

## Source fix

- `scripts/notify-owner.sh` 支持 severity、significance、formal theme、version fact 和 closing 字段，并保持 event-key 幂等。
- `scripts/deploy-openclaw.sh` 在 health/preflight 成功后同时写入 checkpoint evidence 和生产 `/DATA/AppData/openclaw/notifications`，然后等待 `.sent.json`；30 秒内未发送会明确失败。
- `scripts/test-notify-owner.sh` 与 `pnpm test:notify-owner` 覆盖 structured event、Worldline closing 和重复 event-key 不重复入队。

## Live follow-up evidence

- 用户明确要求后，`amadeus-release:1.4.2:manual-resend` 已进入固定 owner WhatsApp DM，并产生 `.sent.json`。
- WhatsApp status：connected / healthy。
- 本次只补发 owner 私聊，不发送群聊。
