# Operation Skuld — Mac mini migration runbook

Status: readiness and rehearsal only. This document is tracked so a future
cutover is an execution task with an explicit checkpoint. Amadeus 1.4.2 does
not perform this cutover, change DNS, rotate channels, or stop the current
CasaOS runtime.

## Phase 0 — Freeze and checkpoint

1. Confirm the implementation and deployment-evidence commits are pushed.
2. Run `scripts/migration-readiness.sh` on the current control Mac and save its
   output with the release evidence.
3. Create an external backup with `scripts/backup.sh --include-secrets` using
   an encrypted destination. Verify the backup manifest and keep the secret
   archive separate from Git.
4. Record the current OpenClaw and Product Radar image tags, CasaOS compose
   files, FashionSigLIP health, cron list, and the owner outbox count.

The freeze boundary is the last successful readiness result. New owner
outbox entries or database writes after that boundary must either be replayed
to the destination or cause the cutover to stop.

## Phase 1 — Prepare the destination Mac

1. Install the tracked dependencies with `scripts/bootstrap.sh --check`.
2. Copy the local, non-secret `infra/host-profile.env` override and set the
   destination machine, network, Mac control user, and FashionSigLIP port.
3. Restore secret files out-of-band with mode `0600`; never copy their values
   into this repository or a terminal transcript.
4. Run `scripts/install-fashion-siglip-macos.sh --apply` and wait for health
   to report `status=ok` and `device=mps`. The model cache may be downloaded
   again; it is not a migration blocker.

## Phase 2 — Restore and validate data

Restore in manifest order: workspace/config metadata, identity SQLite, PUBG
SQLite, Product Radar SQLite, owner outbox, and VPS usage state. For every
SQLite file run a read-only `PRAGMA integrity_check`; compare the recorded
checksums and row/table counts with the external backup manifest. Validate
pending and sent owner events without sending them.

## Phase 3 — Rebuild and preflight

1. Build immutable OpenClaw and Product Radar images from the pushed commit.
2. Create `amadeus_network`, attach only the active compatibility services,
   and render both CasaOS compose files.
3. Run OpenClaw config validation, plugin/Skill preflight, architecture and
   secret scans, then run `scripts/doctor.sh` with FashionSigLIP required.
4. Exercise no-delivery smoke cases: a worldline policy mapping, a Product
   Radar structured event, a PUBG structured report, and an idempotent owner
   outbox enqueue in a temporary directory.

## Phase 4 — Shadow-free cutover window

This is the only phase that would change routing, and it is deliberately not
executed by the 1.4.2 Goal. At the approved window, pause inbound traffic at
the chosen edge, drain or explicitly account for the owner outbox, stop the
old CasaOS app only after the destination preflight is green, and start the
destination with `docker compose up -d --no-build`. Do not run two agent
runtimes or a shadow notification path.

## Phase 5 — Validate and reopen

Verify health, plugin tools, cron definitions, Product Radar sensor access,
FashionSigLIP MPS health, read-only NAS/VPS probes, SQLite integrity, and the
owner outbox contract. Reopen inbound traffic only after the checks are
recorded. A real user-facing inbound/outbound test requires an explicit,
separately approved test message; health or a mock is not delivery evidence.

## Rollback — 时间跳跃

Trigger rollback when destination health is not stable, a database checksum or
row-count comparison is wrong, identity resolution differs, a required secret
cannot be validated, owner outbox idempotency is broken, or any inbound event
is observed by both runtimes.

1. Pause destination ingress and stop the destination runtime.
2. Preserve destination logs, outbox, and a timestamped checkpoint. Do not
   overwrite the current host data.
3. Reactivate the last known-good CasaOS compose and immutable images from the
   pre-cutover checkpoint; restore only files proven unchanged or replay the
   destination outbox with its original event keys.
4. Re-run health, integrity, and routing checks from a new session before
   reopening ingress.

Rollback is no longer automatically safe after new writes have been accepted
by both hosts, after secrets have been rotated without a reverse copy, or
after external routing has been changed without a recorded reverse route.
Stop and perform a data-divergence review instead of guessing.

## Explicit non-actions for 1.4.2

- No Mac mini provisioning or cutover.
- No DNS, tunnel, WhatsApp pairing, Telegram allowlist, or VPS firewall change.
- No deletion of the old CasaOS app data or old compatibility network.
- No reintroduction of LangBot, n8n, n8n-sandbox, or a second runtime.
