# 2026-09-19 PUBG query fix live deployment

## Deployment

- Source commit: `05b3be7 fix(openclaw): isolate manual reports and preserve pubg team queries`
- Command: `./scripts/deploy-openclaw.sh --apply --build-auto`
- OpenClaw image: `local/openclaw-amadeus:git-05b3be7caa7a-20260918161553`
- Recovery checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918161553`

## Acceptance

- Deployment preflight, OpenClaw/Product Radar health, NAS read-only smoke, and WhatsApp owner outbox smoke passed.
- No-delivery replay of `查询昨天全队的 PUBG 战绩` returned 11 matches with `pubg_query_stats` and zero tool failures.
- No-delivery replay of `胶昨天战绩如何？` completed `identity_resolve` → `pubg_query_stats` with zero tool failures and correctly returned no match records for that player/day.
- No unsolicited message was sent to the real WhatsApp group.

## Known boundary

The deployed live replay validates the OpenClaw planner and native plugin path without channel delivery. A user-triggered WhatsApp message remains the final interactive UX check.
