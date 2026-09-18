# VPS read-only live deployment checkpoint

- Date: 2026-09-18 Asia/Shanghai
- Git: `e15607c` (`fix(amadeus): require VPS report traffic bar`)
- CasaOS checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918122319`
- OpenClaw image: `local/openclaw-amadeus:git-e15607cdbbfb-20260918122319`

## Verified

- KiwiVM credentials exist only in the external CasaOS secret mount; the repository remains
  secret-free and `pnpm check:secrets` passes.
- Runtime Amadeus inspect exposes five VPS read-only tools and the eligible, model-visible `vps`
  Skill. No generic shell or VPS control tool was added.
- Gateway natural-language smoke called `amadeus_vps_service_info`, `amadeus_vps_usage`,
  `amadeus_vps_live_status`, `amadeus_vps_system_status`, and `amadeus_vps_services` with zero
  tool failures. Unknown CPU throttling was explicitly retained as unknown.
- `amadeus-vps-morning` and `amadeus-vps-evening` are enabled at `30 9` and `0 23`
  `Asia/Shanghai`; their allowlist is the four VPS read tools plus `amadeus_notify_owner`.
- The first cron smoke exposed an owner-context mismatch for OpenClaw's
  `agent:main:cron:...` session key. `c1fe427` fixed it and added coverage. A later evening cron
  run produced a WhatsApp provider sent message and an outbox `.sent.json` marker.
- The evening report included a ten-cell traffic bar, used/total, delta, four critical services,
  and explicit unknown handling. `e15607c` made that bar mandatory in both the Skill and existing
  cron prompts.
- After `docker compose restart openclaw`, health passed and both cron definitions, their prompt
  allowlists, and `/data/vps-usage-state.json` baseline fields remained present.

## Remaining

- A user must send one real WhatsApp natural-language VPS query so the inbound channel metadata,
  tool selection, and final user-facing reply can be recorded. The CLI Gateway smoke is not used
  as a substitute for that channel evidence.
