# Public KOOK Agent SOUL-aligned persona — 2026-10-14

## Source and privacy boundary

Arthur clarified that public KOOK personality must follow the private
OpenClaw workspace `SOUL.md`. The live read-only source inspected was
`/DATA/AppData/openclaw/workspace/SOUL.md`, section `说话方式`. The public app
contains a checked-in copy of that section at
`apps/pubg-saas/src/application/public-agent-soul.md`; its general speaking
rules are verbatim. The sole line naming the private assistant was omitted.
No `MEMORY.md`, `USER.md`, DMs, personal details, or private nickname mapping
were read or copied, and no private runtime file was changed.

Both the normal ToolLoopAgent and its recovery summarizer use the same copied
SOUL text. Build copies the Markdown alongside the compiled application; a
runtime image check verified it loads. Tests pin the approved excerpt digest,
check both prompt paths use it, and reject private identity/personal-source
markers in the copy and prompts. PUBG interaction, safety, factuality, and
coverage instructions remain separate from the persona source.

## Validation

- `pnpm test:pubg-saas`: 146/146 passed, 0 skipped, using the reused isolated
  PostgreSQL 18 container `pubg-saas-pg18` and `pubg_test` database.
- `pnpm test:pubg`: 70/70 passed.
- PUBG and SaaS builds/typechecks, `pnpm check:architecture`,
  `pnpm check:secrets`, and `git diff --check` passed.
- The test database remained running. Its dedicated test role uses a random
  owner-only password file under `~/Library/Caches/pubg-saas-pg-test`; the
  connection URL and password were not printed or committed.

Source commit `642f04eb5566f3b429373462a6ea75c3dd7c521b` is pushed to
`origin/main`.

## Deployment

Only Gateway and Worker were recreated on OrbStack VM `pubg-saas-m2-clean`.
The image was built locally on that VM for `linux/arm64`, without pushing an
image:

- Image: `local/pubg-saas:git-642f04eb5566f3b429373462a6ea75c3dd7c521b`
- Image ID: `sha256:ee197854e86f63d518b264fa054d9eca45bf524289a9936d059f9ae5099c60a1`
- Gateway: `2a3b4b653be5`, running, zero restarts.
- Worker: `4b5cd8e9ed0a`, healthy, zero restarts.
- PostgreSQL, egress-proxy, and SaaS 9Router container IDs match the
  pre-switch record; no migration ran.
- Read-only KOOK session probe: connected, `last_sn=61`, updated within five
  minutes. Gateway and Worker had zero error/fatal/uncaught/startup-failure
  log matches in the inspected 10-minute window.
- No manual model or PUBG API request was made.

The target-side mode-0600 pre-switch rollback record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-642f04e-pre-switch.txt`.
It records the previous image/container IDs and unchanged infrastructure IDs.
Restore its `PREVIOUS_IMAGE` value to the protected stack `.env`, validate
Compose config, then recreate only `gateway worker` with
`--no-deps --force-recreate --no-build --wait` to roll back.

Arthur's real KOOK acceptance is pending. M2 is not complete; stop here and
wait for Arthur's test.
