# Checkpoint: PUBG review ordering deployed

- Date: 2026-09-19 Asia/Shanghai
- Version: Amadeus 1.1.2
- Commit: `956853c` (`fix(pubg): order period reviews chronologically`)
- Deploy command: `./scripts/deploy-openclaw.sh --apply --no-build --image local/openclaw-amadeus:git-956853caa816-20260919060947`
- CasaOS target: OrbStack `ubuntu`
- OpenClaw image: `local/openclaw-amadeus:git-956853caa816-20260919060947`
- External recovery checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919061408`

## Source and test evidence

- `pnpm test:pubg`: PASS (Domain 20/20, Plugin 9/9)
- `pnpm typecheck:pubg`: PASS
- `pnpm build:pubg`: PASS
- `pnpm test:amadeus`: PASS (11/11)
- `pnpm typecheck:amadeus`: PASS
- `pnpm build:amadeus`: PASS
- `./scripts/amadeus-version.sh check`: PASS (`VERSION=1.1.2`)
- `pnpm check:secrets`: PASS
- `git diff --check`: PASS

## Deployment and live evidence

- Initial `--build-auto` reached the image-transfer stage but exited before apply because the target Docker
  filesystem was nearly full; the already-built image was transferred successfully on retry.
- Reused-image apply result: `Amadeus 1.1.2 migration completed.`
- OpenClaw and Product Radar health: `passed`
- OpenClaw preflight: `passed`; owner tool policy: `full`
- Media adapter network, NAS read-only smoke and owner WhatsApp outbox smoke: `passed`
- Legacy LangBot/n8n runtime: retired; missing old containers were non-blocking expected state
- Live container: `running/healthy`
- Live logs: `amadeus`, `pubg`, Telegram and WhatsApp registered/started
- Live bundle contains the chronological period-review description and `sort="asc"` / recent `sort="desc"`

## Behavior now enforced

- Period review without explicit sort uses chronological `startedAt ASC` order.
- Recent/latest lookup using `recentN` remains newest-first `startedAt DESC`.
- Explicit `sort` remains honored; global OpenClaw/Amadeus routing is unchanged.
- No unsolicited real Telegram/WhatsApp group message was sent during deployment.
