# WhatsApp DM session isolation checkpoint

日期：2026-09-21（Asia/Shanghai）

## Cause

Live OpenClaw omitted `session.dmScope`; runtime defaulted to `main`, so different WhatsApp direct
senders shared `agent:main:main`. The sender tool policy was present and limited non-owner tools, but
that policy does not isolate transcript history, memory, or model context.

## Source and release

- `VERSION=1.4.3`
- commit `4c61b1e`
- `session.dmScope=per-account-channel-peer`
- `session.groupScope=per-group`
- deploy preflight rejects any other direct/group scope
- non-owner allowlist remains `web_search`, `web_fetch`

## Live evidence

- OpenClaw image: `local/openclaw-amadeus:git-4c61b1ef2b02-20260920155823`
- Product Radar image: `local/product-radar:git-4d11f3e02074-20260920153810`
- checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920155823`
- OpenClaw: running/healthy
- owner DM route after apply: isolated `agent:main:whatsapp:secondary:direct:<owner>` session key
- release event: `amadeus-release:1.4.3`, production `.sent.json` confirmed

The old `agent:main:main` transcript remains retained for recovery/forensics and was not deleted.
It is no longer the WhatsApp DM route after the scope change.
