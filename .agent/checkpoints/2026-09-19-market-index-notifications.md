# Checkpoint: market index notifications

- Date: 2026-09-19 Asia/Shanghai
- Version: 1.2.0
- Commit: 5117aa5
- Scope: deterministic NASDAQ-100 (`^NDX`) and S&P 500 (`^GSPC`) open/close observations in `plugins/amadeus`
- Data source: Yahoo Finance Chart API through the runtime proxy; no credentials are stored in Git.
- Notification route: existing channel-free WhatsApp owner outbox; titles use `Amadeus • 世界线观测 · 美股开盘/收盘` and the body ends with `El Psy Kongroo.`.
- Schedules: `amadeus-market-open`, `35 9 * * 1-5`, `America/New_York`; `amadeus-market-close`, `5 16 * * 1-5`, `America/New_York`; both isolated with tool allow-list `amadeus_market_indices amadeus_notify_owner` and `delivery=none`.
- Deployment image: `local/openclaw-amadeus:git-5117aa593fbc-20260919102358`.
- External recovery point: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919102358`.
- Verification: Amadeus/Identity typecheck, Amadeus tests 16/16, build, secrets scan, diff check, live `running/healthy`, plugin/Skill preflight, NAS read-only smoke, owner outbox smoke, and Gateway live tool smoke passed.
- Live tool smoke: `amadeus_market_indices(phase=close)` returned `market_closed` on Saturday 2026-09-19; no market notification was sent.
- Recovery: restore the external checkpoint only with an explicit reviewed rollback plan; do not restore retired LangBot/n8n/runtime paths.
