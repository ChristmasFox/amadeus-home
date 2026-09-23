# Amadeus 1.4.8 — Phase 9 OpenClaw destination restore

Date: 2026-09-23
Destination: Amadeus-M204 / OrbStack `nyannyan` / Ubuntu 24.04
Approval: `APPROVE_AVALON_MOVE_1_4_8` and replacement approval for `config`, `workspace`, `data`, `notifications`
Goal: `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`

## Restore result

The encrypted secret bundle and cold snapshot were reverified from the M204 destination before apply. The restore script verified Avalon UUID/sentinel and confirmed that no destination OpenClaw container or process was running. It applied the approved four-root state restore and returned:

```text
OPENCLAW_STATE_RESTORE=verified
DEST_MEMORY_MD_SHA256=9a31ea1e0762065463066600aec74ea56502a95101e488338b29cfc8085bfbd8
DEST_WORKSPACE_FILE_COUNT=155
DEST_WORKSPACE_BYTES=20172403
DEST_OPENCLAW_STATE_FILE_COUNT=4888
DEST_OPENCLAW_STATE_BYTES=235858460
DEST_SESSION_AND_JSONL_FILE_COUNT=84
DEST_TRANSCRIPT_FILE_COUNT=6
DEST_IDENTITY_DB_INTEGRITY=ok
DEST_PUBG_DB_INTEGRITY=ok
OPENCLAW_PROCESS_COUNT=0
```

The restore-time inventory matched the authenticated manifest. A fresh destination inventory reported the same workspace/state/session counts and both SQLite databases as `ok`. All 859 credential tree entries have numeric owner `1000:1000`; bundle verification checked the opaque path set, content, modes, and expected runtime owner. No secret values or credential paths are recorded here.

### 2026-09-23 audit correction

The legacy `DEST_SESSION_AND_JSONL_FILE_COUNT=84` and `DEST_TRANSCRIPT_FILE_COUNT=6` values above came from substring-matching arbitrary state paths; they are not valid session/transcript counts. The archived bytes and authenticated artifact verification remain valid, but these derived counters must not be used as continuity evidence. The actual OpenClaw primary session/transcript store is `config/agents/main/agent/openclaw-agent.sqlite`; current SQLite-backed metrics and the failed operator recall test are recorded in `.agent/checkpoints/2026-09-23-kurisu-recall-audit.md`. The continuity tool now distinguishes actual SQLite tables and exact legacy file paths.

Before cold-state apply, the separate encrypted secret restore installed six absent targets and skipped two existing targets: the 9Router env and the active Changedetection datastore. Neither existing target was overwritten.

## Recovery and service boundaries

- Current pre-restore config backup: `/DATA/AppData/openclaw/.operation-skuld-restore-backups/20260923T135605Z-de55825f/config` (parent/checkpoint mode `0700`, root-owned).
- Earlier failed restore's `failed-new` copy remains at `/DATA/AppData/openclaw/.operation-skuld-restore-backups/20260923T134337Z-b60e28ee/failed-new` (root-only checkpoint). Its failure did not lose target state; rollback restored the credentials-only config before the metadata fix.
- Docker inventory still contains only `dashdot`, `ariang`, `xiaoya`, `filebrowser`, `9router`, and `changedetection`. No OpenClaw or Product Radar container/process was started. Owner ingress remains off and `DESTINATION_AUTHORITY=NO`.
- Host and guest temporary passphrase staging files were absent after the operation. The six service staging containers have no Avalon bind.
- Destination guest `/DATA` has approximately 374 GiB available; Avalon remains at the previously recorded warning level (~13% free). No capacity status was relabeled healthy.

## Restore tooling correction

The root-run restore helper now captures owner/mode metadata from the authenticated extracted source tree before copying and maps each source-relative path onto the destination tree. Regression coverage verifies distinct numeric owners and modes when running as root. The first guest root test exposed a source/destination path-prefix mapping defect; it was corrected before any retry. M204 root fixture passed after the fix.

Commits pushed to `main`:

- `65164d9 fix(migration): preserve snapshot owners during restore`
- `80ef2ee fix(migration): map restored metadata to destination`

Local focused validation passed: `pnpm test:openclaw-continuity`, `bash scripts/test-restore-skuld-secrets.sh`, `pnpm check:secrets`, Python compilation, and `git diff --check`.

## Remaining gate

The old Mac host-local `ai.openclaw.gateway` launchd job is still active on port `18789`. Its production-authority relationship is not yet classified. Phase 10 may run only as an isolated loopback migration-safe candidate with all owner/public ingress and owner delivery disabled. Classify the launchd runtime and freshly verify the unique-runtime gate before Phase 12 owner-ingress activation. Phase 9 restore is complete; Phase 10 startup and later ingress/cutover phases remain incomplete.
