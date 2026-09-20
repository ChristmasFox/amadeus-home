# Amadeus architecture convergence 1.3.0 deployment checkpoint

- Date: 2026-09-20
- Goal: `docs/AMADEUS_ARCHITECTURE_CONVERGENCE_GOAL.md`
- Implementation commit: `7d85bc10f15d`
- Version: `1.3.0`
- Branch: `main`, implementation commit pushed to `origin/main`

## Live release

- OpenClaw image: `local/openclaw-amadeus:git-7d85bc10f15d-20260920041059`
- Product Radar image: `local/product-radar:git-7d85bc10f15d-20260920041059`
- CasaOS machine: OrbStack `ubuntu`
- External recovery checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920041059`
- Commands: `./scripts/deploy-openclaw.sh --dry-run`, then
  `./scripts/deploy-openclaw.sh --apply --build-auto`

## Evidence

- Release build/typecheck/full tests/secrets scan passed before apply.
- `OPENCLAW_HEALTH=passed`
- `PRODUCT_RADAR_HEALTH=passed`
- `MEDIA_ADAPTER_NETWORK=passed`
- `NAS_SSH_READONLY_SMOKE=passed`
- `OWNER_WHATSAPP_OUTBOX_SMOKE=passed`
- `LEGACY_RUNTIME=retired`
- `./scripts/doctor.sh`: 0 failures, 0 warnings.
- Live Amadeus: loaded, 19 native tools, 2 typed hooks, owner notification worker.
- Live PUBG: loaded, 8 native tools including `pubg_get_review_facts`.
- Live Skills: Amadeus capability Skills, PUBG Skill, owner notification Skill and all new capability Skills
  present and eligible.
- Live cron: VPS morning/evening, PUBG hourly prefetch/daily sync, market open/close all present.
- Live bundle evidence: owner contract, deterministic renderer, `formatDisplayTime`, and PUBG integration
  strings are present in the loaded plugin bundles.

## Boundaries

- No unsolicited real group-chat test was sent.
- Native tool/preflight evidence is not represented as a real Telegram/WhatsApp natural-language inbound or
  final-reply acceptance; that user-entry evidence remains pending.
- No secrets, runtime database, or external checkpoint contents were committed.
