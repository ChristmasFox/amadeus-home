# PUBG review Telegram oversized message hotfix checkpoint

日期：2026-09-06（Asia/Shanghai）
Git source：`cfaaacd`（patch source；基于 `25d4535`）
LangBot image：`local/langbot-agent:cfaaacd35b87-20260906-233604`
状态：DEPLOYED / VERIFIED

## Incident

在 2026-09-06 23:26–23:27（Asia/Shanghai）发送复盘请求时，runtime 已返回 4,278 字符的完整报告，但 LangBot PUBG Telegram adapter 把 runtime `messages` 数组合并成一个 `reply_message_chain`。Telegram 最终拒绝单条 `send_message`：`BadRequest: Message is too long`，原有 transient retry 反复重试但无法成功。

## Fix

- Git patch `integrations/langbot/patches/patch_pubg_telegram_picker.py` 的 Telegram `reply_message` 现在在最终 Markdown/text 转换后按 3,800 字符安全阈值切分。
- 多个 chunk 顺序发送；reply markup 和 quote origin 只挂在第一段，避免重复键盘和重复引用。
- `patch_telegram_adapter.py` 的原有 entity/think 过滤和 retry 行为保持不变。
- patch source 通过 Python compile、patch tests；LangBot image build 的 patch py_compile 通过。

## Deployment

- Base image：`local/langbot-agent:7df513bdcd27-20260906-183935`。
- Active compose rollback：`/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260906-233608`。
- Active `langbot` 与 `langbot_plugin_runtime` 都已切换到上述 immutable image 并运行。
- `pubg-stats 3.3.0` 仍由 API task `14` 保持 `INSTALL_READY`。

## Verification

- Active container source contains `split_content` and the 3,800-character threshold.
- In-container active split smoke returned `[3600, 600]` for a 4,200-character sample; max chunk <= 3,800 and content preserved.
- `pubg-query-engine-v3` remains healthy on `local/pubg-query-engine-v3:git-2f6a63b013ff`.
- Runtime `/healthz` and `/homehub/health`, `scripts/doctor.sh`, and prior direct Match ID review smoke remain healthy.
- No new real Telegram user message was sent by Codex; final inbound confirmation remains user-side.

## Rollback

Restore LangBot compose backup `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260906-233608` and run `docker compose up -d --no-build` in the CasaOS app directory. Runtime and n8n rollback points remain in `.agent/checkpoints/2026-09-06-pubg-review-v1-deployment.md`.
