# Product Radar rich status presentation checkpoint — 2026-09-09

## Scope

Make the existing Product Radar Watch status query match the observability template rather than showing only a short status summary. This is a LangBot presentation-boundary change; Product Radar Core, scheduler, database, and Watch records are not changed.

## Source changes

- Extract the pure status formatter into `components/observability_presentation.py` so it can be tested without the LangBot SDK.
- Render status and statistics with Watch type/status, Chinese human-readable runtime and relative check times, all cumulative runtime counters, similarity maximum, notifications, Token usage, and per-Feed health/error detail.
- Bump the Product Radar plugin manifest from `0.5.2` to `0.5.3`.

## Verification

- LangBot Product Radar unit tests: 33/33 passed.
- Python compile, `pnpm workflow:plan` (FAST / LANGBOT_PLUGIN), `git diff --check`, and `pnpm check:secrets`: passed.
- Deployment plan was reviewed before apply; no Docker build or CasaOS compose change was required.

## Release status

Source commit `71183b9` is pushed to `origin/main`. LangBot Product Radar plugin `0.5.3` was installed with task `111` reaching `INSTALL_READY`; package SHA-256 is `44e49a6a4ca163d0ae04d2000265c8fa79a189a9616b22a858b6405582fcea05`, with rollback dir `.backups/langbot/20260909-161810`. Post-deploy `scripts/doctor.sh` returned 0 failures / 0 warnings. Product Radar is `healthy/running`, its `/health` is `status=ok`, and LangBot/plugin runtime remain running. No real Watch was created, deleted, or modified. A real Telegram/KOOK inbound rendering smoke remains user-driven.
