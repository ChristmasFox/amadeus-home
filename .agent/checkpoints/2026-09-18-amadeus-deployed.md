# Amadeus deployment checkpoint

日期：2026-09-18（Asia/Shanghai）
状态：DEPLOYED / OWNER_SMOKE_SENT

## Runtime

- Source commit：`5e76709`。
- OpenClaw image：`local/openclaw-amadeus:git-5e767097adda-20260918080012`。
- Product Radar image：`local/product-radar:git-5e767097adda-20260918080012`。
- CasaOS checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918080634`。
- OpenClaw and Product Radar health passed; media adapter network and NAS read-only smoke passed.
- Briefing jobs `amadeus-briefing-morning` and `amadeus-briefing-evening` are registered.

## PUBG-only fix

- Live `tools.profile=full`; no strict `tools.allow` key.
- WhatsApp group policy is `open`, `requireMention=false`, with no group `tools` or
  `toolsBySender` restriction. Members inherit the full agent profile, including PUBG and
  normal Amadeus/OpenClaw capabilities.
- `pubg`: 6 tools, `origin= bundled`, `trust= bundled`, loaded.
- `amadeus`: 7 tools, `origin= bundled`, `trust= bundled`, loaded.
- WhatsApp owner DM remains allowlisted; high-risk operations retain owner/confirmation checks.

## Delivery and retirement

- WhatsApp secondary account is linked/healthy.
- Real owner outbox smoke reached `.sent.json`.
- Legacy LangBot/n8n containers and app/data paths are absent.
- KOOK watchdog timer/service/helper were disabled and moved to the earlier external
  checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918080449/retired-systemd`.
- No unsolicited group test message was sent; live group policy and tool inventory are verified.

## Verification

- `pnpm build`：PASS
- `pnpm typecheck`：PASS
- `pnpm test`：PASS（PUBG domain 9、PUBG plugin 5、Amadeus 1、Product Radar 51）
- `pnpm check:secrets`：PASS
- Final `scripts/deploy-openclaw.sh --apply --image ... --radar-image ...`：exit 0
