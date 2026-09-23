# Amadeus 1.4.8 — Phase 10 migration-safe Compose preflight hardening

Date: 2026-09-23
Goal: `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`
Destination: Amadeus-M204 / OrbStack `nyannyan` / Ubuntu 24.04

## Finding and correction

The prior `scripts/openclaw-migration-safe-start.sh --plan` returned before validating the CasaOS Compose definition. M204 had no OpenClaw app directory or `docker-compose.yml`, so the prior successful plan was not evidence that the actual startup path was ready.

The plan and apply paths now require a regular, non-symlink canonical Compose file and render the actual migration-safe merged Compose before proceeding. The preflight rejects published ports, a non-loopback config path, enabled owner delivery, restart policies other than `no`, a writable/missing overlay mount, mutable/unbuilt image tags, and images absent from the local Docker daemon. The overlay is generated under `/run` for plan validation; only apply persists it under the app directory. The canonical restored OpenClaw config remains untouched.

## Current destination evidence

```text
M204_APP_DIR=absent
M204_OPENCLAW_COMPOSE=absent
M204_OPENCLAW_IMAGE=absent
M204_GUEST_ROOT_AVAILABLE=374GiB
M204_MAC_ROOT_AVAILABLE=393GiB
M204_DOCKER_IMAGES=6 active / 3.964GB / 0 reclaimable
M204_DOCKER_BUILD_CACHE=0
OPENCLAW_STARTED=no
DOCKER_PRUNE=not-run
```

The control/source Mac has 22 GiB available and is not the selected build target. No build or cleanup was attempted. The target image inventory contains only the six running staging-service images. The M204 repository clone was clean at `c9d4f80` before this hardening change.

After push, M204 fast-forwarded to `0314504`; a live `scripts/openclaw-migration-safe-start.sh --plan` passed Avalon UUID/sentinel checks and then returned the expected hard failure:

```text
MIGRATION_SAFE_OPENCLAW=BLOCKED canonical OpenClaw Compose definition is missing or symlinked.
```

The check made no app-directory writes and started no service. Phase 10 remains authorized for isolated loopback testing; the host-local LaunchAgent classification is required before Phase 12 owner-ingress activation, not before this isolated test mode.

## Verification

Passed: `pnpm test:openclaw-migration-safe`, `pnpm test:openclaw-runtime-gate`, `pnpm workflow:verify` (FAST), `bash -n scripts/openclaw-migration-safe-start.sh`, Python compilation, `pnpm check:secrets`, and `git diff --check`.

## Follow-up hardening

The apply path now supports the observed missing-Compose case without a manual out-of-band write. It requires the already-approved Avalon-move token, an explicit immutable local Git/timestamp image tag, and confirmation that the image is loaded on M204. It renders the canonical Git template, atomically creates the Compose file only in an absent/empty app directory, and refuses symlinks, conflicting files, or any non-empty directory. It then runs the merged migration-safe preflight; only a passing preflight can reach `docker compose up`. `--plan` remains non-persistent and still reports the missing Compose as blocked. It never replaces a differing operator-owned Compose file.

Follow-up checks passed locally: `python3 scripts/test-openclaw-migration-safe.py`, `pnpm test:openclaw-runtime-gate`, `pnpm workflow:verify` (FAST), `pnpm check:secrets`, `bash -n scripts/openclaw-migration-safe-start.sh`, Python compilation, `bash scripts/amadeus-version.sh check`, and `git diff --check`. No image was built, no Compose was installed on M204, and no service was started by this follow-up. Phase 10 startup and Phase 11 acceptance remain incomplete. The host-local `ai.openclaw.gateway` authority must be classified before Phase 12 owner-ingress activation. Owner ingress and public ingress remain off.
