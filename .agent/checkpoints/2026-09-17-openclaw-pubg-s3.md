# OpenClaw PUBG S3 checkpoint

日期：2026-09-17（Asia/Shanghai）

## Deployment

- Command: `./scripts/deploy-openclaw.sh --apply --build --cleanup`
- Final image: `local/openclaw-pubg:git-02d6d0421015-20260917090121`
- Image ID: `sha256:7ca712a295b86520a0ba2f75295aa99e0de6e70acf550859917cae203d214ffe`
- CasaOS compose: `/var/lib/casaos/apps/openclaw/docker-compose.yml`
- External checkpoint: `/DATA/AppData/openclaw/backups/openclaw-pubg-20260917-091502`
- OpenClaw container: running and healthy; final Telegram probe is configured, running,
  connected, ready, polling, and has no error.
- Native plugin preflight passed; bundled `pubg` Skill preflight passed with one loaded Skill
  carrying a non-empty description; final logs contain zero invalid-Skill warnings.

## Migration and retirement

- Existing migration was detected as already applied (`migration_runs=1`), so no duplicate
  migration row was created.
- Runtime SQLite: `matches=267`, `match_players=748`, `telemetry_features=58` (57 imported
  initially plus one real runtime feature), `result_sets=49`.
- LangBot Telegram bot disabled; `pubg-stats` and `kurisu-gateway` settings disabled.
- Six exact legacy PUBG n8n workflows inactive; dedicated old PUBG and legacy OpenClaw compose
  definitions retired; Product Radar notification owner is `disabled`.
- Unrelated LangBot/KOOK, n8n, Product Radar and 9Router services were kept independent.

No secrets, database files or backup archives are tracked by Git. The external checkpoint is
retained for recovery reference only; no rollback rehearsal was performed.
