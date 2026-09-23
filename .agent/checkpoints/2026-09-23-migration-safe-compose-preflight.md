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

## M204 build and first apply attempt

After commit `9cb5474` was pushed and fast-forwarded, the M204 host built the ARM64 image `local/openclaw-amadeus:git-9cb5474-20260923145233` and loaded it into guest `nyannyan`. Host and guest both report image digest `4e7ea2d63ff7a80d98575d60060ad3825567b6fa3fc8e3c860d7b0f8db069412`. The live `--plan` passed Avalon UUID/sentinel checks and correctly blocked on the then-missing Compose without persistent changes.

The approved apply atomically installed canonical Compose and passed the full merged preflight. The first attempt stopped before invoking Docker Compose because the script ran a redundant `cd` on macOS into the guest-only `/var/lib/casaos/apps/openclaw` path. After removing it, a second apply created and started the container, which exited with code 78. Read-only `doctor --json`, run through a temporary Compose service, returned:

```text
invalid config: must not have additional properties: "ownerNotificationDeliveryEnabled"
```

The migration helper had added that property to the temporary JSON overlay. Owner delivery is controlled by the supported Compose environment variable `OWNER_NOTIFICATION_DELIVERY_ENABLED=false`; Amadeus reads this environment variable when its plugin config omits the property. The source fix now leaves the JSON unchanged, validates the container environment in the startup assertion, and updates the unique-runtime probe to use inspected environment. The canonical restored config was never edited. The OpenClaw container currently exists but is exited; there is no healthy runtime or exposed ingress.

M204 package build/typecheck and package tests passed for Identity, Presentation, PUBG Domain/plugin, and Amadeus plugin: 70 tests total. Migration-safe config and unique-runtime regression tests passed after the schema fix. The local control-side secrets scan, FAST workflow, shell/Python syntax, version validation, and diff check passed. M204 has no `rg`; the target-side secrets script emits missing-command warnings and is not accepted as a pass. Before retry, move the generated invalid file `/run/openclaw-migration-safe/openclaw.json` to a distinct preserved filename and let the helper generate the corrected overlay; retain the original under the root-protected `/run` directory. No image pruning was performed. Phase 10 startup and Phase 11 acceptance remain incomplete; the host-local `ai.openclaw.gateway` authority must be classified before Phase 12 owner-ingress activation. Owner ingress and public ingress remain off.

## Current live acceptance (2026-09-23)

The generated invalid overlay was preserved as `/run/openclaw-migration-safe/openclaw.json.schema-invalid-20260923` (SHA-256 `795c0b1b5662590ae4c2348c35717d2da336ea2ba5f74c1676ae6e324d4352eb`), then the corrected overlay was regenerated without changing canonical restored config. The approved safe apply now reports:

```text
MIGRATION_SAFE_PREFLIGHT=passed image=local/openclaw-amadeus:git-9cb5474-20260923145233
MIGRATION_SAFE_OPENCLAW=running
TELEGRAM_INGRESS=disabled
WHATSAPP_INGRESS=disabled
PUBLIC_INGRESS=disabled
OWNER_NOTIFICATION_DELIVERY=disabled
OPENCLAW_STATE=restored-canonical
```

The container is `healthy`; the unique-runtime probe reports `M204_PRODUCTION_CANDIDATE_COUNT=1`, `OPENCLAW_ACTIVE_RUNTIME_COUNT=1`, and `MIGRATION_SAFE_CANDIDATE=passed`. The source CasaOS runtime/process count is 0 and owner ingress is disabled. This is not yet the Phase 12 gate: the separate old Mac host-local `ai.openclaw.gateway` LaunchAgent remains unclassified and must be inspected before owner ingress.

Current guest inventory was compared to the authenticated cold-snapshot manifest using sanitized fields only:

