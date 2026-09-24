# Amadeus 1.4.8 — Operation Skuld Final Cutover & OpenClaw Memory Continuity Goal

## Current operator scope revision — 2026-09-24

The operator has explicitly skipped Telegram acceptance for this cutover. Telegram remains
unchanged and running; WhatsApp is the only owner-channel acceptance requirement for this run.
The exact `COMMIT_SKULD_CUTOVER_1_4_8` token is authorized for execution after the verified
WhatsApp acceptance and unique-runtime checks. This revision supersedes the historical Telegram
acceptance requirement below while retaining source preservation, rollback, secret protection,
and single-runtime safety requirements.

## Current execution record — 2026-09-24

`COMMIT_SKULD_CUTOVER_1_4_8` has been executed with Telegram acceptance skipped and Telegram
runtime unchanged. WhatsApp acceptance passed, M204 is the sole active OpenClaw runtime, and the
72-hour rollback window is active. Final sanitized evidence is stored at
`/Volumes/Avalon/backups/operation-skuld/final-cutover-20260924T074756Z`.

## Mission

本轮是 Operation Skuld 的最后收口版本。目标不是继续扩功能，而是完成旧 Mac 权威运行时冻结、Kurisu/OpenClaw 完整状态封存、Avalon 安全迁移、Amadeus-M204 恢复、离线验收、唯一 OpenClaw 权威切换、owner ingress 切换，以及旧 Mac rollback-only 收口。

核心原则：**Kurisu 的 runtime state 才是记忆真相；Git 只允许提供初始 seed，不得在部署过程中覆盖已经存在的 runtime memory。**

## Current Baseline

- Repository version before this goal: `1.4.7`.
- Source old Mac remains the sole production authority.
- Destination host: `Amadeus-M204`.
- Destination macOS user: `nyannyan`.
- Destination OrbStack machine: `nyannyan`.
- Destination guest: Ubuntu 24.04 LTS / noble / arm64.
- Destination CasaOS/Docker is already bootstrapped.
- Non-Avalon staging already exists for Changedetection, 9Router, Filebrowser, Xiaoya, AriaNG, and Dashdot.
- Avalon is not yet attached to the destination.
- Avalon-dependent services remain stopped on the destination.
- Destination OpenClaw/Product Radar remain behind unique-runtime cutover gates.
- Existing full HomeLab backup evidence is 16/16 MIGRATE passed, but OpenClaw memory continuity is not yet considered complete.

## Hard Safety Rules

The implementation and execution MUST preserve all of the following:

