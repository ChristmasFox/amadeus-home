# Public KOOK Agent rich battle reports — 2026-10-14

## Scope and diagnosis

Arthur authorized a public Agent response improvement, full requested source
validation, push to `origin/main`, and replacement of only Gateway and Worker
on OrbStack VM `pubg-saas-m2-clean`. The private `nyannyan` runtime and Kurisu,
PostgreSQL, egress-proxy, and SaaS 9Router were not modified.

The read-only effective Kurisu config has timezone `Asia/Shanghai` and
`businessDayStart=06:00`; `PUBG_TIMEZONE` and `PUBG_BUSINESS_DAY_START` are not
overridden. Shared Domain defaults and the checked-in PUBG Skill also specify
06:00. Thus the reported `05:00~05:00` reply text is inconsistent with the
effective query boundary. Both private and public Domain paths select
competitive matches and intersect them with the authorized roster. Public
Gateway reads the isolated PostgreSQL cache; the independent Worker owns
upstream match discovery. The private plugin has its own SQLite service and
upstream client. Since those stores can have different freshness and coverage,
the reported 5-vs-7 match counts cannot be adjudicated from the counts alone;
no live PUBG query or private match-data read was run. The Agent now receives
the authoritative source range, cache freshness, required/available match
counts, and partial-coverage state so it can report the actual returned scope.

The public Agent's tool output now has an allowlist: team-damage totals,
source totals, each roster direction's per-source hits/damage/match counts, up
to 10 safe match summaries, and up to 8 roster players' approved stats. It
omits match/player IDs, evidence IDs, telemetry/debug objects, and unrestricted
Domain envelopes. The output budget is 1,600 tokens per step; total timeout
remains 300 seconds. Persona guidance carries over rational, direct, lightly
teasing style only. It does not include private memory, user/DM data, or private
nickname mappings, and no private files were changed.

## Validation

- `pnpm build:pubg` and `pnpm --filter @agent/pubg-saas build` passed.
- `pnpm test:pubg-saas`: 144/144 passed, no skips, using the reused isolated
  PostgreSQL 18 test container/database `pubg-saas-pg18` / `pubg_test`.
- `pnpm test:pubg`: 70/70 passed across Identity, Presentation, Domain, and
  PUBG plugin.
- `pnpm typecheck:pubg` and `pnpm --filter @agent/pubg-saas typecheck` passed.
- `pnpm check:architecture`, `pnpm check:secrets`, and `git diff --check`
  passed.
- Focused tests cover source/direction aggregation, 8-player/10-match caps,
  coverage counts without IDs, output budget, shared 06:00 time formatting,
  and persona exclusion of private identities.

Source commit `adeb839f5bfec07134a11259608edaa7e9171096` is pushed to
`origin/main`.

## Pre-switch rollback point

The target-side protected record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-adeb839-pre-switch.txt`
with mode `0600`. Before replacement, Gateway and Worker both used
`local/pubg-saas:git-ef81896a1c85a22afaf8c533e0d95929b425962f`. The record
contains their prior container/image IDs and the unchanged PostgreSQL,
egress-proxy, and SaaS 9Router IDs.

## Deployment and smoke result

The source archive for `adeb839f5bfec07134a11259608edaa7e9171096` was built
locally on `pubg-saas-m2-clean` for `linux/arm64` without pushing an image:

- Image: `local/pubg-saas:git-adeb839f5bfec07134a11259608edaa7e9171096`
- Image ID: `sha256:206a98e2f0cf9540c34a0dd1ccd4e94c646569026d3bddd6f1b84eb0be6489ba`
- Compose project: `pubg-saas-public`
- Only Gateway and Worker were recreated with `--no-deps --force-recreate
  --no-build --wait`. Stack `.env` remained mode `0600`; no migration ran.

| Component | After deployment | Result |
| --- | --- | --- |
| Gateway | `a9875b3032a3` | Running, zero restarts |
| Worker | `2fbf96d154c6` | Healthy, zero restarts |
| PostgreSQL | `e47fd49fcab5` | Unchanged, healthy |
| egress-proxy | `c5cd33cba219` | Unchanged, healthy |
| SaaS 9Router | `2ce598008143` | Unchanged, running |

The read-only KOOK session probe returned `connected=true`, `last_sn=61`,
updated at `2026-10-14 15:02:13 UTC`. Gateway and Worker logs had no error,
fatal, uncaught-exception, or startup-failure matches in the 10-minute window.
No manual model or PUBG query was made for smoke verification.

To roll back, restore the `PREVIOUS_IMAGE` value from the protected record to
`PUBG_SAAS_IMAGE` in the protected stack `.env`, keep mode `0600`, validate
with `docker compose --project-name pubg-saas-public config --quiet`, then run
`docker compose --project-name pubg-saas-public up -d --no-deps
--force-recreate --no-build --wait gateway worker`.

Arthur's real KOOK acceptance remains pending. M2 is not complete until Arthur
tests the richer response in the group.
