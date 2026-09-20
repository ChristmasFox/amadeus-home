# PUBG team-damage batch contract implementation checkpoint

- Date: 2026-09-20
- Goal: `docs/AMADEUS_ARCHITECTURE_CONVERGENCE_GOAL.md`
- Release: `1.4.0`
- Status: implementation complete; release commit/push and CasaOS apply pending

## Root cause evidence

- The real WhatsApp trajectory for “昨天队内误伤情况详情” called only
  `pubg_search_matches`; it returned seven Match API records and no Telemetry.
- The follow-up “昨天007踢了004几脚” repeated the same single
  `pubg_search_matches` call and never called `pubg_get_review_facts`.
- Match API `coverage=OK/complete=true` covered basic match data only. There was no
  deterministic period-level teammate-damage use case, so prompt-only routing could stop
  before Telemetry.

## Implemented boundary

- Added `pubg_query_team_damage` to the platform-neutral PUBG Domain and native plugin.
- A semantic period selector is resolved in the Domain using the configured 06:00 boundary.
- The use case refreshes Match discovery, ensures Telemetry for every selected match, and
  returns all directions or one explicit `actor → victim` direction.
- `source=MELEE` plus `meleeKind=KICK|PUNCH` supports exact teammate-action queries.
- Unavailable Telemetry produces `partial`, `null`, and evidence of unavailable match IDs;
  it is never rendered as zero.
- Skill, manifest, deployment preflight, architecture docs, and regression tests were updated.

## Validation

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm check:architecture`
- `pnpm check:secrets`
- `pnpm workflow:verify`
- `./scripts/amadeus-version.sh check`
- `git diff --check`

All passed. No runtime database, backup, or secret was added to Git.
