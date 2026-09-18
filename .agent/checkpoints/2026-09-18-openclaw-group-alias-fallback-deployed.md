# OpenClaw group alias fallback deployment checkpoint

- Date: 2026-09-18 (Asia/Shanghai)
- Root cause: group requests supplied `scope=group`; the resolver treated that as group-only and skipped the deployment-confirmed global aliases for `胶` and `猴`.
- Fix: resolve group aliases first, then fall back to global preset/confirmed aliases; only explicit global scope is global-only. Preloaded members no longer require an external-ID reconfirmation.
- Source commit: `6ec7538` (`fix(identity): fall back to global aliases in groups`).
- Image: `local/openclaw-amadeus:git-6ec7538cc494-20260918132036`.
- CasaOS checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918132036`.
- Verification: Identity 10/10, Amadeus 10/10, PUBG plugin 9/9, affected typechecks, secrets scan, OpenClaw/Product Radar health, plugin preflight, media-adapter network, NAS read-only smoke, and owner outbox smoke passed.
- No-delivery live agent smoke: `胶昨天战绩` completed `read` → `identity_resolve` → `pubg_query_stats`, 3 tool calls, 0 failures, and returned 4 matches. No unsolicited group message was sent.
- Boundary: unknown or observed candidates still require clarification/owner confirmation; the four preloaded WhatsApp members do not.
