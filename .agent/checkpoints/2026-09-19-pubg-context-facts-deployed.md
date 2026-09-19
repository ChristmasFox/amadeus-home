# Checkpoint: PUBG facts must come from tool data

- Date: 2026-09-19 Asia/Shanghai
- Version: Amadeus 1.1.3
- Commit: `36020fc` (`fix(pubg): require fresh tool facts for queries`)
- Deploy command: `./scripts/deploy-openclaw.sh --apply --build-auto`
- CasaOS target: OrbStack `ubuntu`
- OpenClaw image: `local/openclaw-amadeus:git-36020fc00a21-20260919062713`
- External recovery checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919062713`

## Root cause and policy

- A new PUBG factual question was answered from prior session context without a PUBG tool call.
- Any message routed to a PUBG tool must use that tool's current result as the only factual source.
- The native tool reads the persistent SQLite cache and applies its default refresh policy; context is limited
  to identity, period, scope, and explicit match-reference resolution.
- Previous assistant prose, old tool results, and incomplete review context cannot supply PUBG numbers.

## Verification

- `pnpm test:pubg`: PASS (Domain 20/20, Plugin 9/9)
- `pnpm typecheck:pubg`: PASS
- `pnpm build:pubg`: PASS
- `pnpm test:amadeus`: PASS (11/11)
- `pnpm typecheck:amadeus`: PASS
- `pnpm build:amadeus`: PASS
- `./scripts/amadeus-version.sh check`: PASS (`VERSION=1.1.3`)
- `pnpm check:secrets`: PASS
- `git diff --check`: PASS

## Live evidence

- Deployment result: `Amadeus 1.1.3 migration completed.`
- OpenClaw/Product Radar health, preflight, media network, NAS read-only smoke and owner outbox smoke: passed
- Live container: `running/healthy`
- Live logs: `amadeus`, `pubg`, Telegram and WhatsApp registered/started
- Container files contain the new workspace rule, PUBG Skill rule and native tool descriptions.
- No unsolicited real Telegram/WhatsApp group test message was sent.
