# HomeHub `/whoami` platform-source fix checkpoint

日期：2026-09-05（Asia/Shanghai）

## Observed issue

用户真实消息显示：Telegram `/whoami` 返回 `platform: kook`，而
`platformUserId: 5501555095` 正确。LangBot 日志确认请求走了 command path：
`Processing request from person_5501555095 ... /whoami`，随后旧 `PersonCommandSent` event
没有平台字段，归一化层按历史兼容默认值当作 KOOK。

## Fix

- `patch_pubg_telegram_picker.py` 现在为 `PersonCommandSent`/`GroupCommandSent` 增加
  `platform` 字段，并 patch command handler 从 `query.adapter` 判定真实 source adapter。
- `PubgQueryGatewayV3Listener` 监听 command events，在 CommandManager fallback 前处理
  `/whoami`，使用同一 `NormalizedBotMessage` 和真实 `sender_id`。
- 增加 command-event Telegram/KOOK normalization regression test。
- build-time Dockerfile smoke 编译额外覆盖 command handler。

## Git

- 修复提交：`dd5785e`、`9c34a89`、`1adbc1d`。
- 部署状态文档提交：`9b604f3`、`cbd79e3`。
- `main` 已推送到 `origin/main`，source fix commit 为 `1adbc1d`。
- `pnpm check:secrets`、Python tests、patch py_compile 和 `git diff --check`：通过。

## Deployment

- canonical target：OrbStack `ubuntu` / CasaOS。
- LangBot image：`local/langbot-agent:1adbc1d-whoami-display-20260905`。
- image id：`sha256:70dce1500ae2`（build result；以 Docker inspect 为准）。
- active compose：`/var/lib/casaos/apps/langbot/docker-compose.yml`。
- compose backup：`/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260905-222807`。
- runtime image remains `local/pubg-query-engine-v3:3.3.3-whoami-ddfee46` and healthy.
- plugin `local/pubg-stats` version `3.2.4` reinstalled via `deploy-langbot.sh --apply`, task `12`, `INSTALL_READY`。
- `scripts/doctor.sh`：0 failure、0 warning。

## Verification

- Running container source contains patched `PersonCommandSent.platform` and
  `_pubg_command_platform` logic; both patched command/event files pass `py_compile`。
- Existing synthetic normalization test passes: Telegram command event remains `platform=telegram`
  and KOOK remains `platform=kook`。
- Runtime `/v3/whoami` remains read-only and returns correct structured data。
- 尚未由真实 Telegram 用户在修复后再次发送 `/whoami`；该项必须人工确认，不能用 bot 自发消息替代。

## Rollback

```sh
orb -m ubuntu -u root bash -lc 'cp -p /var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260905-222807 /var/lib/casaos/apps/langbot/docker-compose.yml && cd /var/lib/casaos/apps/langbot && docker compose up -d'
```

## Next step

请在 Telegram 私聊再次发送 `/whoami`，确认返回 `platform: telegram`；随后再进行 KOOK
私聊/频道复测。
