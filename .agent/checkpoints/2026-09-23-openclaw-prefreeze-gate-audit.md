# Operation Skuld — Phase 6 Pre-Freeze Gate Audit

Date: 2026-09-23

## Repository release

- `VERSION=1.4.8`; migration follow-ups `81958f1` and `7c93b7e` are pushed. The latter adds authenticated legacy rewrap and makes readiness run real import/restore verification.
- Full `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:secrets`, version, syntax, and diff checks passed. The final clean-SHA readiness and doctor checks also passed.

## Pre-freeze evidence

- Latest full HomeLab backup: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z`; 16/16 MIGRATE services verified and 22/22 checksums passed.
- M204 `nyannyan` guest, Docker, and CasaOS are active. Six staged containers remain local-only; unauthenticated 9Router `/v1/models` returns the expected 401 and is not a blocker. Destination OpenClaw and Product Radar containers are absent.
- Source Avalon is mounted with recorded UUID `0C2CC618-D273-470C-8036-9AD6A0D967D7`; storage sentinel is valid. M204 host and guest report no Avalon mount. Rollback plan is ready.
- The latest full backup checksums are 22/22 verified. On clean `7c93b7e`, `migration-readiness.sh` reports 0 failures/0 warnings and `OPERATION_SKULD=READY`; its secret-bundle gate authenticates, imports/decrypts, checks metadata, and runs restore dry-run. Doctor reports 0 failures/0 warnings.
- Cold snapshot refusal/continuity/restore tooling fixture rehearsals pass. The final cold snapshot is intentionally deferred until the approved source freeze.

## Secret bundle gate — PASSED AFTER REWRAP; SOURCE CAPTURE TIME UNKNOWN

- Existing secret bundle candidates use legacy manifests without current artifact/manifest HMAC fields. The latest original candidate is under `full-homelab-backup-20260923T025614Z/runtime-preparation/secrets-20260923T030829Z`.
- On a disposable mode-0700 temporary copy of that manifest, the current auth helper successfully sealed the encrypted artifact. The official `scripts/import-skuld-secrets.sh` rehearsal then rejected the manifest policy: it declares `plaintextTemporaryFiles=false` and lacks the current cleanup/permission fields required by the importer.
- Temporary staging was automatically removed. The original encrypted bundle and manifest were not modified. A temporary HMAC does not make the legacy artifact an import-verified current-format bundle.
- A separate current-format rewrap was written to `.../secrets-rewrapped-20260923T102442Z`. Its SHA-256 is `903ab00e82bf077b3a7f5fd0594fdfec72e1754ddbf334d35bf49c6dc02e62ba`, identical to the original ciphertext; the old bundle and manifest remain byte-identical.
- The rewrapped manifest includes source bundle/manifest hashes and records the source capture timestamp as unknown. It does not claim that the rewrap time is the secret-data capture time.
- The new artifact passes HMAC authentication, official import/decrypt/logical-ID/file-metadata verification, and destination restore dry-run. The new legacy-rewrap fixture also passes plan-only, tamper rejection, and original-preservation checks.

## Repository follow-up

- A source audit found the secret-bundle HMAC helper and its end-to-end fixture were hidden by the blanket `**/*secret*` ignore rule and absent from Git. Scoped exceptions now make both reproducible from a clean clone.
- The exporter/importer correctly describe temporary plaintext staging as ephemeral, private (`0700`), and removed on exit; the destination restore verifier incorrectly required `plaintextTemporaryFiles=false`. Restore/import now enforce the same current manifest contract, and the generated encrypted fixture passes both import and restore dry-run. A negative fixture confirms the legacy false policy remains rejected.
- Full `pnpm test`, `pnpm build`, `pnpm typecheck`, `pnpm check:secrets`, version check, syntax, and `git diff --check` pass. The source legacy artifact remains untouched.

## Boundary state

- Phase 6 pre-freeze gates are ready. Stop here and request exactly `APPROVE_SOURCE_FREEZE_1_4_8`.
- Source remains active and authoritative. No final cold snapshot/export, Avalon move, destination OpenClaw restore, or owner-ingress switch occurred. The exact source-freeze token has not been supplied.
- The original capture time is unknown; Phase 7 must still create the final secret export after source freeze.
