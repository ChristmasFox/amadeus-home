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

The control/source Mac has 22 GiB available and is not the selected build target. No build or cleanup was attempted. The target image inventory contains only the six running staging-service images. The M204 repository clone is clean at `c9d4f80`, matching local `main` before this hardening change.

## Verification

Passed: `pnpm test:openclaw-migration-safe`, `pnpm test:openclaw-runtime-gate`, `pnpm workflow:verify` (FAST), `bash -n scripts/openclaw-migration-safe-start.sh`, Python compilation, `pnpm check:secrets`, and `git diff --check`.

This checkpoint records preflight hardening only; Phase 10 startup and Phase 11 acceptance remain incomplete. The next step is to build/load a release-tagged image on M204 and provision the CasaOS Compose definition safely. The host-local `ai.openclaw.gateway` authority must still be classified before starting destination OpenClaw. Owner ingress and public ingress remain off.
