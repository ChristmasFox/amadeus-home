# OpenClaw PUBG account alias alignment (deployed)

- Date: 2026-09-18 Asia/Shanghai
- Source commit: `a990bda` (`fix(pubg): align confirmed account aliases`)
- Image: `local/openclaw-amadeus:git-a990bda023b1-20260918125753`
- CasaOS checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918125753`
- External team-config backup: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918125744-pubg-account-alias/pubg-team.json.before`
- Runtime change: added the three user-confirmed account names as aliases for the existing canonical PUBG players; canonical player IDs and Identity records were not changed.
- Deployment result: build, typecheck, tests, secrets scan, OpenClaw/Product Radar health, plugin preflight, media-adapter network, NAS read-only smoke, and owner outbox smoke passed.
- No-delivery live agent smoke:
  - `胶昨天战绩`: `identity_resolve` → `pubg_query_stats`, 3 tool calls total, 0 failures, returned 4 matches.
  - `猴昨天战绩`: `identity_resolve` → `pubg_query_stats`, 3 tool calls total, 0 failures, returned 4 matches.
- Boundary: no unsolicited WhatsApp group test message was sent; user-triggered real group verification remains the final acceptance step.
