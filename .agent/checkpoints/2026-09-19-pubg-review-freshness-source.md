# PUBG review freshness and telemetry cache semantics source checkpoint

- 日期：2026-09-19 Asia/Shanghai
- 版本：`1.1.1`
- 范围：PUBG LLM semantic selector boundary, 06:00 business-day resolution, fresh review result-set gate, and Telemetry cache status semantics.

## Changes

- Added `relative_period` to PUBG stats/compare/search selector inputs. The LLM supplies semantic intent; `packages/pubg-domain` resolves the period deterministically with `Asia/Shanghai` and `06:00`.
- `pubg_search_matches` forces a source refresh when `selector` or `recentN` is present and returns the resolved half-open time range.
- `pubg_get_review_facts` requires a current-session search `resultSetId` created by a fresh search within five minutes and containing the requested Match ID.
- Telemetry now reports user-facing `HIT`, `FETCHED`, or `UNAVAILABLE`; `cacheLookup=MISS` is retained only as a low-level diagnostic and no longer represents successful fetches as missing data.
- Workspace and PUBG Skill guidance preserves LLM intent recognition and forbids reuse of old period-review facts.

## Verification

- `pnpm test:pubg`: PASS (Identity 10, PUBG Domain 19, PUBG Plugin 9)
- `pnpm typecheck:pubg`: PASS
- `pnpm test:amadeus`: PASS (Identity 10, Amadeus 11)
- `pnpm typecheck:amadeus`: PASS
- `pnpm build:pubg`: PASS
- `pnpm build:amadeus`: PASS
- `pnpm check:secrets`: PASS
- `./scripts/amadeus-version.sh check`: PASS
- `git diff --check`: PASS

## Deployment status

Source checkpoint only. CasaOS apply, live image tag, runtime preflight, and fresh-review live smoke are pending in the release stage.
