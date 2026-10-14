# PUBG SaaS friendly-damage filter rollout — 2026-10-14

## Scope

Arthur authorized the friendly-damage `meleeKind` correction, full requested
source validation, push to `origin/main`, and replacement of only Gateway and
Worker on OrbStack VM `pubg-saas-m2-clean`. PostgreSQL, egress-proxy, the SaaS
9Router, the `nyannyan` VM, private Kurisu/OpenClaw and private 9Router were not
modified. No production migration, model request, or PUBG API request was run.

## Source and validation

Commit `3c51d4b6c0b55a15ba4ec39bd391d28aac21f98d` is on `origin/main`.
Planner and executor now clear `OTHER` when the current wording does not
explicitly request melee other than kicks/punches; KICK/PUNCH require the
matching explicit wording. Placeholder names such as `none` and `self` become
null. A verified prior KICK/PUNCH filter is retained only for an explicit
follow-up. The Agent tool result reports the resolved Domain time range,
direction, source and melee filter, with enum-only diagnostics. Agent
instructions prohibit revising prior real numbers without a new query result.

Validation passed:

- `pnpm test:pubg-saas`: 139/139, using the reused isolated `pubg-saas-pg18`
  instance. The integration fixture sends `我打了他多少伤害` while the mock
  planner returns `OTHER`; persisted Domain telemetry still returns 42 damage
  across two facts, including a kick, and reports `meleeKind=ALL`.
- `pnpm test:pubg`: 70/70 across Identity, Presentation, Domain and PUBG plugin.
- `pnpm typecheck:pubg`, `pnpm typecheck:pubg-saas`, `pnpm build:pubg`,
  `pnpm build:pubg-saas`, `pnpm check:architecture`,
  `pnpm test:architecture`, `pnpm check:secrets` and `git diff --check` passed.

## Build and deployment

The clean Git archive for the pushed source commit was streamed to
`pubg-saas-m2-clean` and built locally for `linux/arm64` with Buildx. Image:

- Tag: `local/pubg-saas:git-3c51d4b6c0b55a15ba4ec39bd391d28aac21f98d`
- Image ID: `sha256:56d3d9fb493e17ac0832d62c159544d232a7bfdfe892b56e18fe1231a10963da`
- Compose project: `pubg-saas-public`
- Stack directory: `/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas`

Only the `PUBG_SAAS_IMAGE` line in the protected stack `.env` changed; its mode
remains `0600`. Compose configuration validation passed. Only Gateway and
Worker were recreated using `--no-deps --force-recreate --no-build --wait`.

| Component | Before | After | Result |
| --- | --- | --- | --- |
| Gateway | `ba7ff5a5c7a1` | `4eb208072980` | Running, zero restarts |
| Worker | `a965bc8da5bf` | `a96544a59005` | Healthy, zero restarts |
| PostgreSQL | `e47fd49fcab5` | unchanged | Healthy |
| egress-proxy | `c5cd33cba219` | unchanged | Healthy |
| SaaS 9Router | `2ce598008143` | unchanged | Running |

The read-only PostgreSQL KOOK state probe returned `connected=true`,
`last_sn=53`, updated at `2026-10-14T12:49:54.194Z`. Gateway and Worker each
had zero matches for error/fatal/exception/provider-error patterns in the
five-minute startup window.

The protected pre-switch rollback record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-3c51d4b-pre-switch.txt`
(mode `0600`). It captures the previous image and exact service IDs. To roll
back, restore its `PREVIOUS_IMAGE` value to `PUBG_SAAS_IMAGE` in the live `.env`,
keep mode `0600`, validate `docker compose ... config --quiet`, then recreate
only Gateway and Worker with `docker compose ... up -d --no-deps
--force-recreate --no-build --wait gateway worker`.

Arthur's live KOOK checks for `昨天004对我的伤害` and `我打了他多少伤害`
remain pending. No human message was generated for this deployment smoke. M2
is not complete until Arthur completes and accepts the KOOK test.