```text
MEMORY_MD_SHA256=9a31ea1e0762065463066600aec74ea56502a95101e488338b29cfc8085bfbd8
MEMORY_TREE_SHA256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
WORKSPACE_TREE_SHA256=ee6e69b546163de58b32e41365c4944bd684c939314acd90261cd6547ea4ca94
WORKSPACE_FILES=155
WORKSPACE_BYTES=20172403
LEGACY_SESSION_AND_JSONL_FILE_COUNT=84 (INVALID: path-substring heuristic)
LEGACY_TRANSCRIPT_FILE_COUNT=6 (INVALID: path-substring heuristic)
SQLITE_DATABASES=6/6 integrity=ok
IDENTITY_DB=ok
PUBG_DB=ok
```

Therefore `OPENCLAW_MEMORY_CONTINUITY=verified` for the machine checks. Runtime startup increased state inventory from the cold-restore 4,888 files to 4,891; all six discovered DBs remain valid. Read-only `doctor --json` is config-valid but returns three warnings: loopback-only onboarding, disabled device-pair, and missing `skill_workshop` sender policy. These are outside the Goal's listed Phase 11 machine criteria. The 9Router fetch in the safe-start smoke accepts expected HTTP 200 or the previously acknowledged unauthenticated HTTP 401.

Phase 10 and Phase 11 machine checks are complete, but natural-prompt operator memory/persona acceptance is failed pending the corrected candidate retest. No Telegram, WhatsApp, public ingress, or owner notification delivery is active. No source closure or public switch occurred. Old Mac LaunchAgent classification, Phase 12 unique-runtime recheck, exact `APPROVE_OWNER_INGRESS_SWITCH_1_4_8`, real Telegram/WhatsApp acceptance, exact `COMMIT_SKULD_CUTOVER_1_4_8`, source closure, and the full 72-hour rollback window remain ahead.

### Fresh source-runtime audit (read-only, 2026-09-23)

On control/source host `xu-mac` (macOS 26.0.1), launchd reports `ai.openclaw.gateway` running with `RunAtLoad=true` and `KeepAlive=true`. The host-local `~/.openclaw/openclaw.json` reports `gateway.bind=loopback`, port `18789`, and only the `imessage` channel/plugin enabled; `lsof` confirms IPv4/IPv6 loopback listeners only. The retained gateway log is 27,829,535 bytes, spans 2026-03-08 through 2026-09-23, and contains 18 lines matching coarse inbound keywords; no message contents or sender identifiers were read. This proves the gateway is active and not a stale stopped artifact, but does not prove whether it is part of this migration's production authority. No stop/disable mutation was performed; operator classification remains required.

Fresh M204 read-only check: the migration-safe `openclaw` container is `healthy`, uses `local/openclaw-amadeus:git-9cb5474-20260923145233`, has restart policy `no`, and publishes no ports. Exact ingress-disabled/hash/database evidence above remains the prior successful machine-gate record. The old session/transcript counts are invalidated by the 2026-09-23 recall audit; actual SQLite-backed counts and operator acceptance failure are recorded in `.agent/checkpoints/2026-09-23-kurisu-recall-audit.md`.

### Operator memory/persona probe (2026-09-23, no delivery)

The operator supplied three questions. They were sent in one new safe-mode session through the loopback Gateway; the command omitted both channel selection and `--deliver`. The candidate answered with an owner identity and returned `unknown` for the two alias questions. Exact personal names and alias prompt text are intentionally omitted from this tracked checkpoint. The run reported two failed tool calls. Subsequent read-only inspection found corresponding records in Identity DB and historical transcript, confirming that recall failed even though records are stored. Operator acceptance is therefore failed, not pending.

Read-only `memory status --json` reports 2 indexed files / 35 chunks, `dirty=true`, FTS enabled/available, vector index `empty`, and index identity mismatch (`fts-only` vs configured `text-embedding-3-small`). Provider state is pending. No reindex, reset, or canonical memory/workspace mutation was performed. Reindexing is not authorized implicitly because the configured provider may receive private memory text; instead fix the deterministic Identity tool call path and verify retrieval without exposing content. `KURISU_ACCEPTANCE=failed` pending a corrected safe-mode retest.
