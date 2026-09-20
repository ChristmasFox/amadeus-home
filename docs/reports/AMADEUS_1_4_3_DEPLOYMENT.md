# Amadeus 1.4.3 deployment evidence

日期：2026-09-21（Asia/Shanghai；image/checkpoint 时间戳为 UTC）

## Release

- 版本：`1.4.3`
- implementation commit：`4c61b1e` (`fix(openclaw): isolate WhatsApp direct sessions`)
- canonical host：OrbStack machine `ubuntu` 内的 CasaOS
- OpenClaw image：`local/openclaw-amadeus:git-4c61b1ef2b02-20260920155823`
- Product Radar image：`local/product-radar:git-4d11f3e02074-20260920153810`
- deployment checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920155823`

## Root cause and fix

The live configuration omitted `session.dmScope`, whose runtime default is `main`. Consequently,
different WhatsApp direct senders were multiplexed into `agent:main:main`. `toolsBySender` correctly
limited non-owner tools, but it did not isolate transcript history or model context.

The source template now requires:

- `session.dmScope=per-account-channel-peer`
- `session.groupScope=per-group`
- deploy preflight rejection if either value is missing or wrong
- non-owner WhatsApp tool allowlist remains `web_search` and `web_fetch`

## Verification

- `bash scripts/test-openclaw-session-isolation.sh`：passed。
- `bash scripts/test-notify-owner.sh`：passed。
- `bash scripts/test-amadeus-version.sh`：passed。
- `bash -n` for deployment/version/session test scripts：passed。
- OpenClaw identity/presentation/PUBG/Amadeus targeted build, typecheck and tests：passed。
- `pnpm check:secrets`：passed。
- live OpenClaw：running/healthy。
- live runtime config：`dmScope=per-account-channel-peer`、`groupScope=per-group`。
- post-deploy session listing：new WhatsApp owner DM uses an isolated
  `agent:main:whatsapp:secondary:direct:<owner>` key; no new non-owner DM uses `agent:main:main`.
- owner release event：`eventKey=amadeus-release:1.4.3`，production outbox `.sent.json` present，
  `OWNER_NOTIFICATION=sent`。

The old `agent:main:main` transcript is retained for recovery/forensics and was not deleted during this
release. It is no longer the WhatsApp direct-message route after the scope change.
