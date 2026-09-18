# Follow-up: verify PUBG query boundary hardening through real inbound traffic

- Deployment completed from commit `1c2a585`.
- Live OpenClaw uses `businessDayStart: 06:00`; rollback checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918172435`.
- Release smoke passed: OpenClaw/Product Radar health, PUBG runtime preflight, media network, NAS read-only smoke, owner WhatsApp outbox, and retired-runtime checks.
- Remaining acceptance: complete one real Telegram/WhatsApp inbound test for a nickname query, a first-person query, a team query, a 06:00 boundary query, and a recent-match review.
