# PUBG query boundary hardening — source checkpoint

- Date: 2026-09-19 Asia/Shanghai
- Scope: source-only PUBG Domain/plugin hardening; no CasaOS apply
- User decision: preserve the legacy PUBG business day `06:00`–next-day `06:00` in `Asia/Shanghai`
- Changes:
  - unified the domain/config/manifest/Skill business-day default to `06:00`
  - made explicit selector time settings affect day grouping and compare segments
  - downgraded cached rows to `STALE`/`partial` when player discovery is unavailable
  - scoped review facts to resolved `playerIds`
  - kept unknown metrics null in ranking, Chicken Index, highlights, trend, and compare deltas
- Verification:
  - `pnpm --filter @agent/pubg-domain test` — 16 passed
  - `pnpm --filter @agent/pubg-domain typecheck` — passed
  - `pnpm --filter @agent/pubg-plugin test` — 9 passed
  - `pnpm --filter @agent/pubg-plugin typecheck` — passed
  - `pnpm check:secrets` — passed
  - `git diff --check` — passed
- Pending: explicit release/apply to CasaOS, live runtime config switch, and real Telegram/WhatsApp inbound acceptance.
