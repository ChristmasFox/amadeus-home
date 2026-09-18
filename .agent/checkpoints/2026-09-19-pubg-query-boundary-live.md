# PUBG query boundary live checkpoint

- Date: 2026-09-19 Asia/Shanghai
- Commit: `1c2a585`
- Image: `local/openclaw-amadeus:git-1c2a585b2eef-20260918172435`
- External rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918172435`
- Live PUBG config: `timezone=Asia/Shanghai`, `businessDayStart=06:00`, `maxMatches=500`, `freshnessMs=300000`
- Runtime preflight: PUBG plugin loaded with all six native tools and manifest default `06:00`
- Release checks passed: build, typecheck, tests, secrets scan, OpenClaw/Product Radar health, media network, NAS read-only smoke, owner WhatsApp outbox smoke, retired LangBot/n8n checks
- Remaining: real Telegram/WhatsApp inbound acceptance for nickname, self, team, 06:00 boundary, and recent-match review