- No destructive cleanup.
- No Immich legacy-source reclaim.
- No source data deletion.
- No generic Docker prune.
- No old guest deletion.
- No dual production OpenClaw.
- No dual Telegram polling authority.
- No dual WhatsApp owner ingress.
- No auto-cutover without the exact operator approval token.
- No automatic overwrite of runtime `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, or `memory/**`.
- No public/owner ingress activation before memory continuity and unique-runtime gates pass.
- No Avalon consumer startup before Avalon identity/sentinel/storage preflight passes.

Required operator approval tokens:

```text
APPROVE_SOURCE_FREEZE_1_4_8
APPROVE_AVALON_MOVE_1_4_8
APPROVE_OWNER_INGRESS_SWITCH_1_4_8
COMMIT_SKULD_CUTOVER_1_4_8
```

Codex MUST stop at each boundary and MUST NOT infer approval from conversational wording.

---

## Phase 1 — Separate Git Seeds from Runtime Workspace

### Problem

The repository currently tracks the OpenClaw workspace baseline files while deployment preparation can write them into the runtime workspace. This creates a risk that a restored live `MEMORY.md` or other runtime workspace state is replaced by repository content.

### Required authority model

```text
Runtime authority:
  /DATA/AppData/openclaw/workspace

Repository workspace files:
  seed / baseline only
```

The tracked workspace content MUST be made unambiguously seed-only. Equivalent implementation designs are acceptable, but the resulting behavior MUST make it impossible for a normal deploy/upgrade to silently overwrite existing runtime workspace state.

Preferred repository shape:

```text
integrations/openclaw/workspace-seed/
├── AGENTS.seed.md
├── SOUL.seed.md
├── USER.seed.md
└── MEMORY.seed.md
```

If another naming scheme is used, it must encode the same seed-only semantics.

### `openclaw_prepare.py` behavior

Required default behavior:

```text
workspace file missing  -> seed it
workspace file exists   -> preserve runtime copy
```

Normal deployment MUST NOT overwrite existing:

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `memory/**`
- any runtime-created workspace state

Required evidence:

```text
SEED_MISSING_ONLY=yes
RUNTIME_WORKSPACE_PRESERVED=yes
```

### Explicit workspace sync tool

Add an explicit tool, for example:

```bash
scripts/openclaw-workspace-sync.sh --plan
```

It should show seed/runtime hash and diff without mutation.

Any actual sync MUST require per-file explicit approval, for example:

```bash
scripts/openclaw-workspace-sync.sh --apply --approve-file SOUL.md
```

Do not provide an implicit bulk-overwrite path.

---

## Phase 2 — Define Complete Kurisu State

From 1.4.8 onward, Kurisu/OpenClaw continuity MUST include all of the following state classes:

```text
/data authority in guest:

/DATA/AppData/openclaw/config
/DATA/AppData/openclaw/workspace
/DATA/AppData/openclaw/data
/DATA/AppData/openclaw/notifications

Separate encrypted Skuld secret bundle:
  /DATA/AppData/openclaw/openclaw.env
  /DATA/AppData/openclaw/secrets/**
  /DATA/AppData/openclaw/config/credentials/**
```

Conceptually:

```text
Kurisu State
├── OpenClaw state/config
├── Runtime workspace
│   ├── AGENTS.md
│   ├── SOUL.md
│   ├── USER.md
│   ├── MEMORY.md
│   ├── memory/**
│   └── runtime-created files
├── Amadeus data
│   ├── identity.sqlite
│   ├── pubg.sqlite
│   └── other runtime state
├── Owner notification state
└── Secrets via encrypted Skuld bundle
```

The implementation MUST discover and preserve OpenClaw session/transcript/state databases that exist under the persisted state directories. Do not assume only the custom Amadeus SQLite files matter. Provider credentials under `config/credentials/**` are kept out of the cold state archive and handled only by the encrypted secret bundle.

---

## Phase 3 — Add OpenClaw Cold Snapshot / Verify / Restore

Add dedicated tooling equivalent to:

```text
scripts/openclaw-cold-snapshot.sh
scripts/verify-openclaw-cold-snapshot.sh
scripts/restore-openclaw-cold-snapshot.sh
```

Exact filenames may differ, but responsibilities must remain separate and testable.

### Snapshot precondition

A final cold snapshot MUST refuse to run while source OpenClaw/Gateway is active.

Required check:

```text
source OpenClaw container/process = stopped
```

Failure state:

```text
COLD_SNAPSHOT=BLOCKED
```

There must be no generic `--force` path that bypasses consistency protection.

### Snapshot content

Capture complete persisted OpenClaw state necessary for exact recovery, including:

```text
config/**
workspace/**
data/**
notifications/**
```

Secrets MUST remain separate in the encrypted Skuld secret bundle.

Because memory/session state is private, the cold snapshot itself MUST use protected/encrypted storage or an equivalently secure artifact design. Temporary plaintext staging, if unavoidable, must be truthful and ephemeral:

```text
private staging permissions = 0700
plaintext staging = ephemeral
cleanup on success/failure
```

### Snapshot manifest

Generate a sanitized manifest containing at least:

```json
{
  "sourceHost": "...",
  "sourceMachine": "...",
  "createdAtUtc": "...",
  "amadeusVersion": "1.4.8",
  "gitCommit": "...",
  "openclawImage": "...",
  "workspace": {
    "fileCount": 0,
    "totalBytes": 0,
    "memoryMdSha256": "...",
    "memoryTreeSha256": "..."
  },
  "state": {
    "fileCount": 0,
    "totalBytes": 0
  },
  "sqlite": {
    "integrity": "passed"
  },
  "artifactSha256": "..."
}
```

Manifest MUST NOT contain secret values, bot tokens, phone numbers, message text, transcript content, or memory plaintext.

---

## Phase 4 — Memory Continuity Evidence

Before source freeze completes, collect source evidence:

```text
SOURCE_MEMORY_MD_SHA256
SOURCE_MEMORY_TREE_SHA256
SOURCE_WORKSPACE_FILE_COUNT
SOURCE_WORKSPACE_BYTES
SOURCE_IDENTITY_DB_SHA256
SOURCE_IDENTITY_DB_INTEGRITY
SOURCE_PUBG_DB_INTEGRITY
SOURCE_OPENCLAW_STATE_FILE_COUNT
SOURCE_OPENCLAW_STATE_BYTES
```

After destination restore, collect equivalent destination evidence:

```text
DEST_MEMORY_MD_SHA256
DEST_MEMORY_TREE_SHA256
DEST_WORKSPACE_FILE_COUNT
DEST_WORKSPACE_BYTES
DEST_IDENTITY_DB_SHA256
DEST_IDENTITY_DB_INTEGRITY
DEST_OPENCLAW_STATE_FILE_COUNT
DEST_OPENCLAW_STATE_BYTES
```

Expected result is source/destination equality except for explicitly documented normalization. Any mismatch in memory tree/hash or required database integrity MUST block cutover.

---

## Phase 5 — Tests and Release Gate

Wire new migration tests into normal `pnpm test` / release validation.

Tests MUST cover at least:

- existing `MEMORY.md` is never overwritten by deployment;
- existing `USER.md` is never overwritten;
- existing `AGENTS.md` is never overwritten;
- existing `SOUL.md` is never overwritten;
- fresh workspace receives seeds;
- workspace sync defaults to plan-only;
- actual workspace sync requires explicit per-file approval;
- cold snapshot refuses a running OpenClaw;
- cold snapshot contains runtime workspace/state;
- cold snapshot manifest contains hashes and no secret values;
- restore refuses dangerous overwrite unless explicitly approved;
- restore reproduces `MEMORY.md` hash;
- restore reproduces `memory/**` tree hash;
- discovered SQLite databases pass integrity validation;
- migration-safe OpenClaw cannot activate owner ingress;
- unique-runtime gate blocks two production OpenClaw instances.

Before production freeze, bump and release:

```text
VERSION=1.4.8
```

Required repository validation:

```bash
pnpm build
pnpm typecheck
pnpm test
scripts/doctor.sh
scripts/migration-readiness.sh
```

Cutover may only use a clean, committed, pushed, traceable Git SHA.

---

## Phase 6 — Final Pre-Freeze Gate

Before requesting `APPROVE_SOURCE_FREEZE_1_4_8`, verify:

```text
M204 guest = healthy
M204 Docker/CasaOS = healthy
M204 9Router staging = healthy
M204 OpenClaw production runtime = stopped
M204 Product Radar production runtime = stopped
M204 Telegram authority = off
M204 WhatsApp authority = off
latest full HomeLab backup = verified
secret bundle = verified
cold snapshot tooling rehearsal = passed
Avalon source UUID = recorded
Avalon sentinel = valid
rollback plan = ready
```

Known noncritical items may remain explicitly `DEFERRED_NONCRITICAL` if they do not block OpenClaw, 9Router, Avalon, Immich/core DBs, or owner channels. Never misreport them as PASS.

At this point STOP and request exactly:

```text
APPROVE_SOURCE_FREEZE_1_4_8
```

---

## Phase 7 — Source Freeze

Only after the exact approval token:

1. Mark migration window started.
2. Stop source OpenClaw/Gateway and verify stopped.
3. Verify source Telegram/WhatsApp owner ingress is no longer consuming.
4. Stop Product Radar and other relevant writers as required.
5. Create FINAL OpenClaw cold snapshot.
6. Verify snapshot checksum, memory hashes, state counts, and all discovered SQLite integrity.
7. Create FINAL encrypted Skuld secret bundle.
8. Create FINAL service-aware/full HomeLab backup.
9. Verify manifests/checksums.
10. Stop all Avalon writers/consumers that can mutate state, including Immich and download/media services as applicable.
11. Flush/sync filesystem state.
12. Mark source frozen.

Required end state:

```text
SOURCE_FROZEN=YES
SOURCE_OPENCLAW_STOPPED=YES
SOURCE_OWNER_INGRESS=OFF
DESTINATION_AUTHORITY=NO
```

Then STOP and emit:

```text
SAFE_TO_MOVE_AVALON=yes
```

Request exactly:

```text
APPROVE_AVALON_MOVE_1_4_8
```

---

## Phase 8 — Avalon Move Boundary

After approval, safely unmount Avalon on the source. Confirm source no longer has the volume mounted.

The user performs the physical disk move. Codex must not claim the physical action occurred until the destination observes and verifies the disk.

On Amadeus-M204, before starting any Avalon consumer, verify:

```text
mount path = /Volumes/Avalon
volume UUID = expected
filesystem = expected
sentinel = valid
capacity = expected
read test = passed
write test = passed
Immich media root exists
backup artifacts exist
final OpenClaw cold snapshot artifact exists
```

Required gate:

```text
AVALON_IDENTITY=verified
AVALON_SENTINEL=verified
AVALON_CAPACITY=passed
AVALON_CONTENT=verified
```

Any failure => `CUTOVER=BLOCKED`.

Do not permit Docker to create a fake empty `/Volumes/Avalon` replacement path.

---

## Phase 9 — Destination Restore

Restore only from verified artifacts and encrypted secret bundle.

Recommended high-level dependency order:

```text
1. secrets
2. 9Router
3. OpenClaw cold state
4. OpenClaw runtime workspace
5. Amadeus identity/PUBG/runtime data
6. Product Radar DB/state
7. Immich PostgreSQL
8. Avalon-dependent services
9. media/download services
10. remaining independent services
```

OpenClaw owner ingress MUST remain OFF throughout restore.

Restored runtime workspace is authoritative. Repository seed files MUST NOT replace restored files.

---

## Phase 10 — Migration-Safe OpenClaw

Provide a migration-safe startup mode that allows local validation while owner channels remain disabled.

It MUST allow:

```text
OpenClaw process start
health check
9Router access
local tool/state access
memory/session inspection
```

It MUST disable:

```text
Telegram ingress
WhatsApp ingress
KOOK production ingress if applicable
public ingress
owner notification delivery that would escape the migration sandbox
```

Do not mutate the canonical restored OpenClaw config to achieve this. Use a temporary overlay/runtime mode that leaves the restored canonical state intact.

---

## Phase 11 — Kurisu Acceptance Gate

### Machine-verifiable acceptance

Require:

```text
MEMORY.md hash identical
memory/** tree hash identical
workspace file counts consistent
restored OpenClaw state readable
all discovered required SQLite integrity checks = ok
identity.sqlite integrity = ok
session/transcript state readable
OpenClaw health = healthy
9Router reachable
```

Output:

```text
OPENCLAW_MEMORY_CONTINUITY=verified
```

### Operator acceptance

The operator performs a small number of memory/persona checks against known prior context. Human acceptance supplements but does not replace hash/database evidence.

Output after approval:

```text
KURISU_ACCEPTANCE=passed
```

---

## Phase 12 — Unique Runtime Gate

Before owner ingress activation, verify:

```text
Old Mac production OpenClaw running count = 0
Old Mac owner ingress = disabled
M204 production candidate OpenClaw count = 1
```

Required output:

```text
OPENCLAW_ACTIVE_RUNTIME_COUNT=1
```

`0` is diagnosable. `2` is an immediate blocker.

Then STOP and request exactly:

```text
APPROVE_OWNER_INGRESS_SWITCH_1_4_8
```

---

## Phase 13 — Owner Ingress Switch

After exact approval:

1. Start canonical destination OpenClaw.
2. Enable Telegram.
3. Enable WhatsApp.
4. Enable KOOK if currently part of production authority.
5. Enable frpc/Nginx Proxy Manager/public ingress last.

Run owner-channel acceptance:

```text
Telegram: exactly one response, from M204, no duplicate
WhatsApp: exactly one response, correct owner identity and tool policy
Old Mac: receives/produces no owner-channel response
```

Required outputs:

```text
TELEGRAM_ACCEPTANCE=passed
WHATSAPP_ACCEPTANCE=passed
DUPLICATE_RUNTIME=none
```

Then STOP and request exactly:

```text
COMMIT_SKULD_CUTOVER_1_4_8
```

---

## Phase 14 — Commit Cutover and Source Closure

After exact commit token, record:

```text
DESTINATION_AUTHORITY=Amadeus-M204
SOURCE_AUTHORITY=retired
OPERATION_SKULD_CUTOVER=COMMITTED
```

The old Mac MUST enter `ROLLBACK_ONLY`, not be deleted or wiped.

Required old-source state:

```text
OpenClaw stopped
Product Radar stopped
Telegram disabled
WhatsApp disabled
frpc/public ingress disabled
Avalon absent
production autostart neutralized
```

Add a durable source decommission/rollback sentinel so that a reboot of the old Mac cannot silently resurrect a second production OpenClaw. Existing `restart: unless-stopped` or CasaOS behavior must not re-establish production authority.

---

## Phase 15 — Rollback Window

Preserve the old source in rollback-ready state for at least 72 hours.

During the rollback window:

- do not delete the old OrbStack guest;
- do not delete source AppData;
- do not delete rollback images/checkpoints;
- do not remove backup artifacts;
- do not run Immich old-source reclaim;
- do not reformat the old Mac.

Important: once M204 has accepted new messages or produced new memory/state, a rollback MUST first preserve/reconcile destination runtime delta. Never simply restart stale source OpenClaw after new destination activity.

---

## Required Final Evidence

Final sanitized report MUST contain:

```text
VERSION=1.4.8
DESTINATION_HOST=Amadeus-M204
DESTINATION_ORBSTACK_MACHINE=nyannyan

OPENCLAW_REPO_WORKSPACE_MODE=seed-only
OPENCLAW_RUNTIME_WORKSPACE_AUTHORITY=/DATA/AppData/openclaw/workspace

OPENCLAW_COLD_SNAPSHOT=verified
OPENCLAW_STATE_RESTORE=verified
MEMORY_MD_CONTINUITY=verified
MEMORY_TREE_CONTINUITY=verified
SESSION_STATE_CONTINUITY=verified
IDENTITY_STATE_CONTINUITY=verified

AVALON_DESTINATION_PREFLIGHT=passed

SOURCE_FROZEN=YES
SOURCE_OPENCLAW_STOPPED=YES
SOURCE_OWNER_INGRESS_DISABLED=YES

OPENCLAW_ACTIVE_RUNTIME_COUNT=1
DESTINATION_OPENCLAW_AUTHORITY=YES

TELEGRAM_ACCEPTANCE=passed
WHATSAPP_ACCEPTANCE=passed
DUPLICATE_RUNTIME=none

OLD_MAC_ROLLBACK_READY=YES
ROLLBACK_WINDOW=72h

OPERATION_SKULD_CUTOVER=COMMITTED
IMMICH_SOURCE_RECLAIM=PENDING
```

## Definition of Done

1. Amadeus-M204 is the sole HomeLab/OpenClaw authority.
2. Avalon is verified and attached to Amadeus-M204.
3. Runtime workspace is restored from source state, not recreated from Git seeds.
4. `MEMORY.md` and `memory/**` continuity are machine-verified.
5. Session/transcript/OpenClaw state continuity is verified.
6. Identity/PUBG/runtime data integrity is verified.
7. Exactly one production OpenClaw exists.
8. Telegram/WhatsApp acceptance produces no duplicate runtime behavior.
9. Old Mac is rollback-only and cannot auto-resurrect production authority.
10. Old source remains preserved for the rollback window.
11. Immich legacy-source reclaim remains pending and out of scope.

The intended result is not merely that a new container runs. The intended result is that the Kurisu running on Amadeus-M204 is the continuation of the source runtime state, with preserved persona, memory, sessions, identity, and single-runtime authority.
