# Amadeus context split deployment checkpoint

日期：2026-09-18（Asia/Shanghai）
状态：DEPLOYED / CONTEXT_SPLIT / NATURAL_LANGUAGE_SMOKE_PASS

## Source and runtime

- Deployment config commit：`42ef93a`。
- OpenClaw/Product Radar images：
  `local/openclaw-amadeus:git-5fd139d3e58d-20260918081806`、
  `local/product-radar:git-5fd139d3e58d-20260918081806`。
- CasaOS checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918082357`。
- OpenClaw and Product Radar health, media adapter network, NAS read-only smoke, and owner
  WhatsApp outbox smoke passed.

## Context boundary

- Live `AGENTS.md` and `SOUL.md` contain no PUBG-specific terms.
- PUBG identity, selector, Telemetry, comparison, null-safety, and evidence rules are in
  `plugins/pubg/skills/pubg/SKILL.md`.
- Amadeus media confirmation and KOOK interactive-only rules are in
  `plugins/amadeus/skills/amadeus/SKILL.md`.
- OpenClaw owner policy is `tools.profile=full` with no `tools.allow`; WhatsApp groups are
  `open`, mention is not required, and group-level tool restrictions are absent.

## Delivery and natural-language evidence

- Codex hook smoke event `5588873ac2d2327a96507dfb23b5c13088478aad` reached the remote outbox
  as `.sent.json`; its event source is `codex` and it has no channel/recipient/to field.
- Natural-language read-only smoke run
  `460fe1fe-ddfa-436d-9b33-2b2957362129` successfully selected only
  `amadeus_product_radar`, returned one watch, and reported zero tool failures.
- Internal OpenClaw service names (`product-radar`, `media-organizer-adapter`, and
  `changedetection`) are in `NO_PROXY`, so native Amadeus requests do not use the host proxy.

## Retirement and verification

- LangBot/n8n containers and canonical app/data paths are absent; KOOK watchdog timer/service
  are inactive and the retired helper is preserved in the earlier external checkpoint.
- `pnpm build`, `pnpm typecheck`, `pnpm test` (PUBG domain 9, PUBG plugin 5, Amadeus 1,
  Product Radar 51), `pnpm check:secrets`, shell/python syntax checks, and `git diff --check`
  passed.
- No unsolicited WhatsApp group message was sent; group behavior is verified from live config and
  plugin/tool inventory, pending only a user-originated UX message.
