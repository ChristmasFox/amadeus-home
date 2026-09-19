# Checkpoint: PUBG review freshness deployed

- Date: 2026-09-19 Asia/Shanghai
- Version: Amadeus 1.1.1
- Commit: `5eaf652` (`fix(pubg): require fresh semantic review data`)
- Deploy command: `./scripts/deploy-openclaw.sh --apply --build-auto`
- CasaOS target: OrbStack `ubuntu`
- OpenClaw image: `local/openclaw-amadeus:git-5eaf65238c58-20260919053516`
- External recovery checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919053516`

## Source and test evidence

- `pnpm test:pubg`: PASS (Domain 19/19, Plugin 9/9)
- `pnpm typecheck:pubg`: PASS
- `pnpm test:amadeus`: PASS (11/11)
- `pnpm typecheck:amadeus`: PASS
- `pnpm build:pubg`: PASS
- `pnpm build:amadeus`: PASS
- `./scripts/amadeus-version.sh check`: PASS (`VERSION=1.1.1`)
- `pnpm check:secrets`: PASS
- `git diff --check`: PASS

## Deployment and live evidence

- Deployment script result: `Amadeus 1.1.1 migration completed.`
- OpenClaw and Product Radar health: `passed`
- OpenClaw preflight: `passed`; owner tool policy: `full`
- Media adapter network, NAS read-only smoke and owner WhatsApp outbox smoke: `passed`
- Legacy LangBot/n8n runtime: retired; missing old containers were non-blocking expected state
- Live container: `running/healthy`
- Live logs: `amadeus`, `pubg`, Telegram and WhatsApp registered/started
- Live bundle contains `relative_period`, `review_search_required`, `cacheLookup` and the fresh-review guard
- Hourly scheduler: `5 * * * *`, `Asia/Shanghai`, isolated, latest status `ok`
- Daily scheduler: `0 0 * * *`, `Asia/Shanghai`, isolated, enabled

## Behavior now enforced

- LLM classifies PUBG review intent and emits structured `relative_period`; it does not calculate midnight
  timestamps or route by keywords.
- `pubg_search_matches` forces upstream discovery for `selector` or `recentN`.
- `pubg_get_review_facts` requires a current-turn, fresh `resultSetId` from the refreshed search.
- Successful cache fill is `status=FETCHED`, `cacheStatus=FETCHED`, `cacheLookup=MISS`,
  `availability=AVAILABLE`; only `UNAVAILABLE` means the data is currently unavailable.
- PUBG replies retain `dataUpdatedAt` for user-visible freshness.

## Remaining acceptance boundary

No unsolicited real Telegram/WhatsApp group message was sent during deployment. A real user request such as
`复盘昨天` or `复盘今天` is still required to verify the complete inbound LLM → fresh search → review →
outbound reply path.
