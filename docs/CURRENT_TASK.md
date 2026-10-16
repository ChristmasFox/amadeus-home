# Current Task — Lab Memory Recovery and Dual Product Release Engineering

Date: 2026-10-17 (Asia/Shanghai).

## 2026-10-17 — Gate-Local autonomous deployment and R5 canary

Gate-Local repo-wide standing authorization and guarded candidate rollout are
merged in PRs #14–#16. The final CI-green source is
`e90b36f0281f78514e1aa2df65a8906adfd9c418`; Gate-Local runs
`local/pubg-saas:git-e90b36f0281f78514e1aa2df65a8906adfd9c418` (portable digest
`sha256:b9063ee922dad157b8d479473bc347fd65225976834b0ddb0e88d9063ee8dbf0`).
Post-deploy checks found all four services healthy and the single-tenant
PUBG Intelligence canary exact-match enabled; the tenant ID is intentionally
not recorded here. There was no migration delta. M2 remains PAUSED.

The full encrypted PostgreSQL checkpoint is
`~/.local/share/pubg-saas-backup/gate-local-20261016T181118Z-e90b36f0281f`
and reports `verified_recoverable`; the dump SHA-256 is
`c4c21d8b13413191d340e9fa74be06b12457b4d7ae6a5b491663df9d55f8f8f3`.
Automatic rollback stops Gateway/Worker, restores the full database and prior
Compose/environment/image, then restarts the prior application if migration or
health/smoke checks fail. No Lab or M2 runtime state changed.

Active Goal: `docs/GATE_MEMORY_PLUGIN_EXTRACTION_GOAL.md`.

## 2026-10-16 — Gate memory P3–P5 candidate deployed

P0–P5 are complete. PR #12 source commit
`3e96b573839b26897cdaa0438a48a9c0f1b39f56` passed all six GitHub checks and
was deployed to Gate-Local through `devctl goal finish-phase P3` and the
protected `release-gate.sh candidate --apply` path. Candidate image
`local/pubg-saas:git-3e96b573839b26897cdaa0438a48a9c0f1b39f56` is running
healthy in Gateway, Worker, and egress-proxy; PostgreSQL remains healthy and
unchanged. Migrations 0030 and 0031 are present in `schema_migrations`.

The full encrypted PostgreSQL backup is at
`/Users/nyannyan/.local/share/pubg-saas-backup/gate-local-20261016T132836Z-3e96b573839b/pubg-saas.dump.age`
(SHA-256 `c71caff3e8dea9595c4e5d794be934b69a6f8f5d04516b2cd2385613fd5961d6`);
the protected checkpoint reports `verified_recoverable`. Detailed runtime,
migration, rollback and source evidence is in
`.agent/checkpoints/2026-10-16-gate-memory-plugin-extraction-p3-candidate.md`.
M2 remains PAUSED with no clearance; Lab and the separate 9router service were
not changed. Runtime memory flags report default-enabled read/write/autoLearn;
embedding is disabled because its dedicated config is absent. P6 final audit
remains active.

## 2026-10-16T19:01+08:00 — Gate memory extraction P0 candidate

P0 is complete at source SHA `243ab74ebd9a87f0f132fe56f904dfaf601f7492`.
The pre-extraction boundary map and the ordinary-reply/Dreaming concurrency
regression are recorded in `docs/GATE_MEMORY_PACKAGE_BOUNDARY.md` and
`apps/pubg-saas/tests/gate-memory-consolidation.integration.test.ts`. The
protected `devctl goal finish-phase P0` path applied Gate-Local candidate
`local/pubg-saas:git-243ab74ebd9a87f0f132fe56f904dfaf601f7492` (image ID
`sha256:409e2de388f403d12578d27f0292928e53de0c35404d7470533aa49c60e99695`).
Gateway, Worker, PostgreSQL, and egress-proxy are running healthy; the three
app containers have restart count 0. The protected deployment checkpoint is
`/Users/nyannyan/.local/share/pubg-saas-backup/gate-local-20261016T110130Z-243ab74ebd9a`.
M2 remains PAUSED with clearance reserved for formal release; Lab was not
touched. P1 is now in progress.

## 2026-10-16T18:39+08:00 — Gate 9router 0.5.104 live

PR #11 was rebased onto `8a731d9`, passed all seven GitHub checks, and merged
as `da39ff1767b6d2880a1acfc9fe78e11405461cad`. Only Gate's standalone
`pubg-saas-9router` service was switched to
`local/9router-saas:git-da39ff1767b6d2880a1acfc9fe78e11405461cad` (9router
0.5.104, image ID `sha256:2fbdfa2596fe655071d10f5e3252be88d0e10ba2a4ab28329a99decab91d4d02`).
It is healthy; API, ASR, and TTS health endpoints returned 200. `arthur-combo`
still has Gemini first, a minimal request returned 200 through the configured
egress proxy, and the Gate Worker can reach the authenticated 9router models
API. Gate Gateway/Worker/egress-proxy remain on 7208429; Lab and M2 were not
touched. The fresh encrypted full-state backup, checksum, and rollback command
are recorded in `.agent/checkpoints/2026-10-16-gate-9router-0.5.104-upgrade.md`.

## 2026-10-16T17:31+08:00 — Gate-Local 7208429 candidate live

Arthur authorized the PR #9 simplified Gate-Local candidate flow for
`7208429655ab953c0f5840d89838e7e508435ac8`. Its command
`bash scripts/release-gate.sh candidate --apply --approval-ref arthur-20261016-gate-local-7208429`
stopped before runtime changes with `candidate_host_tools_unavailable` because
the Homebrew libpq bin directory was not on PATH. The authorized manual fallback built with the existing
OrbStack Buildx builder and `apps/pubg-saas/Dockerfile`, ran the Compose
migrator, then switched Gateway, Worker, and egress-proxy. Detailed evidence,
the encrypted PG backup, and recovery notes are in
`.agent/checkpoints/2026-10-16-gate-local-7208429-candidate-live.md`.

Gate-Local is live on `pubg-saas-m2-clean` / `pubg-saas-public` at image
`local/pubg-saas:git-7208429655ab953c0f5840d89838e7e508435ac8`
(image ID `sha256:aa15e0fb7072f4d708f9e419eea2e253b62a8245d0ab7f8ccb550c6a04c0ab0d`).
All three app containers and PostgreSQL are healthy; Gateway `/healthz` is 200,
and no Gateway error-level logs were found in the post-deploy window. The
migrator succeeded and `schema_migrations` matches the 28 IDs in the candidate
runner through `0029_gate_memory_index_generations.sql`; optional pgvector
`0025` remains absent. The encrypted pre-deploy PG dump is verified and its
SHA-256 and rollback copies are recorded in the checkpoint. Gate memory flags
remain unset/default-off. M2 remains PAUSED with no clearance created; Lab was
not touched.

## 2026-10-16T17:38+08:00 — Gate pg_restore PATH fix

M204 already has Homebrew `libpq 18.6_1` and
`/opt/homebrew/opt/libpq/bin/pg_restore` (PostgreSQL 18.6); `brew install
libpq` confirmed it is current. `gate-local-candidate.py` now detects standard
Homebrew libpq bin directories and adds the one containing `pg_restore` to its
child-process PATH. Focused Gate autopilot tests pass (29), the installed
path/version lookup passes, and `bash scripts/release-gate.sh candidate`
reports `APPLY=not-requested`. No deployment/apply was run.

## 2026-10-16T00:16+08:00 — read-only confirmation after authorization correction

Arthur's withdrawal of the previous Dreaming/config/restart authorization is
in force. A fresh read-only `scripts/release-lab.sh status --live --manifest
<released-manifest>` captured at `2026-10-15T16:15:58Z` reports Lab 1.10.5
healthy and `DRIFT_STATUS=IN_SYNC` at the released image and manifest.

At `2026-10-15T16:16:46Z`, read-only `openclaw memory status --json --agent
main` reported 5 files / 92 chunks, `dirty=false`, hybrid search, FTS enabled
and available, and a complete enabled 1024-D vector index with valid
identity. Scan issues and Dreaming suspicious session files/lines are zero.
Provider metadata remains `pending`; no provider probe was run. No memory
content was read or emitted. Since the index is current, there is no
incremental refresh pending; the already-recorded post-restart persistence
evidence remains sufficient, so no restart is needed for this verification.

The local process list has no `release-config-hash` process. No kill signal,
Lab config edit, restart, Dreaming invocation, index write, or other runtime
write occurred. Gate M2 and the three pre-existing unstaged Gate test/OCI
edits remain untouched.

## 2026-10-16T00:24+08:00 — P3/P4 Gate tooling verification

The latest `origin/main` fetch added no commits. The three pre-existing
Gate-related worktree changes were reviewed, validated, and committed locally
as two source commits: `5a6a81f` teaches the SaaS OCI verifier to ignore
BuildKit attestation configs while still checking runnable amd64/arm64 image
labels and digests; `b143ab1` makes the durable KOOK ingress test wait for the
handler and persisted sequence together, removing an assertion race. No M2
application or database runtime was changed.

`pnpm workflow:plan` classified the three changed paths as `RUNTIME`, with
Docker build forbidden and no Compose action. Validation passed:
`python3 scripts/test-release-tooling.py`, `pnpm typecheck:pubg-saas`,
`pnpm test:pubg-saas` (155/155, zero skips), `pnpm typecheck:pubg`,
`pnpm test:pubg` (71/71), `pnpm check:architecture`, `pnpm check:secrets`, and
`git diff --check`. The PostgreSQL suite used the CI-pinned PostgreSQL 18.1
image, bound to loopback on port 55439 with tmpfs storage, 768 MiB / 1 CPU;
the disposable test container was removed, no volume or listener remained,
and the existing `pubg-saas-pg18` container was left untouched.

Official actionlint v1.7.12 passed against all five repository workflows after
the downloaded macOS ARM64 archive matched its published SHA-256. The binary
was temporary and removed. This validates workflow semantics locally; GitHub
Actions itself remains unrun because the local commits have not been pushed.
Gate M2 Gateway/Worker/PostgreSQL/proxy/9Router/BuildKit remained running,
Buildx entries were terminal, and no migration/build/deploy process was
active. No M2 database query or service action occurred. No Docker image build,
Lab/Gate deployment, product release, tag, or push occurred in this follow-up.

## 2026-10-16T00:29+08:00 — final P1/P3 fixture sweep

The final local source sweep passed: `node scripts/test-patch-openclaw-memory-core.mjs`,
`python3 scripts/test-openclaw-memory-policy.py`,
`python3 scripts/test-openclaw-group-image-policy.py` (6/6),
`bash scripts/test-openclaw-session-isolation.sh`,
`python3 scripts/test-image-impact.py`,
`python3 scripts/test-lab-runtime-snapshot.py`,
`python3 scripts/test-lab-memory-acceptance.py`,
`bash scripts/test-openclaw-lineage-compatibility.sh`,
`python3 scripts/test-deploy-radar-only-apply.py`, both product SemVer test
scripts, and `pnpm test:workflow`. The lineage fixture's missing-source lines
were expected synthetic inputs; the fixture passed. Radar-only apply rejection
recorded zero runtime writes. No Lab/Gate live service, production database,
secret, or memory index was changed.

## Fresh continuation audit — 2026-10-16T00:03+08:00

Fetched `origin/main`; it added no commits. `origin/main` remains an ancestor
of local `main`, now eight commits ahead at `ae94c27`. The only worktree edits
remain the three pre-existing Gate M2 test/OCI files; they were inspected and
left unstaged and unchanged.

Read-only `scripts/release-lab.sh status --live --manifest` reports released
Lab 1.10.5 `IN_SYNC`, healthy at source
`57e472ebe014a0b4d3574d7ef30107340dc99308` and digest
`sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`.
Memory status reports 5 indexed/scanned files, 92 chunks, `dirty=false`,
hybrid search, FTS enabled/available, and an enabled, complete 1024-D vector
index with valid identity and zero scan issues. The status metadata reports
provider state `pending`; this status read did not probe the provider. The
previously accepted Embedding probe and keyword/semantic retrieval remain the
separate evidence. Session-corpus metadata reports 3 files and zero
suspicious files/lines; no transcript or memory content was read. No
incremental refresh is pending, so no index write was issued.

The existing “Memory Dreaming Promotion” job has one enabled entry at
`0 3 * * *`, `Asia/Shanghai`; metadata reports last status `ok` at
`2026-10-15T22:34:09+08:00` and next run `2026-10-16T03:00:00+08:00`. At this
snapshot it had not reached the next scheduled time. Its definition and
schedule were not changed. No Lab config edit, restart, Dreaming invocation,
or release action occurred in this audit.

Product Radar is healthy, but source/version and product-owned provenance
remain `UNKNOWN` at digest
`sha256:1f708837c5d55fcb608108621d74402936a767397fb76af0b4c9c4fc655e396b`.
The `633dd216339f` commit object is absent; a local unreachable-commit scan
found no commit touching Product Radar or Presentation that recovers it. The
Lab default path still rejects a Radar-only apply before build/checkpoint;
no build or apply was attempted.

Gate M2 remains paused and unchanged. Gateway/Worker, PostgreSQL, egress
proxy, SaaS 9Router, and BuildKit were running; every returned Buildx history
entry was terminal, and no migration container or `release-config-hash`
process was present. No M2 database query, migration, build, or service action
ran. Runtime writes for this audit: `none`.

## P4 local PostgreSQL and cross-product regression — 2026-10-16T00:12+08:00

The Gate database suite, previously not run because no safe local URL was
available, passed `pnpm test:pubg-saas` 155/155 with zero skips against a new
isolated `pubg_test` database using the CI-pinned PostgreSQL 18.1 image digest.
The image was `postgres:18.1-bookworm@sha256:cc9f4143a8d2fa8cf3749d0cb4d26ecf2d53a77a2ac807e9ebd67ae22426221a`.
The database was bound only to `127.0.0.1`, stored on container tmpfs, capped
at 768 MiB / 1 CPU (host port `55439`), and validated by
`scripts/validate-pubg-saas-test-database.py`. The exact temporary container
was removed afterward; no new Docker volume or listening port remained. This
did not connect to Gate-Local M2.

`pnpm test:pubg` passed all four suites (71/71); `pnpm test:workflow` and
`python3 scripts/test-release-tooling.py` passed, including the synthetic OCI
attestation and Gate database-target cases. The three existing M2 worktree
edits remain unstaged and unchanged. GitHub Actions itself remains unrun
because the local source commits have not been pushed; M2's human acceptance
and Go/No-Go remain open. No Lab/Gate service action or production database
write occurred.

Arthur clarified that the earlier authorization to explicitly enable
Dreaming/restart Lab was based on a mistaken “Dreaming disabled” conclusion.
The bundled default is enabled, Dreaming acceptance already passed, and Lab
1.10.5 is already released. That authorization is withdrawn: do not edit Lab's
runtime config or restart it. The earlier failed config attempt had already
been rolled back before this correction.

Read-only follow-up found the existing incremental index current at 5 files /
92 chunks, `dirty=false`, hybrid mode, FTS available, and a complete 1024-D
vector index. Restart persistence is evidenced without another restart: index
acceptance was observed at `2026-10-15T14:50:04Z`; the already-performed
rollback restart started `openclaw` at `2026-10-15T15:23:48Z`; post-restart
read-only status retained the same index counts and `dirty=false`. Evidence:
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T144403Z-post-dreaming/post-restart-index-verification.json`.
No further runtime change occurred. The hanging `release-config-hash` process
is absent, and M2 Buildx entries are terminal with no migration/deploy
process observed; M2 remains paused and untouched.

Fresh read-only release status at `2026-10-15T15:40:47Z` reports Lab OpenClaw
1.10.5 healthy and `DRIFT_STATUS=IN_SYNC` against the released manifest. Its
image remains the verified candidate digest/source; runtime config digest is
the restored baseline. Product Radar is also healthy, but its legacy source
`633dd216339f` has no reachable Git commit or product-owned provenance, so its
version/source remain `UNKNOWN`. The dry-run
`bash scripts/deploy-openclaw.sh --dry-run --build-radar` selects a Product
Radar rebuild. Applying that existing full-stack path also revalidates and
restarts OpenClaw; no build/apply is authorized for Product Radar in this
continuation. The Lab deploy entry now rejects `--apply` whenever the selected
fresh build is Product Radar-only (including `--build-auto`); a synthetic
regression confirms dry-run remains available and neither Compose nor Docker
build is reached. An isolated Product Radar apply path remains unsupported.
M2's current Gateway/Worker/PostgreSQL/proxy/SaaS 9Router/BuildKit
containers remain up; returned Buildx history is terminal and the guest
process list has no build/deploy/migration command. No database query or M2
service action ran. A read-only `git fetch --no-tags origin 633dd216339f`
failed with `couldn't find remote ref`; the legacy Product Radar source cannot
be recovered by that direct SHA fetch.

The read-only snapshot helper's stuck-query path was fixed in source commit
`2e9f66c` (`fix: bound Lab runtime snapshot queries`): digest reads now call
`sha256sum` directly with a 30-second timeout and fail closed. Its focused
test, workflow/architecture/secrets checks, affected typechecks and PUBG tests
passed. No image was built and this commit was not pushed. Existing unrelated
Gate worktree edits remain untouched.

## Formal Goal continuation audit — 2026-10-15T15:55Z

Fetched `origin/main`; it added no commits. `main` remains seven commits ahead.
The three pre-existing Gate worktree edits remain unstaged and untouched.
Fresh read-only `scripts/release-lab.sh status --live --manifest` at
`2026-10-15T15:54:43Z` reports Lab 1.10.5 healthy and `DRIFT_STATUS=IN_SYNC`
at source `57e472ebe014a0b4d3574d7ef30107340dc99308`, digest
`sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`,
with the restored baseline config digest. A filtered read-only Memory Core
status retained 5 files / 92 chunks, `dirty=false`, FTS enabled/available,
and a complete enabled vector index. The separate Product Radar snapshot at
`2026-10-15T15:55:04Z` is healthy but has no product-owned provenance, Git
source, or product version; its lineage remains `UNKNOWN`.

The Lab release dry-run selects OpenClaw `reuse` and Product Radar `build`;
the new fail-closed guard rejects a Radar-only apply before build/checkpoint.
The Gate dry-run reports `GATE_ADAPTER=unconfigured` and makes no M2 runtime
query. M2 Gateway/Worker remain up, PostgreSQL/proxy/9Router/BuildKit remain
up, and every Buildx history record is terminal. No in-flight migration/build/
deploy or `release-config-hash` process remains; no M2 query or service action
ran.

Local verification passed: `bash scripts/release-lab.sh verify`,
`pnpm typecheck:pubg-saas`, release/image-impact/memory-acceptance and
Radar-only apply fixtures, Lab/Gate SemVer suites, lineage compatibility,
workflow tests, architecture, secrets, shell/YAML syntax, and `git diff
--check`. The Gate PostgreSQL suite and GitHub Actions were not run. No image
build, database write, runtime operation, push, or tag was performed. Source
guard commit `0cb2462` remains local; no pre-existing Gate edits were included.

Earlier config attempt (rolled back before Arthur's correction): the authorized
Lab Dreaming config change stopped at `openclaw config validate` because
atomic replacement changed the config owner to root. The original config was
restored from a protected checkpoint and Lab `openclaw` restarted healthy; the
restored config validates. No Dreaming, incremental refresh, build, or release
was attempted in that failed continuation; later authorized acceptance and
release results are recorded above. Evidence and the rollback command are in
`.agent/checkpoints/2026-10-15-lab-dreaming-config-validation-rollback.md`.

Status at that historical checkpoint: **P0 audit complete; P1 `SOURCE_FIXED` and `LIVE_VERIFIED`; P2
`SOURCE_COMPLETE`; P3 `SOURCE_COMPLETE`; P4 `SOURCE_EVIDENCE_COMPLETE`; Lab
`BUILD_VERIFIED`, `LIVE_VERIFIED`, and `RELEASED` for version 1.10.5.**
Arthur authorized the ordered Lab-only actions on 2026-10-15. The sanitized baseline and P0 evidence are in
`docs/LAB_GATE_P0_BASELINE_AUDIT.md`; P1 evidence and
the indexed rebuild/recovery procedure are in
`docs/LAB_MEMORY_CORE_P1_REPORT.md`.

Arthur renewed and reordered the authorization on 2026-10-15 for Lab only:
push current source; build the Lab OpenClaw candidate; apply it through the
guarded deploy path; run owner-only Dreaming on that image; formally release
only after all P1 live gates pass. All steps completed. The previous Dreaming
preflight stop is superseded by direct inspection of the bundled Memory Core
executor and the successful controlled run below. Gate remains excluded and
M2 stays paused; no operation was performed against Gate, PostgreSQL, or M2.

## Reordered Lab sequence — `RELEASED` — 2026-10-15

Formal promotion completed through `scripts/release-lab.sh release --apply`
with `--promote-live-candidate`; it verified the live candidate digest/source,
created the annotated local tag `lab/v1.10.5`, wrote the released manifest
`/Users/nyannyan/.local/state/amadeus/releases/lab-lab-maintainer-20261015T145222Z-released.json`,
and confirmed the formal Owner notification was sent. The manifest records
release source commit
`0f109389378dc322dbc780997f3133b5f69eb53e`; the running image remains the
verified immutable candidate sourced from
`57e472ebe014a0b4d3574d7ef30107340dc99308` at digest
`sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`.
No container switch occurred during formal promotion. Per the canonical
release tooling contract, the tag is local and was not pushed. A final
`scripts/release-lab.sh status --live --manifest <released-manifest>` returned
`DRIFT_STATUS=IN_SYNC`, with the Lab container healthy. No rollback was needed.

The P1 evidence validates as `LIVE_VERIFIED`; its protected source is
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T144403Z-post-dreaming/live-acceptance.json`.
Dreaming run/privacy details, the SQLite/Workspace checkpoint, and release
verification are summarized in
`.agent/checkpoints/2026-10-15-lab-release-complete.md`. The schedule remains
enabled at 03:00 Asia/Shanghai, next due 2026-10-16 03:00.

## Earlier Lab sequence snapshot — P1 live verification complete; release pending at that checkpoint — 2026-10-15 (superseded)

The existing `Memory Dreaming Promotion` job is the Memory Core-managed
executor: the bundled default enables Dreaming when no explicit config entry is
present, and its `agentTurn` payload carries the Memory Core promotion token
handled before an agent reply. The earlier checkpoint's conclusion that this
was only an ordinary `memory_search` automation was incorrect. No job
definition, schedule, or timezone was changed. The controlled job run succeeded
at `2026-10-15T22:34:09+08:00`; it used one workspace, produced zero promotion
candidates, and completed both Light and REM narrative writes. The existing
schedule remains enabled at `0 3 * * *` `Asia/Shanghai`; its next run is
`2026-10-16T03:00:00+08:00`.

Dreaming's before-read peer admission and classifier markers were present.
The configured WhatsApp peer matched the owner target, Telegram direct
admission failed closed without a configured peer file, and groups/channels
were excluded. The session corpus reported zero suspicious files or lines.
A metadata-only privacy scan of six added/changed files found no explicit or
ambiguous phone number, Owner phone match, WhatsApp JID, or group JID. It
recorded no transcript or memory snippets. Sanitized details are in the
external `dreaming-verification.json` listed below.

Before the index write, a new protected checkpoint was created at
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T144403Z-post-dreaming`.
Its agent SQLite online backup passed `quick_check=ok`; the full Workspace tree,
including `memory/`, matched source files. The checkpoint directory is mode
0700; the SQLite and evidence files are mode 0600. The authorized incremental
`openclaw memory index --agent main` indexed five files. Final status is five
files, 92 chunks, `dirty=false`, FTS available, hybrid search, and a complete
1024-dimension vector index. A keyword query and semantic paraphrase query both
returned positive results; query snippets were not retained. The candidate
remains healthy at digest
`sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`.

`scripts/validate-lab-memory-acceptance.py` accepted the external P1 evidence
as `LIVE_VERIFIED` for source
`57e472ebe014a0b4d3574d7ef30107340dc99308`. The guarded release dry-run passed
with scope `existing-live-openclaw-digest`, no container switch, and tag
`lab/v1.10.5`. No tag, formal release manifest, or formal release notification
has been created/sent yet. The exact evidence and release dry-run are recorded
in `.agent/checkpoints/2026-10-15-lab-live-verified-dreaming-release-pending.md`.
The old preflight snapshot remains a historical record of the earlier stop.

## Earlier ordered Lab snapshot — candidate built and deployed; Dreaming stopped at that checkpoint — 2026-10-15 (superseded)

Step 1 completed: source commit `57e472ebe014a0b4d3574d7ef30107340dc99308`
was pushed and verified at `origin/main` after rebase, `pnpm check:secrets`,
and `git diff --check`. Step 2 completed with `BUILD_VERIFIED`: Lab-only ARM64
image `local/openclaw-amadeus:git-57e472ebe014-20261015140824`, version
`1.10.5`, digest
`sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`.
Build checks include the latest before-read peer-admission, backfill admission,
and no-corpus Dreaming patches. Evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/candidate-build-amadeus-openclaw-20261015140824/build-evidence.json`.

Step 3 completed through `scripts/release-lab.sh candidate` delegating to
`scripts/deploy-openclaw.sh`; no bare Compose deployment was used. The
protected pre-switch checkpoint is
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261015141417`.
The Lab OpenClaw candidate is healthy and remains live; its candidate manifest
validates, and its candidate deployment notification reached `sent` (formal
release notification was not sent). Post-deploy health, plugin registration,
keyword and semantic
retrieval, `dirty=false`, and the live before-read peer-admission/source
markers passed. Product Radar was untouched. No rollback was needed.

Step 4 stopped before execution: live `memory-core` configuration has no
`dreaming` entry. The enabled “Memory Dreaming Promotion” automation is an
`agentTurn` limited to `memory_search`, so it is not a Dreaming executor and
was not run. No controlled Dreaming read or write occurred. Step 5 formal
release/tag is not started because P1 `LIVE_VERIFIED` is incomplete; the
incremental-refresh gate also remains open. Detailed sanitized evidence and
recovery references are in
`.agent/checkpoints/2026-10-15-lab-candidate-deployment-dreaming-stop.md` and
`docs/LAB_MEMORY_CORE_P1_REPORT.md`.

## Reauthorized Lab sequence — candidate source preparation

The OpenClaw-only candidate tooling now builds and applies a prebuilt image
with provenance tied to the bumped Lab version. Candidate deployment retains
only the OpenClaw service scope, takes an external protected checkpoint, and
rolls back the Compose image reference on post-switch failure while preserving
SQLite/WAL, sessions, Workspace, and memory writes. Formal promotion of the
already-live candidate validates the P1 evidence digest/source before creating
the local tag. `status --live` follows an OpenClaw-only manifest's service set.

Focused candidate-deploy and release-tooling fixtures, shell/Python syntax,
Memory Core patch/policy tests, `pnpm check:secrets`, `git diff --check`, and
Lab version validation passed. The workflow plan classified these script
changes as `OPENCLAW_RELEASE_CONFIG` and forbids a build in its default plan;
Arthur's explicit ordered approval authorizes the separate candidate build.
The canonical Lab version has been bumped from `1.10.4` to `1.10.5` with one
release note so the immutable candidate's version and source match. The
reviewed changes were committed as
`e5157175911e5f6d95f42be1d9ebb85fcf176a28`, pushed to `origin/main`, and
verified equal after fetch. No image build, container switch, runtime data
write, notification, or release tag has occurred in this preparation phase.

## Latest Goal continuation audit — 2026-10-15T13:27Z

Read `AGENTS.md`, this task pointer, the full active Goal, and the current M2
pause checkpoint. Fetched `origin/main`; it added no commits. The worktree was
clean before this audit, `origin/main` is an ancestor of `main`, and the local
branch is 17 commits ahead at `f8eff10`. No rebase was needed.

Read-only M2 observation on `pubg-saas-m2-clean`: Gateway running and Worker
healthy for 9 hours; PostgreSQL, egress proxy, and SaaS 9Router running for 28
hours; BuildKit service running for 28 hours. All listed Buildx history entries
were terminal (`Completed` or `Error`); the newest completed builds were 9
hours old. The process table showed no active migration/build/deploy command.
No PostgreSQL query, log inspection, service action, or M2 data change was
performed. M2 remains paused for Arthur's real KOOK acceptance and the P7
controlled release review.

Focused source revalidation passed: Memory Core patch, memory policy, pinned
OpenClaw image/schema (6/6), session isolation, image-impact, Lab memory
acceptance guard, release tooling, Lab and Gate SemVer, lineage compatibility,
architecture, workflow, and secrets checks. No Docker/OCI build or product
database suite ran. Runtime writes remain `none`.

## Reauthorized Lab sequence — step 1 complete — 2026-10-15T13:42Z

Arthur explicitly reauthorized Lab operations and reordered the remaining
sequence: push; build candidate; deploy candidate; run owner-only Dreaming on
the new image; formal Lab release only after `LIVE_VERIFIED`. Gate and the
paused Gate M2 environment remain out of scope.

Fetched `origin/main`; it had no commits beyond the local base. The clean
`main` branch was 19 commits ahead; `git rebase origin/main` reported the
branch up to date. `pnpm check:secrets` and `git diff --check` passed. Pushed
through `47a8d2158c66968ee1d14e802f68a6fa59a8851f`; a subsequent fetch verified
`HEAD == origin/main`. No M2 migration/build/deploy was in flight in the
read-only check: its Buildx entries were terminal and no matching operation
process was observed. M2 containers remained running and untouched.

Next: inspect the Lab-only candidate plan and build inputs, then build the
OpenClaw candidate from the pushed source. No container switch, memory write,
release tag, or Gate operation occurred in step 1.

## P1 Dreaming empty-corpus source follow-up — 2026-10-15T13:38Z

The pinned OpenClaw 2026.9.4 Dreaming phases previously wrote an empty
completed Light/REM phase block and exposed only a generic `skipped` status;
the Memory Core caller still entered deep promotion. The source patch now
returns `SKIPPED_NO_ELIGIBLE_CORPUS` when all enabled phases have no eligible
entries, skips their phase-block writes and the corresponding workspace's
durable promotion, and logs an explicit `DREAMING_RESULT` summary. Preexisting
signal ingestion still runs before candidate selection, so this does not prove
the source of any live transcript.

The patch unit fixture passed its empty-phase ordering, aggregation, promotion
bypass, zero-workspace, idempotence, and pinned-digest assertions. The pinned
runtime fixture applied the patch twice to a temporary OpenClaw tree, passed
configuration validation (6/6), and syntax-checked the modified Dreaming phase
and Memory Core index bundles. Memory policy and session-isolation fixtures
also passed. `pnpm check:architecture`, `pnpm test:workflow`, the relevant
Python/Node syntax checks, `pnpm check:secrets`, and `git diff --check` passed;
`pnpm workflow:plan` classified the changes as FAST with Docker forbidden.
No runtime, cron, database, memory index, build, deployment, or release-tag
action occurred; step 4 remains stopped and items 5–7 remain outside the
current continuation authorization.

## Goal continuation audit — repository and Gate M2 read-only check — 2026-10-15

Fetched `origin/main`; it added no commits. `main` is clean and 10 commits
ahead of `origin/main`; these local commits are retained and were not pushed
by this audit. The Gate M2 pause checkpoint and original Goal still identify
the final Arthur-run KOOK acceptance and controlled release review as open.
On `pubg-saas-m2-clean`, the public Gateway and Worker were up for 8 hours;
PostgreSQL, egress proxy, and SaaS 9Router were up for 28 hours. The container
list showed no migration container. The BuildKit history's newest records
were terminal (`Completed`); sampled `Error` entries were terminal as well.
No in-flight M2 build/deploy was observed. No database query, log inspection,
service action, or M2 data change occurred.

## P3 source follow-up — Gate release help expansion — 2026-10-15

An actual `scripts/release-gate.sh --help` invocation exposed unquoted heredoc
expansion: Bash tried to run the documented `PUBG_SAAS_TEST_DATABASE_URL`,
`test`, and `testing` tokens as commands, emitted errors, and omitted the
literal database constraints. `scripts/release-cli.sh` now emits the usage
line with `printf` and renders option text through a quoted heredoc.
`scripts/test-release-tooling.py` asserts both product help commands have no
stderr and that Gate help contains the literal database-variable and target
rules. The fixture, `bash -n scripts/release-cli.sh`, actual Gate help,
`pnpm workflow:plan` (`FAST`), `git diff --check`, and `pnpm check:secrets`
passed. No Gate runtime, database, or M2 state changed.
The fix and regression fixture are in commit `d712cb3`. Focused revalidation
also passed the Memory Core patch and policy fixtures, pinned schema check
(6/6), session isolation, build-impact and release-tooling fixtures, workflow
and architecture checks, both product SemVer suites, the Lab memory-release
fail-closed test, and lineage compatibility. No Gate PostgreSQL suite or
Docker/OCI build was run.

## P0/P3 source-plan refresh — 2026-10-15

Fetched `origin/main`; it added no commits. The clean local `main` is 14
commits ahead of the remote. `scripts/release-lab.sh plan` returned
`MODE=dry-run`, `BUILD_MODE=auto/no-build`, and `CHANGED_PATHS=0`; it selected
an OpenClaw rebuild for current Dockerfile/build-analyzer/Memory Core patch
inputs and a Product Radar rebuild because source `633dd216339f` is
unreachable. The plan does not query live containers, and no build/apply or
runtime operation occurred. This does not establish `BUILD_VERIFIED` or
refresh live drift evidence. P0 addendum: `docs/LAB_GATE_P0_BASELINE_AUDIT.md`.

## P0 sanitized Lab snapshot — 2026-10-15T13:14:51Z

`python3 scripts/lab-runtime-snapshot.py` confirmed OpenClaw remains healthy
at source `4a5734826eca479f59a2fd039fd12f9ff5d03580`, version `1.10.4`, digest
`sha256:4f114efaca19335424915fdc7d365b03d7af474354fe49ff8ced4581f932dc9f`.
Product Radar remains healthy, but its tagged `633dd216339f` source and product
provenance remain unavailable. Only sanitized image/health/digest metadata and
Compose/config hashes were read. No runtime write occurred. Full evidence is
in `docs/LAB_GATE_P0_BASELINE_AUDIT.md`.

The same continuation reran the guarded
`bash scripts/deploy-openclaw.sh --dry-run --candidate --build-auto`. The P0
12-digit OpenClaw tag rejection is fixed by P3 commit `61504f5`; the current
dry-run accepts it and selects OpenClaw rebuild for changed image inputs.
Product Radar still requires rebuild because its recorded `633dd216339f`
source is unreachable. No build or apply occurred.

## Explicit Lab approval sequence — step 4 stopped — 2026-10-15

The authorized controlled Dreaming run was not invoked. Read-only inspection
of the live OpenClaw 2026.9.4 image found neither the repository's
`amadeus-memory-dreaming-peer-admission-v2` marker nor
`classifyDreamingSessionAdmission`; the live sanitized policy allows both
WhatsApp and Telegram. A zero-file session-corpus status does not prove
before-read isolation. A subsequent read-only cron-history query found seven
records: the existing scheduled job completed on 2026-10-15 03:00
Asia/Shanghai (`succeeded`, 200245 ms, delivery not requested), and a prior
scheduled run on Oct 13 failed. This automated run was not the authorized
controlled run; its source isolation and exact read/write effects are
unverified. We did not read its prompt, summary, transcript, or memory text.
The cron remains enabled, with the next execution due 2026-10-16 03:00
Asia/Shanghai. Current memory metadata reports zero session-corpus files,
zero audit entries/promotions, no session-ingestion state, and no `DREAMS.md`,
but this does not prove what the scheduled run accessed. No cron or runtime
write was made by us and no rollback was performed. Items 5–7 (candidate
build, apply, and formal release) were not started. Full sanitized evidence
is in
`.agent/checkpoints/2026-10-15-lab-dreaming-preflight-stop.md`.

## Explicit Lab approval sequence — step 1 — 2026-10-15

Arthur authorized the Lab-scoped actions in `docs/LAB_GATE_APPROVALS_REQUIRED.md`
in listed order. The repository was 16 commits ahead of `origin/main`, while
the authorization specified 11. To stay within that count, exactly the oldest
11 commits were pushed, through `854c14e0c4143325eca07366e82e4b7a5b335290`.
The remote `main` was fetched afterward and verified at that SHA; five later
commits remain local and unpushed.

`git rebase origin/main` reported the branch up to date. `pnpm check:secrets`
passed, and the requested working-tree `git diff --check` passed on the clean
tree. A supplemental full-range `git diff --check origin/main...HEAD` reported
six trailing-space lines in three Markdown reports; these were not rewritten.
No runtime, database, or M2 action occurred in step 1. The next authorized
item was the Embedding probe, completed in step 2 below.

## Explicit Lab approval sequence — step 2 — 2026-10-15

The running Lab config was checked without emitting credentials: provider
`openai-compatible`, model `Qwen/qwen3.7-text-embedding-flash`, base URL
`http://9router:20128/v1`, and a present `OPENCLAW_9ROUTER_API_KEY` reference.
One synthetic request to `/v1/embeddings` returned HTTP 200, model
`qwen3.7-text-embedding-flash`, and a finite 1024-element vector (32 input
tokens). No memory text was sent and no index or runtime state was changed.
The pre-probe index remained 2 files / 70 chunks, 3 scanned files, FTS
available, vector enabled, `dirty=true`; Dreaming session corpus count was 0.
This verifies provider reachability and dimension only, not semantic retrieval.
The protected backup and index acceptance are recorded in step 3 below;
incremental-refresh and post-restart persistence gates remain open.

## Explicit Lab approval sequence — step 3 pre-write checkpoint — 2026-10-15

The protected external checkpoint is
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T124516Z` (directory
0700; artifacts 0600). The full agent SQLite database was captured through the
online backup API (340,561,920 bytes; SHA-256
`a8b90f7c7bff9e0b87c9d528a4396edab46c0efa956feb22dc0b84b2f668a720`); both
`quick_check` and `integrity_check` returned `ok` with the bundled `vec0`
extension loaded. The protected memory archive contains `workspace/memory/`
and `workspace/MEMORY.md`; extracted tree comparison, `gzip -t`, and hash
verification passed. `DREAMS.md` was absent. The metadata-only pre-write index
baseline remains `dirty=true`, 2 files / 70 chunks / 3 scanned, FTS available,
1024 dimensions, identity `valid`, provider state `pending`.

The generic helper initially could not verify `vec0`; after loading the pinned
runtime extension, the retained snapshot passed both SQLite checks. No source
database, WAL, session, workspace, container, or service was changed during
backup. The checkpoint and exact recovery boundary are in
`.agent/checkpoints/2026-10-15-lab-memory-reindex-prewrite.md`. The force
reindex then passed; detailed retrieval and `dirty=false` evidence follows.

## Explicit Lab approval sequence — step 3 acceptance — 2026-10-15

`openclaw memory index --force --agent main` exited 0. The post-index status
reports 3 indexed / 3 scanned files, 70 chunks, `dirty=false`, FTS available,
hybrid search, valid index identity, and 1024 dimensions. An exact `Kurisu`
keyword search returned 3 results with positive text and vector scores for all
3. A paraphrased semantic query returned 1 result with a positive vector score.
The command output was filtered in-container to counts and scores; no result
snippets or memory text were emitted. The verified pre-write backup remains at
the external checkpoint path above; no rollback was needed.

This completes the requested rebuild, keyword/semantic retrieval, and
`dirty=false` checks. Modified-file incremental refresh and persistence across
the planned step-6 deployment/restart remain open P1 `LIVE_VERIFIED` gates.
Next authorized item: the constrained Dreaming run, after verifying that the
current runtime can isolate Arthur's WhatsApp direct-message source.

P2 established independent Lab/Gate SemVer sources and release-note checks;
Lab remains `1.10.4`, Gate remains `0.1.0`, and no formal tag was created. The
report and validation evidence are in `docs/LAB_GATE_P2_REPORT.md`. No product
build or runtime change occurred in P2.

P3 added Lab/Gate release CLIs, external digest/status manifests, conservative
Dockerfile/workspace impact analysis, OCI provenance labels, shared CI and the
operator runbook. Lab apply remains approval-gated and formal release requires
real P1 `LIVE_VERIFIED` evidence. Gate-Local M2 remains paused; Staging/Prod
adapters are not configured, so Gate apply fails closed. P3 evidence is in
`docs/LAB_GATE_P3_REPORT.md` and command details are in
`docs/RELEASE_ENGINEERING.md`. Source commit: `61504f5`.

P4 consolidates the acceptance matrix, source/package validation, unresolved
live boundaries, and separate-approval checklist in
`docs/LAB_GATE_P4_REPORT.md` and `docs/LAB_GATE_APPROVALS_REQUIRED.md`. Local
Lab/Gate package builds, typechecks, and tests passed; Gate's database-backed
tests were skipped because no test database URL was supplied. No Docker/OCI
build, runtime apply, paid Embedding request, index rebuild, Dreaming write,
formal tag, or registry publish occurred. Gate M2 remains paused.

The P1 source tests passed. Runtime inspection confirmed the pinned provider
and current FTS/vector index state, but did not issue an Embedding request or
prove semantic retrieval. Dreaming is scheduled but has no eligible session
corpus; later metadata inspection found an automatic scheduled run, whose
source isolation is unverified. Do not describe live memory acceptance as
complete; see the P1 report for the exact evidence boundary and pending gates.

The latest read-only memory status at approximately
`2026-10-15 12:30 UTC` is `dirty=true` with 2 indexed files, 70 chunks, FTS
available, a 1024-dimension vector index, and 3 scanned files; provider state
is still `pending`. A
source-only audit found that optional Embedding failure retains FTS but the
tool response omitted the manager's `fts-only` mode. A new pinned source patch
now exposes `mode=fts-only` when FTS is available and `mode=unavailable` when
it is not; its fixture and exact pinned-bundle syntax check passed, but
the Docker image has not been rebuilt and no live search was issued. Index
refresh, `memory status --deep` provider probing, paid Embedding, Dreaming,
deploy, and release remain unauthorized. Source follow-up commit: `48b88ac`.
See the updated P1 report and approval checklist.

## Latest Goal continuation audit — 2026-10-15

Fetched `origin/main`; it added no commits. At audit start `main` was clean and
8 commits ahead, with one worktree. The Gate CLI help correction and regression
fixture were committed as `8d1c62e`; immediately afterward the worktree was
clean and `main` was 9 commits ahead of `origin/main`. Gate-Local Gateway was
up and Worker, PostgreSQL, egress proxy, and 9Router were healthy in the
read-only container listing. No host build, deployment, or migration process
was observed; the long-running BuildKit daemon alone does not establish an
active build. No M2
database query, log inspection, or service action was performed. M2 remains
paused with its existing acceptance work open.

The P3 CLI audit found that `release-gate.sh --help` showed Lab-only build,
lineage, and memory-evidence options. `release-cli.sh` now renders separate
Lab and Gate help; Gate help identifies its environment/manifest options and
the paused M2 and missing-adapter limits. The focused release-tooling fixture
and both real help commands pass. Gate-Staging `plan` remains a dry-run with
`GATE_ADAPTER=unconfigured`; no Gate runtime query occurred.

The evidence-doc update was committed as `01f5d6d`; `main` was 10 commits
ahead immediately afterward. A fresh sanitized Lab snapshot at
`2026-10-15T12:17:37Z` again found OpenClaw and Product Radar healthy. OpenClaw
remains the 1.10.4 image tagged to source
`4a5734826eca479f59a2fd039fd12f9ff5d03580`; Product Radar's source and product
version remain unavailable, and the drift doctor remains
`UNKNOWN` without a protected manifest. The latest filtered Memory Core status
is unchanged: 2 files, 70 chunks, FTS available, 1024 dimensions, `dirty=true`
with 3 scanned files; Dreaming has zero session-corpus files. No query or
runtime write was performed.

## Gate verify test-database preflight — 2026-10-15

The P4 audit showed the earlier Gate package test command skipped 34
PostgreSQL-backed cases when `PUBG_SAAS_TEST_DATABASE_URL` was absent. Commit
`af48ed6` adds a fail-closed validator and makes Gate `verify` run it before
invoking tests. It accepts only loopback targets with database name `test`,
`testing`, `_test`, or `_testing`, rejects URI query/fragment overrides, and
never prints the connection URL. GitHub Actions validates its isolated
`localhost:5432/pubg_test` service; README and release runbook document the
requirement.

Release tooling fixtures, workflow tests, architecture check, secrets scan,
Python/shell/YAML syntax, and `git diff --check` passed. `pnpm workflow:plan`
classified the changes as FAST. The Gate PostgreSQL suite was not run with a
database URL, and no database connection, M2 query, container action, Docker
build, or deploy occurred. The worktree is clean; `main` is 12 commits ahead
of `origin/main`. Gate M2 remains paused.

## P1 merged-config and pinned-schema CI follow-up — 2026-10-15

P1 source review found that the `openclaw_prepare.py` merge-preservation fixture
and the actual pinned OpenClaw config-schema test were not both represented in
the Lab CI path. Commit `c3bc25c` adds checks that managed Memory Core settings
survive final config merging while existing commands, metadata, security, and
WhatsApp allow data remain preserved; Lab CI now runs the pinned OpenClaw
2026.9.4 config-validation fixture and triggers when its helper/test changes.

The memory-policy fixture, pinned-runtime config test (6/6, zero skips),
Memory Core patch fixture, workflow tests, architecture check, secrets scan,
Python/YAML syntax, and `git diff --check` passed. `pnpm workflow:plan` classified
the source/CI change as FAST. No Lab/Gate runtime, database, index, or memory
content was touched; the GitHub Actions run and all P1 live acceptance gates
remain open. `main` was 14 commits ahead of `origin/main` at that commit; Gate
M2 remains paused.

## Latest read-only Goal state refresh — 2026-10-15

Fetched `origin/main`; it added no commits. `main` is now clean and 15 commits
ahead. M2 read-only checks found Gateway running and Worker healthy for 8
hours, PostgreSQL and egress proxy healthy, and the existing BuildKit service
running. The host had no build/deploy/migration process; the Buildx history
entries were terminal (`Completed` or `Error`), with the newest completed
8 hours earlier. No M2 database query, log inspection, or service action ran.

The sanitized Lab release snapshot at `2026-10-15T12:29:17Z` reports OpenClaw
healthy at digest
`sha256:4f114efaca19335424915fdc7d365b03d7af474354fe49ff8ced4581f932dc9f`,
version `1.10.4`, source `4a5734826eca479f59a2fd039fd12f9ff5d03580`. Product
Radar is healthy at digest
`sha256:1f708837c5d55fcb608108621d74402936a767397fb76af0b4c9c4fc655e396b`;
its source/version remain unavailable and drift is `UNKNOWN` without a
protected release manifest.

Immediately afterward, filtered Memory Core status reports 2 files, 70 chunks,
`dirty=true` against 3 scanned files, FTS enabled/available, hybrid mode, a
complete 1024-dimension vector index, provider `pending`, and zero Dreaming
session-corpus files. No memory query, deep/provider probe, Embedding request,
index refresh, or Dreaming run was issued. P1 remains
`SOURCE_FIXED + BLOCKED_OPERATOR_AUTHORIZATION`; Gate M2 remains paused.

## Preserved Gate M2 pause — PUBG KOOK SaaS V0.1 (2026-10-15)

Gate M2 remains **PAUSED / BLOCKED_BY_RELEASE_ENGINEERING**, not cancelled or
complete. Its current Goal is `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md`; the pause
checkpoint is `.agent/tasks/2026-10-15-gate-m2-paused.md`. Preserve all M2
source, migrations, runtime data, and existing evidence. Arthur's real KOOK
conversation acceptance and the controlled release review remain open.

The P0 read-only observation found Gateway/Worker running without restart,
PostgreSQL and egress proxy healthy, and the SaaS 9Router running. No M2
deployment or migration command was in flight in the pause checkpoint. No
database query or write was performed for this audit; see the P0 report for
the observed service states and evidence limits.

## Last recorded Gate source milestone — KOOK channel message adapter (2026-10-15)

Arthur requested that platform presentation differences stay in one KOOK
channel adapter while public Agent and PUBG Domain behavior continue to match
private Kurisu. Source now centralizes KOOK payload validation, Markdown
conversion, mention adaptation, and long-message splitting in
`apps/pubg-saas/src/channels/kook/message-adapter.ts`. Official API limits are
8,000 characters for both plain and KMarkdown message content; card text
elements have separate 2,000-character plain-text and 5,000-character
KMarkdown limits.

Long replies split at paragraph/newline/word boundaries. The adapter preserves
links and mention tokens, reopens inline formatting and block quotes, and
closes/reopens code fences per message. Existing ordered outbox delivery keeps
later parts behind an unsent earlier part and retries failures. Markdown
headings/lists and WhatsApp-style emphasis are converted to supported
KMarkdown; Unicode emoji and KOOK emoji shortcodes remain intact, and neutral
numeric user mentions map to KOOK's native mention syntax.

Validation passed: `pnpm test:pubg-saas` 155/155 against reused isolated PG18,
zero skips; `pnpm test:pubg` 71/71, zero skips; SaaS build, both typecheck
chains, architecture checks, secret scan, and `git diff --check`. Source
commit `0d5de29b5f61049aebaeb255312e39ad6c6a1a5b` is pushed to `origin/main`.
The dual-platform OCI build verified amd64 and arm64; the local M204 ARM64 image
is `local/pubg-saas:git-0d5de29b5f61049aebaeb255312e39ad6c6a1a5b`
(`sha256:ca562817734eeb8f4dc4c68e1febf247c857401a4676a2cb1c9ed58770486c8d`).
Only Gateway and Worker were replaced. Gateway is running with zero restarts;
Worker is healthy with zero restarts. The KOOK session row is present at
`last_sn=76`, updated `2026-10-15T04:43:36.455Z`; the inspected recent
structured error count is zero for both containers. PostgreSQL, egress-proxy,
and SaaS 9Router container IDs are unchanged. Protected mode-0600 rollback
records are `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-0d5de29-pre-switch`
and `.../20261015-pubg-saas-0d5de29-post-switch`. No image was pushed to a
registry and no private runtime/config was touched. Arthur's KOOK acceptance
remains pending; M2 is not complete.

## Last recorded Gate task — remove public-only KOOK quotas and context expiry (2026-10-15)

Arthur authorized aligning the public Gateway's sender and conversation
retention with private Kurisu. The local 200-message daily sender quota and
per-user/channel/tenant/bot ingress request-rate gates are removed. KOOK's
actual bucket/global response headers and 429 retry guidance remain in force.
Transcript history is now retained without the public-only 12-message,
6,000-character, 1,600-character-per-row, or 12-hour expiry caps; query
sessions are persistent as well. Group history remains channel-scoped and DM
history remains actor-scoped. Every PUBG tool call still revalidates the
current trusted KOOK event, tenant, team, user, channel binding, roster, and
revision; history never grants authorization.

Replies over KOOK's 8,000-character per-message limit are split into ordered,
durable outbox parts, preserving all text and keeping a KOOK mention intact.
The public team cap (8), write authorization/redaction, 300-second Agent
timeout, and shared-key `/players` admission (10/minute) remain. `/matches`
still bypasses that admission gate. The global ingress backlog capacity of
1,000 is retained as a durable-queue capacity boundary; there is no per-user
pending limit.

The patch adds migrations 0017–0020 for persistent transcript/query context,
ordered outbox parts, and separate source/reply-target IDs. Existing quota
migrations remain in the ordered migration history; the runtime no longer
reserves or records local daily quota usage. Validation passed: SaaS
PostgreSQL 150/150 and PUBG/Kurisu 71/71, both zero skipped; both package
typecheck chains, SaaS build, architecture checks, secrets scan, and
`git diff --check` passed. Reused isolated PG container `pubg-saas-pg18`; no
Docker up/down was needed.

Commit `83c1bcc761842676ec750708a43f8d0f33e9d39a` is pushed to `origin/main`.
The ARM64 image `local/pubg-saas:git-83c1bcc761842676ec750708a43f8d0f33e9d39a`
was built locally on `pubg-saas-m2-clean` (image ID
`sha256:e30b16c473b4f9c1ce183271fe43060001f367f9e052050b5f57ab5c52bd14d9`).
Migrations 0017–0020 are applied. Only Gateway and Worker were replaced;
Gateway is running with zero restarts and Worker is healthy with zero restarts.
The KOOK session resumed and advanced to `last_sn=74` at
`2026-10-15T04:20:45.338Z`. Recent gateway/worker error-record counts are zero.
PostgreSQL, egress-proxy, and SaaS 9Router container IDs are unchanged. The
protected mode-0600 rollback records are
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-83c1bcc-pre-switch`
and `.../20261015-pubg-saas-83c1bcc-post-switch`.

No production deployment, private OpenClaw/Kurisu action, or 9Router change was
made. Arthur's KOOK acceptance remains the final product check; do not declare
M2 complete.

## Previous milestone — Kurisu-aligned public sync and Domain facts (2026-10-15)

The live `PUBLIC_SYNC_MAX_MATCHES=10` override was removed. Canonical Compose
and the Worker use 500, matching the private plugin's configured `maxMatches`.
Shared Domain selection round-robins each member's newest-first match list
before applying that ceiling, so one account cannot consume it. The public
Agent receives the complete sanitized Domain envelope, shared
presentation/display text, per-match facts, and review facts. The `/matches`
admission gate was removed; authenticated `/players` discovery remains gated,
endpoint allowlisting and redirect rejection remain, and telemetry requests
still carry no API key.

The source commits `e355b2ef673662b60757b69966c73768e89830e5`,
`6a9171fe10ff5948b421bf6c6cf973704e82f0cd`,
`f47783d5869071224486d0c26b580eb7ebb835de`,
`66e1006b04b8726f50a80a15c3b0024d049228f0`, and `122cd79` are on
`origin/main`; ARM64 image `local/pubg-saas:git-122cd79` was deployed to
`pubg-saas-m2-clean`. Only Gateway and Worker were replaced. The former
missing 2026-10-14 21:07 duo and 23:01 squad matches are in PostgreSQL and the
team's discovered-match index. Earlier deployment evidence remains in
`.agent/checkpoints/2026-10-15-pubg-saas-kurisu-alignment.md`.

Arthur's KOOK acceptance remains pending; M2 is not complete.

## Previous milestone — SOUL-sourced public Agent persona (2026-10-14)

Arthur clarified that public KOOK personality must use the private OpenClaw
workspace `SOUL.md` as its source. The checked-in public-safe verbatim excerpt
is `apps/pubg-saas/src/application/public-agent-soul.md`; it omits the single
line naming the private assistant. Neither private memory/user/DM data nor
private nickname mappings were read or copied, and no private files changed.
The normal Agent and recovery summarizer share the excerpt; the build ships the
copy beside the compiled code, and tests pin the copy and exclude private
identity markers.

Source commit `642f04eb5566f3b429373462a6ea75c3dd7c521b` is pushed and deployed
to `pubg-saas-m2-clean` as ARM64 image
`local/pubg-saas:git-642f04eb5566f3b429373462a6ea75c3dd7c521b`. Only Gateway
and Worker were replaced. Gateway is running with zero restarts; Worker is
healthy with zero restarts. KOOK is connected (`last_sn=61`), the inspected
10-minute error-log match count is zero, and PostgreSQL/egress-proxy/SaaS
9Router were unchanged. No migration or manual model/PUBG API request ran.
`pnpm test:pubg-saas` passed 146/146 with no skips; `pnpm test:pubg` passed
70/70; builds, typechecks, architecture, secrets and diff checks passed.

The mode-0600 rollback record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-642f04e-pre-switch.txt`.
Full evidence and rollback steps:
`.agent/checkpoints/2026-10-14-pubg-saas-public-soul-rollout.md`.
Arthur's real KOOK acceptance remains pending; M2 is not complete. Stop here
and wait for Arthur's test.

## Previous rollout — public Agent rich battle reports (2026-10-14)

Arthur authorized richer, Kurisu-aligned public KOOK replies, full validation,
push, and Gateway/Worker-only replacement on `pubg-saas-m2-clean`. Source
commit `adeb839f5bfec07134a11259608edaa7e9171096` is pushed to `origin/main`
and deployed as ARM64 image
`local/pubg-saas:git-adeb839f5bfec07134a11259608edaa7e9171096`. The reported
05:00 boundary in a prior reply conflicts with the effective `Asia/Shanghai`,
06:00 Domain/Skill/Kurisu setting. The 5-versus-7 match discrepancy cannot be
resolved from counts alone because the independent SQLite and PostgreSQL
caches may differ in freshness and coverage; no live PUBG lookup was performed.
The Agent now receives the actual canonical time range and bounded coverage
facts. Its tool output contains allowlisted damage-source/direction facts and
approved roster stats (maximum 8 players and 10 match summaries), omitting
internal identifiers and telemetry/debug data. Output budget is 1,600 tokens
per step; the 300-second overall timeout is unchanged. Public persona guidance
uses generic style traits only; private memory, personal data, DMs, nickname
mappings, and private files were excluded.

Full requested validation passed: `pnpm test:pubg-saas` 144/144 with isolated
PostgreSQL, `pnpm test:pubg` 70/70, PUBG/SaaS typecheck and build, architecture,
secrets, and diff checks. On `pubg-saas-m2-clean`, only Gateway and Worker were
recreated. Worker is healthy, Gateway is running, both have zero restarts, and
the read-only KOOK probe returned connected with `last_sn=61`. PostgreSQL,
egress-proxy, and SaaS 9Router were unchanged; no migration or manual model/PUBG
request ran. The mode-0600 pre-switch rollback record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-adeb839-pre-switch.txt`.
Detailed evidence and rollback steps:
`.agent/checkpoints/2026-10-14-pubg-saas-rich-agent-reports-rollout.md`.

Arthur's real KOOK acceptance is pending; M2 is not complete. Stop here and
wait for Arthur's test result.

## Previous rollout — reply cleanup and M2 acceptance baseline (2026-10-14)

Commit `ef81896` is pushed to `origin/main` and deployed to
`pubg-saas-m2-clean` as immutable ARM64 image
`local/pubg-saas:git-ef81896a1c85a22afaf8c533e0d95929b425962f`
(`sha256:fe49c38fb9183882b68058b8b4d0fab90b0f6f111c317b682c03bffee9d9018f`).
Only Gateway and Worker were replaced. Gateway is running with zero restarts;
Worker is healthy with zero restarts. The read-only PostgreSQL KOOK session
probe reports `connected=true`, `last_sn=59`, updated at
`2026-10-14T14:13:30.421144Z`. Gateway and Worker each had zero error-level log
matches; Worker cycle logs showed zero queue snapshot errors, zero team
failures and no alert codes. PostgreSQL `e47fd49fcab5`, egress-proxy
`c5cd33cba219`, and SaaS 9Router `2ce598008143` were unchanged. No migration,
model request, or PUBG API request was run. The protected pre-switch rollback
record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-ef81896-pre-switch.txt`.
Deployment evidence and rollback steps:
`.agent/checkpoints/2026-10-14-pubg-saas-reply-cleanup-rollout.md`.

The 12:55 UTC `[回复成员N]` prefix came from bracketed assistant-turn
formatting in `PublicQueryAuthorizer.loadAgentConversation`; the model echoed
it and the reply was stored without cleanup. Conversation context now uses
plain speaker descriptions, the public assistant prompt forbids repeating
internal scaffolding, old assistant history is sanitized, and outbound text is
cleaned before persistence and again at the KOOK HTTP boundary. Successful
`message_outbox` rows intentionally set `payload_json={}` to scrub the body;
the sanitized delivered transcript is retained for 12 hours and linked to the
source event and KOOK remote message ID.

Validation passed: SaaS/PostgreSQL 141/141 on the reused isolated PG18;
`pnpm test:pubg` 70/70; focused ingress/outbox and KOOK sender tests 10/10;
PUBG/SaaS typecheck and build, both architecture checks, secrets and diff
checks passed. Arthur's live KOOK retest remains pending; M2 is not complete.

The Vercel AI SDK
`ToolLoopAgent` now has a 300-second overall budget, 120-second step timeout,
and a 128-step runaway guard without forcing normal turns to stop calling
tools. If a timeout/provider failure or guard occurs after a Domain result,
one bounded finalization call summarizes the completed results. Identical
`pubg_query` calls reuse the first real output; team stats return the full
eight-player roster in one Domain query. Server-side writes cap teams at eight;
own-account rebind at capacity is permitted while a ninth new member is
rejected. Existing tenant, permission, coverage and evidence checks remain.

Source validation passed: SaaS/PostgreSQL 133/133 on the reused isolated
`pubg-saas-pg18`, focused DB integration 28/28, PUBG/Kurisu regression 68/68,
SaaS typecheck/build, architecture, secrets and diff checks. Buildx generated
and verified `linux/amd64` and `linux/arm64`. An age-encrypted backup restored
into a new isolated PG18.1 instance; 39/39 table counts and app/backup role and
sequence boundaries passed.

The live `昨日小队战绩` Agent invocation and the remaining human KOOK
acceptance are still pending. Do not synthesize a production event or use
desktop/browser automation. M2 remains open until Arthur completes and accepts
the real model/tool/outbox path. Earlier Agent-loop rollout evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-agent-loop-recovery-rollout.md`.

## Previous public runtime authorization — historical baseline (2026-10-14)

Before the latest authorized replacement, M204 ran source commit `da03953`,
whose forced classifier could silently complete an unsupported message. The
current correction replaces that path. Deployment scope remains limited to
the named M204 public stack's Gateway and Worker. Private OpenClaw/Kurisu,
private 9Router, and unrelated production resources remain outside scope.

## Operator-selected source implementation Goal — 2026-10-13

The operator explicitly activated `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md` for this
worktree. Continue its phases while preserving the separate Image Lab/runtime
work recorded below. A later explicit operator instruction authorizes only the
isolated public SaaS/9Router integration recorded above; it does not authorize
private OpenClaw or private 9Router changes.

P0 is complete: the baseline was clean at `3f4cac2`; the initial workflow plan
selected FAST; the public/private dependency map and synthetic stat golden are
recorded; no runtime was changed. P1 source gates now pass: the query engine
requires explicit `TeamContext`; the async `PubgRepositoryPort` is implemented
with a scope-pinned SQLite adapter; `listMatches` limits player-row reads to
the selected match window. Early P2 adds the `apps/pubg-saas` Postgres schema,
migrations and roster/conversation-scoped adapter. A temporary PostgreSQL 18
integration run passed two-guild/team and conversation/result-set isolation,
duplicate display names, migration idempotence, and one SQLite/Postgres shared
stat golden, plus a shared nine-case edge golden for KD/revives/squad rank,
relative 06:00 time/half-open boundaries, zero matches, partial/unknown coverage
and comparison ratios. Team-damage/kick/punch/melee envelopes, evidence, versioned
telemetry and cache-only reopening also match across the independent stores.
The private Domain suite has 36 passing tests without the public database.
The current P2 source adds trusted group/direct-message parsing,
uncached KOOK owner/Administrator checks, transactional squad/channel/roster
management with actor-bound one-use confirmations, and self-declared account
claims with conflict-safe unclaim. Current P3 source includes a fixture-driven
gateway session core (durable `session_id/sn`, ordering, heartbeat, resume and
server reconnect reset), a Node WebSocket factory, bound-channel inbox dedupe
and leased outbox retry, and fixed KOOK channel/direct-message REST senders with
visible quote and quota reply correlation. The executable source runtime now
persists minimal addressed ingress before gateway acknowledgement, then runs
leased business processing and outbox delivery. Name-based create/bind/list and
roster changes, status/unbind/disband and private self-claim/status/unclaim now
use deterministic handlers/cards. Lookup reuses the shared PUBG client with an
independent public key and PG admission/provider-header backoff. Missing or
ambiguous names cannot save a roster; setup tokens pin a channel revision. One-use
callbacks recheck authority and recover an exact event's committed receipt
after a crash; new clicks cannot reuse it. Automatic guild-join welcome now
stages a strict bot-addressed system event before official guild/channel API
lookup, pins a verified text channel in the canonical outbox, and rechecks it
before sending. Welcome cannot create a tenant/team/grant or invoke a model.
Additive migrations through `0014` upgrade public schema/outbox rows, add
durable worker sync jobs, indexed KOOK ingress-rate windows, and a PostgreSQL
daily outbound-message budget that resets at 12:00 Asia/Shanghai. The default
budget is 200 sends per SaaS bot; configuring more requires verified developer
eligibility and an account-wide quota allocation. The
statistical handler is now wired to the public executable: deterministic stats,
leaderboard, self-stats, review and team damage use authorized Domain facts;
free-text queries use a bounded AI SDK QueryPlan and a deterministic executor.
A separate worker loads persisted SaaS rosters, syncs public matches and
team-scoped telemetry into PostgreSQL. Same-match overlapping tenants merge
public player facts while repository reads expose only the current registered
roster; roster changes invalidate scoped sync state. Migration `0012` indexes
per-bot expiry cleanup; gateway maintenance now sweeps expired query context,
result sets and 30-day usage records, and `/pubg privacy` exposes the verified
retention and model-provider data flow.

Commit `880a5cf` adds confirmed team leaderboard preferences and team-scoped
player aliases in migrations `0013` and `0014`. Preference/alias changes
require fresh team-admin authority and actor/channel-bound one-use confirmation;
an omitted leaderboard metric uses the stored preference while an explicit
metric takes precedence.

M1 source/offline acceptance was re-audited and passed on 2026-10-13:
`pnpm test:pubg-saas` passed 75 tests with isolated PostgreSQL 18 and no skips;
`pnpm typecheck:pubg` and `pnpm typecheck:pubg-saas` passed; `pnpm test:pubg`
passed 68 private identity/presentation/Domain/plugin tests;
`pnpm build:pubg-saas`, worker/gateway/migration dry-runs, `pnpm check:secrets`
and `git diff --check` passed. The new checks prove a roster revocation waits
for an already authorized PG read, persisted telemetry renders as KOOK teammate
damage, and the public Domain subpath does not load `node:sqlite`. Tests use a
fake PUBG API/model provider; no runtime credential, real guild, production
database, Docker service or external deployment was touched. The worker
dry-run requires explicit `--apply` to connect or write.

M2 is active: worker cycle logs expose aggregate queue age/state and process
RSS/heap without tenant IDs, and now emit identifier-free alert codes. The
local synthetic 200-team simulation completed 200/200 authorized query tasks
and worker runs. The KOOK sender reserves daily quota in PostgreSQL across
restarts. The current SaaS/PostgreSQL suite passes 106/106 with no skips on the
reused loopback-only isolated PG18.6 fixture, including concurrent budget
admission, outbox deferral, the integrated runtime and Worker metrics. The
current-source architecture check, 23 backup/Compose-adapter safety tests and
amd64+arm64 OCI build verification also pass locally without publishing.
The relay source commit `7f3b95b` also passed a fresh M204 Buildx OCI build for
both platforms; manifest `sha256:7cfc5d19b320b431f2da8b93afc4f1b6b6fd22f63bf884c139945d32d4da2d68` was verified and its temporary archive removed.
Its amd64 image also passed an emulated Compose startup on M204 ARM64: Worker
reported `x64`, became healthy, and host metrics returned 200. This is not a
native amd64-host Compose test.
Local Compose build/start, encrypted backup/restore
with table-count and role-boundary probes, and the public-stop/private-Kurisu
source regression are verified. Commit `7f3b95b` adds a fixed-path Worker
metrics relay; its M204 host-loopback GET returned 200 while the Worker stayed
internal-only and had no host port. The current M204 host-profile mapping resolves
to OrbStack machine `nyannyan`; its local Compose/recovery and one bounded
200-team host measurement are recorded below. A separate clean Linux VM also restored the
public archive into a new PG volume and started the current Worker healthy;
its proxy denied private M204 egress. This is a database/Worker startup drill,
not full public-service independence. Sustained production-shaped capacity and
alert delivery, release-grade RPO/RTO, scheduled backup installation,
quota/eligibility and full independent-runtime drills remain. The clean Linux
ARM64 guest now passes Compose recovery, application egress isolation, and the combined encrypted
backup/prune job. The six-hour timer passed an ephemeral systemd integration
and then an automatically scheduled one-shot on the isolated Linux VM. It
fired at the next UTC boundary, completed backup plus prune successfully, and
was disabled/removed after the check. No persistent timer is installed on
M204 or the canonical host.

Latest isolated RPO/RTO drill: the age backup completed in 641 ms and verified
in 135 ms. The new manifest `snapshotRequestedAtUtc` measured 0.624 s to the
simulated failure; restore into a fresh PG18.1 container matched 37/37 tables
in 1.558 s, and the restored Worker was healthy 14.619 s after failure. Its
synthetic queue had one delayed job, zero attempts and zero failures. App
rollback DML/DDL denial and backup sequence-read/no-`nextval` probes passed.
This is recovery-mechanics evidence for one synthetic tenant/team/job; the
isolated VM timer auto-fired once, but no persistent timer is installed on
M204/canonical host and release-scale RPO/RTO remains open.
The first attempt's `createdAtUtc`-based figure was discarded because that
timestamp follows snapshot and encryption. The backup utility now records and
validates a conservative snapshot-request timestamp. Evidence and commands:
`.agent/checkpoints/2026-10-14-pubg-saas-rpo-rto-rehearsal.md`.
The query-load harness now supports 30 scoped query tasks per synthetic team.
On the reused loopback-only PG18.6 `pubg-saas-pg18` fixture it replayed 6,000
authorized tasks across 200 teams/800 users, executing 132,000 SQL statements
in 27.288 s with zero task/scope failures; SQL statement P95/P99 were 3.02/88.71
ms. Worker reads completed 200/200 team runs with zero failures in 380 ms.
Pool peak was 16/20 with no waiters; the benchmark process RSS peaked at 257 MiB.
This replay was an unpaced burst on the local fixture, so it does not establish
canonical M204 headroom, live provider capacity or an SLO. The first run exposed
and the rerun corrected a stale benchmark exit assertion; exact evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-6000-query-benchmark.md`.
The same compiled harness then ran on M204 against its retained isolated PG18.1
Compose fixture, with PG capped at 1 CPU/1 GiB and the runner at 1 CPU/512 MiB.
It completed 6,000 tasks in 47.609 s (126.03 tasks/s), 132,000 SQL statements,
zero failures, and 200/200 Worker team runs; pool peak was 16/20 with no
waiters, runner RSS 115 MiB. The random schema count returned to zero; plain
`down` retained the dedicated volume. OpenClaw and 9Router IDs/start times
remained unchanged, restart counts 0. This remains a bounded query/Worker-class
simulation, not full Gateway/Worker container headroom, paced daily load or an
SLO. Detailed commands/results: `.agent/checkpoints/2026-10-14-pubg-saas-6000-query-benchmark.md`.
Current-source M204 recovery was then repeated on app commit `7249b12`: the
local ARM64 image migrated a fresh source PG18.1 project and ran a healthy
Worker. An encrypted backup restored to a different fresh PG: 37/37 table
counts and 14 migrations matched; the tenant/team/job fixture was 1/1/1; app
and backup table/sequence boundaries passed on both databases. Restored Worker
health and queue metrics showed one delayed job, zero due/attempts, and zero
inbox/outbox rows. After both public test projects were stopped with plain
`down`, Kurisu regression passed 68/68 and private OpenClaw/9Router IDs, start
times and restart counts remained unchanged. No real PUBG/model credentials,
image push or deployment. The OrbStack snapshot-stream limitation and helper
method are recorded with reproduction commands in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-current-7249b12-local-recovery.md`.
P3 real
test-server smoke now proves gateway authentication, one labeled outbox
delivery, and sequence-1 session resume. Full human-user flows (duplicate input,
cross-channel routing, management callbacks and unauthorized denial) and KOOK
eligibility remain unverified. Latest live update (2026-10-14): Arthur added a
second text channel. Isolated M204 project `pubg-saas-p3-live-058118d` is now
running from app commit `058118d`; Gateway completed KOOK WebSocket
authentication/session handshake, and Worker/PostgreSQL are healthy. The
Worker is attached only to the internal PG network. Gateway has only the two
KOOK test credentials; no real PUBG or model credential is loaded. Synthetic
player lookup is explicitly acceptance-only and production-disabled. Ordered
Arthur command/callback steps are recorded in
`.agent/checkpoints/2026-10-14-pubg-saas-p3-live-gateway.md`; human actions and
KOOK eligibility still await acceptance. P4's deidentified prompt benchmark
also remains open.
No live provider accuracy, latency or capacity is claimed. P4 now has a
de-identified 100-case synthetic corpus across ten query families, an
owner-only external-file exporter, and a mock runner test; the real model
benchmark still awaits protected provider credentials. Query sessions still
derive from durable ingress, fresh KOOK membership and DB ownership, with
explicit DM grants and no fallback to the private team.

Current-image P3 follow-up: on the restored independent Linux VM, the
operator-authorized test bot authenticated the Gateway and a non-null session
state persisted in restored PG. Gateway and Worker ran together; Worker was
healthy with its synthetic sync job delayed. Database checks found zero
ingress events and outbox rows, so no user-facing test message was sent and no
PUBG/model call occurred. The test credential was removed from the VM after
the run. Human-user inbound/callback/authorization flows still lack a test
actor.

Operator gate update (2026-10-14): Arthur deferred human P3 until the second
text channel and test account are ready. Readiness has not been confirmed; do
not open KOOK through desktop/browser automation or send test messages. The
already-running isolated stack remains available for later human acceptance.
This gate does not block independent local M2 work.

Official quota source audit on 2026-10-14: KOOK's message reference states a
10,000/day developer-account aggregate across bots, with a 12:00 Asia/Shanghai
reset; its published developer policy also lists 200/day per bot and one
bot/one self-created server for unverified accounts, versus 10,000 servers and
240 API calls/minute for verified developers. The app's local 200-send bot
budget is conservative but does not observe sibling-bot usage. PUBG documents
10 requests/minute for testing/development only; launch requires an approved
higher limit. Official-account eligibility, shared quota allocation and the
PUBG launch-key limit remain unverified. The KOOK test credential was used
only for Gateway authentication; no PUBG/model credentials were used.
At the optional 200 teams × 30 queries/team/day baseline, one response per
query is up to 6,000 local send reservations/day. That exceeds the 200 default
and the published unverified per-bot allowance; a verified account and a
reserved share of the 10,000/day developer-account total are needed, subject
to sibling-bot use and KOOK's first-reply discount. This is arithmetic only.
Current source map: `docs/PROJECT_MAP.md`.

### M204 current-host Compose and recovery acceptance — 2026-10-14

On the canonical host-profile machine `nyannyan`, current Git commit `87543bc`
built local ARM64 image `local/pubg-saas:git-87543bc` (image ID
`sha256:75c6984f8256c782062fa6ae786c5cdd33028f30df445b27b930040d9f50d4c2`).
An isolated Compose PG18.1 source project applied migrations through `0014`;
the Worker reached healthy with an empty queue and made zero provider requests.
Gateway live connectivity was not started. The source project was seeded only
with one synthetic tenant/team/delayed sync job and a migrator-owned sequence.
Age backup and verification passed (SHA-256
`86b3f57bd632a0da6a01f83c872f39d9acaaadeed32379c31f3d9198907b50b9`); restore
to a separate fresh PG18.1 container matched all 37/37 public-table counts,
14 migrations and fixture counts 1/1/1. Source and restore app DML rollback,
app DDL denial, backup SELECT/no-DML/no-`nextval`, app sequence use and
restored default sequence grants all passed.

Both named test projects were stopped with ordinary `docker compose down` (no
`-v`), retaining their isolated volumes. Then `pnpm test:pubg` passed 68/68.
OpenClaw stayed healthy and 9Router stayed running; both container IDs and
start times were unchanged and restart counts remained 0. A local helper image
was used for direct PostgreSQL/age tooling because an interactive `psql`
snapshot through the `orb` command wrapper buffers output; the repository
backup tool and its snapshot checks were unchanged. The image was not pushed,
and no provider credential, production database, 9Router setting or private
OpenClaw runtime was used or changed. Full steps and evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

### Current-source M2 image, backup and restore acceptance — 2026-10-14

Commit `20b06da` built on the M204 ARM64 machine as
`local/pubg-saas:git-20b06da` (image ID
`sha256:492a72e07d7fcd7bc169b2bc8e0f8ac409d050f6843c93b69d77277a2e181f17`).
The isolated source PG18.1 project applied migrations through `0014`; Worker
health and its in-container metrics endpoint passed, and Gateway was run only
in side-effect-free dry-run mode. Age backup verification and restore to a
separate fresh PG18.1 container passed: 37/37 table counts, 14 migration rows,
and fixture tenant/team/job counts 1/1/1 matched. Source and restored app DML
rollback, app DDL denial, backup table/sequence reads, backup DML/`nextval`
denial, and app sequence usage all passed. The restored disposable database
was removed through the exact marker/name guard.

After both rehearsal projects were stopped with plain `down`,
`pnpm test:pubg` passed 68/68. OpenClaw/9Router IDs, start times and restart
counts matched the pre-stop snapshot (restart count 0); no private service was
restarted or changed. A host-loopback scrape of the new Worker metrics mapping
returned 502 in OrbStack despite the in-container endpoint returning 200; the
cause remains unverified and is documented in the Compose README. No real
PUBG/model credential, production DB, image push/deploy, 9Router change or
private OpenClaw restart was involved. Full evidence and command sequence:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-current-image-local-recovery.md`.

### M204 Worker metrics relay acceptance — 2026-10-14

Commit `7f3b95b` built on M204 OrbStack ARM64 as
`local/pubg-saas:git-7f3b95b` (image ID
`sha256:e52c734edc432eb5f9d84af9aa2c8086467f38146ec9dade75e26fe6b4c00d47`).
An isolated Compose project initialized a fresh PostgreSQL 18.1 volume, applied
the current migrations, and started a healthy Worker on an empty queue. The
host-loopback metrics GET returned 200 and contained `pubg_saas_worker_up 1`;
other paths returned 404 and POST returned 405. Docker inspection confirmed
the Worker had no host-port binding and joined only `postgres_private` and
`egress_internal`; only the egress proxy published the loopback relay port.

The temporary Compose project stopped with ordinary `down`, retaining its
isolated volume. OpenClaw and 9Router IDs, start times, running state and
restart counts were identical before and after (both restart counts 0).
Focused relay/Worker health/metrics tests passed 14/14; the full SaaS suite
passed 106/106 with no skips on the reused isolated PG18.6 fixture; SaaS and
private typechecks passed; the private PUBG suite passed 68/68; architecture
and secret checks passed. No Gateway, PUBG API, model endpoint or real
credential was used. The earlier full encrypted backup/restore and role-boundary
rehearsal is in the current-image checkpoint above; this relay-only change
does not touch PostgreSQL schema, backup tooling or role grants. Detailed
commands: `.agent/checkpoints/2026-10-14-pubg-saas-metrics-relay-host-acceptance.md`.

### Current-source M204 recovery repeat — 2026-10-14

The native ARM64 `7f3b95b` image passed the full local loop in two new Compose
projects: 14 migrations, healthy Worker/metrics relay, age backup verification,
fresh-container restore with 37/37 tables and 14 migrations, and 1/1/1
synthetic fixture rows. Source and restored app/backup role-boundary probes
passed. After guarded restore cleanup and plain `down`, Kurisu passed 68/68;
OpenClaw and 9Router IDs/start times/restart counts were unchanged. No Gateway
or provider credential was used. Detailed commands and artifact hash:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

### Current-source isolated Linux runtime/egress repeat — 2026-10-14

The same local ARM64 image was copied from M204 with `docker save/load` into
the separate OrbStack Linux VM; all eight rootfs layers and runtime config
matched. Fresh PG18.1 Compose applied 14 migrations and Worker/egress health
passed. The loopback metrics GET returned 200. In the Worker network namespace,
direct public/metadata TCP was unreachable, private-host and metadata proxy
CONNECTs returned 403, and public HTTPS through the proxy returned 200. Plain
`down` retained the PG volume. This is a separate VM on the same physical host,
not a cloud or M204 power-off test. No Gateway/provider credential was used.
Evidence and commands are in the current-source recovery checkpoint above.

The latest M204 age artifact then restored on this Linux VM into a fresh PG18.1
project: verification and guarded restore passed with 37/37 table counts and
synthetic tenant/team/job rows of 1/1/1. App/backup role and sequence grants
passed. Current Worker started healthy against the restored DB with one delayed
job, zero attempts and zero due work; metrics returned up=1. The target was
marker-cleaned and the project stopped with plain `down`. This confirms local
cross-VM portability, not cloud or physical-M204 outage independence. Details:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

### Current-source M2 source/OCI gates — 2026-10-14

The full `pnpm test:pubg-saas` suite passed 104/104 with no skips against the
reused loopback-only `pubg-saas-pg18` test container (PostgreSQL 18.6, database
`pubg_test`). `pnpm check:architecture` passed, as did the backup/Compose
PostgreSQL adapter safety suite (23/23). The current clean source built to a
local OCI image for both `linux/amd64` and `linux/arm64`; the OCI manifest
verifier accepted both platforms. The temporary archive was removed after
verification; no registry push occurred. This is source/build evidence only:
the prior ARM64 M204 Compose/recovery result remains separately recorded, and
the full Goal still lacks live human KOOK flows, real PUBG/model acceptance,
host-side metrics scraping on OrbStack, persistent backup scheduling, and the
final go/no-go gate. Details and commands:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-current-ci-gates.md`.

### M204 bounded 200-team host measurement — 2026-10-14

The existing synthetic benchmark ran once against an internal-only PG18.1
container on `nyannyan` (PG cap 1 GiB/1 CPU; runner cap 512 MiB/1 CPU). It
seeded 200 tenants/teams, 800 users and roster accounts, 400 matches and 1,600
match-player rows in a unique schema, then dropped that schema. At concurrency
8, authorized queries passed 200/200 in 32.42 s with P95/P99 86.95/207.99 ms;
worker fixture reads completed 200/200 with 0 failures and P95/P99 2.09/21.78
ms. The 20-connection pool peaked at 16 active with no waiters. Node process
RSS peaked at 93,360,128 bytes; sampled runner cgroup usage peaked at 114.5
MiB and PG at 80.08 MiB. PG reached its 1 CPU cap during the query phase.
Host MemAvailable was 6.63 GiB before, at least 6.54 GiB during, and 6.66 GiB
after. These are one bounded synthetic run with mocked provider fetches, not a
live PUBG rate-limit check or production capacity/SLO. Private OpenClaw and
9Router IDs/start times stayed unchanged, with restart counts 0. Evidence and
reproduction details are in the dated M2 rehearsal checkpoint.

### Restored Worker on a separate Linux VM — 2026-10-14

Transferred the current local ARM64 image from M204 to the isolated Ubuntu
24.04 ARM64 VM with `docker save | docker load` (no push). In a new Compose
project and fresh PG volume, the age-encrypted synthetic artifact restored
37/37 table counts, 14 migrations and tenant/team/job 1/1/1. App/backup
permission probes passed. The restored Worker, PG and egress proxy reached
healthy; its delayed synthetic job was not attempted, and its proxy denied the
M204 private target with 403. The Gateway and real providers were not started.
This adds separate-host recovery and Worker-start evidence, not proof of live
KOOK/PUBG/model behavior or measured release RPO/RTO. The test containers were
stopped without deleting the isolated PG volume; full commands are in the M2
rehearsal checkpoint.

## Current M1/M2 acceptance follow-up — 2026-10-14

M1 is accepted at source/offline scope on `880a5cf`: `pnpm test:pubg-saas`
100/100 (no skips), `pnpm test:pubg` 68/68, both affected typecheck groups,
and the SaaS build pass. The preference and alias flows retain team scope,
fresh authorization and confirmed mutation boundaries.

Built current ARM64 image `local/pubg-saas:git-880a5cf`
(`sha256:6dd0afafea5fc7d33c1ed3eed34e7834b0bed911dbf8f31da373671acf8d142f`)
in the local OrbStack Docker context. Two fresh isolated PG18.1 Compose
projects applied all 14 migrations. Encrypted backup/verify/restore matched
37/37 public table counts and 14 migration rows; tenant/team/job, preference,
alias and sequence state survived. App DML/no-DDL, backup read-only/no-
`nextval`, and app sequence-use checks passed on source and restored PG.
SaaS Compose was stopped with plain `down`, preserving isolated volumes; then
Kurisu regression passed 68/68 and read-only machine checks showed private
OpenClaw healthy and 9Router running. Neither was restarted or modified.

This is local OrbStack Docker evidence. The canonical CasaOS host-profile
machine `example-node` was absent from the current OrbStack inventory, so
canonical-host Compose/resource acceptance remains open. No real KOOK/PUBG/
model credentials were loaded for this run, no image was pushed, and no
production deployment or database was touched. Reproduction details are in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md` and
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`.

## Isolated Linux M2 image and recovery rehearsal — 2026-10-14

Built the current tree locally in the OrbStack Docker context as ARM64 image
`local/pubg-saas:git-516371e6e73f` (manifest digest
`sha256:2590b6d7f0fea5783620ed20ed3bbe4212fba0c49ac29aa9945a2fbd338b758e`).
The exact image was copied with local `docker save`/`docker load` into a new,
network-isolated Ubuntu 24.04 ARM64 VM; rootfs layer IDs matched. This was a
local transfer, not a registry push. Guest-native Docker build could not use
overlayfs in the isolated VM, so Compose used the host-built image.

Two fresh PG18.1 Compose projects applied all 14 migrations. Gateway and Worker
no-credential dry-runs passed. A synthetic tenant/team/job fixture was backed
up with age, decrypted/archive-verified, and restored into the second fresh PG
container: all 37/37 public-table counts and 14 migration rows matched; fixture
counts were 1/1/1. App DML/no-DDL, backup read-only/no-`nextval`, and app
sequence-use probes passed on source and restore. The restore database was
removed by the exact-marker cleanup command. Both projects were stopped with
plain `down`, preserving their isolated volumes.

After shutdown `pnpm test:pubg` passed 68/68. Read-only checks before/after show
the private OpenClaw container ID and start time unchanged, `healthy`, and
restart count 0; 9Router ID/start time also remained unchanged with restart
count 0. No private runtime or 9Router configuration was modified. This adds
isolated Linux Compose/recovery evidence, but does not prove canonical
CasaOS-host capacity, scheduled backup, or cloud operation with M204 isolated.
No real KOOK/PUBG/model credential was used; those acceptance gates remain
open. Full commands and artifact checksum are in the dated M2 checkpoint.

The checked-in `scripts/tests/pubg-saas-egress-smoke.mjs` makes the clean Linux
container network check reproducible. On the same guest, its Compose runs
passed independently for Gateway and Worker: both had no default route, direct
public and metadata connections returned `ENETUNREACH`, the proxy returned 403
for metadata and `host.docker.internal`, and a public HTTPS HEAD through the
proxy returned 200. The proxy-only Compose project was stopped afterward; no
PG or application process remained running.

The systemd backup job exposed a Git mode defect: its shebang script was
`100644` although the service template invokes it as `ExecStart`. The tracked
mode is now `100755`, and the workflow classifier covers this SaaS backup job.
The executable job completed against the isolated synthetic PG: it created an
age-encrypted 37-table backup, pruned retention, and the artifact verified.
An expired synthetic copy was then removed while recent backups remained.
`systemd-analyze calendar/verify` accepted the six-hour UTC timer and a
temporary rendered service path; no system user or timer was installed/enabled.
The initial direct invocation failed with `Permission denied` before this fix;
the complete rerun passed. Details and test evidence are in the checkpoint.

## Native clean Linux image build and Compose smoke — 2026-10-14

Built the current source natively in the isolated Ubuntu 24.04 ARM64 VM after
switching that VM's Docker storage to VFS and clearing only the inherited,
unreachable proxy variables from the build command. The first unfiltered
attempt failed before base-image resolution because `HTTP_PROXY` pointed at the
VM-inaccessible host proxy; with the variables unset, the full frozen install,
TypeScript builds and image packaging completed. Image
`local/pubg-saas:git-6313ef7` is `linux/arm64`, ID
`sha256:e144276b8061d2362d2abcd9ecdd26421b5bed049541bfe90b268210e601afc8`.

The isolated Compose source project rendered against that image; Gateway and
Worker dry-runs passed without `--apply`, then the checked-in egress smoke passed
in both Compose network namespaces. Each had no default route, direct public
and metadata TCP returned `ENETUNREACH`, the proxy returned 403 for metadata
and `host.docker.internal`, and public HTTPS through the proxy returned 200.
The test project was stopped afterward. No real credentials, private host,
registry push or deployment was involved. This closes the native Linux ARM64
build gate; canonical host capacity and public-only cloud operation remain
open.

## Latest-image encrypted PostgreSQL recovery — 2026-10-14

Repeated the complete isolated PG workflow on `local/pubg-saas:git-6313ef7`
using fresh source/restore Compose project names and volumes. Current image
migrations and Gateway/Worker dry-runs passed. Age backup/verify/restore
completed into the new PG container; all 37/37 public table counts and 14
migration rows matched, with the synthetic tenant/team/job each restored as
one row. Source and restored app/backup role probes passed, including app DML
rollback, DDL denial, backup read-only/no-`nextval`, and app sequence use.
After guarded target cleanup and ordinary Compose `down`, `pnpm test:pubg`
passed 68/68; read-only checks showed private OpenClaw and 9Router IDs/start
times unchanged with restart count 0. No provider credentials, production DB,
image push, deployment, private runtime write or OpenClaw restart was involved.
Full evidence and representative commands are in the dated M2 checkpoint and
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`.

An additional ephemeral systemd integration test loaded the repository backup
service/timer into `/run` in `pubg-saas-m2-clean`. The real oneshot ran under a
dedicated temporary identity, returned `Result=success`/exit 0, and produced a
verified encrypted 37-table artifact. The six-hour calendar timer showed its
next scheduled event. A staging `.env` permission mismatch was corrected to
owner-only mode, preserving the adapter's guard. Temporary unit files, test
identity/group membership and staging were removed; the timer is not installed
on M204 or the canonical host. Full evidence is in the dated checkpoint.

## KOOK test-server connection check — 2026-10-14

Using the protected, ignored `.env.local` only for the authorized P3 test
server, a read-only inventory confirmed one guild and one text channel; no
identifiers or names were retained. A fresh isolated PG18.1 project applied
all migrations through `0014`, seeded only a synthetic team/account fixture,
and ran the current local image's Gateway with a local nonfunctional PUBG key,
no model configuration and a five-message daily cap. KOOK authentication
completed and `kook_gateway_state` held one non-null session; sequence remained
zero. No human event arrived, so inbox/outbox, preference and alias counts
remained zero. This proves test-bot authentication only, not P3 message, button,
permission or send acceptance. The Gateway, PG and proxy containers were
stopped with plain `down`; the isolated named volume was preserved and the
temporary credential copy was removed. No message was sent, no PUBG/model
request was possible, and production resources were untouched.

The desktop automation surface could not bind the open Chrome window, and no
human actor action was available in this run. Resume live P3 by restarting the
isolated stack and having a test-server actor send `/pubg help` then click a
read-only guidance button. Do not count protocol fixtures or the successful
WebSocket handshake as that acceptance.

## M2 source and recovery evidence — 2026-10-14

M2 source commits `2271a4b` and `27523ae` add PostgreSQL-backed per-team worker
leases/fencing/retry, bounded worker concurrency and graceful drain. Worker
cycle logs add aggregate due/lease/backoff counts, oldest due age and process
RSS/heap without tenant/team IDs. They now also derive identifier-free alert
codes for unavailable queue telemetry, 15-minute due-job lag, expired leases,
team sync failures and RSS at 80% of the Compose cap. Alert delivery and
canonical-host thresholds remain uninstalled/unverified. The
default minute windows are 10 requests/user, 60/channel, 120/tenant and
300/bot. KOOK REST rate headers now pause the affected route/global bucket, and
429 retry deadlines survive outbox retries. The isolated 200-team benchmark completed
200/200 team runs with 0 failures; the worker phase ran 7,356 SQL statements in
3,105 ms (p95 62 ms), peaking at 16/20 pool connections with no waiters. This
is a local synthetic measurement, not M204 resource headroom or a capacity/SLO
claim.

The public-schema-only age backup/restore utility has 14 safety tests. A real
encrypted backup, decryption/archive verification, and 35-table restore passed
on the reused isolated PostgreSQL 18 fixture. The restore creates a disposable
database owned by the migration role and reapplies app/backup grants; tests
proved app DML without DDL, backup SELECT without writes, and future migration
default grants. The disposable database and temporary cluster roles were
removed through guarded cleanup. `infra/pubg-saas` now contains a Compose/Image
source unit with pinned multi-platform base image manifests, an internal
PostgreSQL network, only a host-loopback database port for its read-only backup
role, read-only runtime filesystems, and separate bootstrap/migrator/app/backup
roles. Rendered Compose config and secret-file connection URL checks pass. A
six-hour UTC systemd job and guarded minimum-seven-day retention command are
source-complete but uninstalled; the one-shot backup job passed against the
isolated PostgreSQL fixture. At the time of this source-only checkpoint, the
Docker image had not been built and no service was started.

At that source checkpoint, clean Linux/cloud restore, scheduled retention,
tested egress restrictions and public/private stop-isolation remained open. A
local M204 Compose stop/private-source regression was completed later and is
recorded below; live OpenClaw and isolated-cloud independence remain open. The
ordinary Docker bridge does not restrict app egress.
KOOK 200-guild eligibility, developer-account-wide daily send quota, live API
quota feasibility, live model accuracy/P95, and M204/container RSS headroom also
remain open pre-release gates. The P4 benchmark runner now requires a protected
external 100–200-case dataset and test-provider credentials; no live benchmark
has run. No private runtime, production database, 9Router or deployment was
touched. Full M2 evidence is in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-source-acceptance.md`.

## M2 local Compose and recovery drill — 2026-10-14

Built local ARM64 image `local/pubg-saas:git-f0aa16b`
(`sha256:f6985df9ea17bde1d7f5b60826e7fb336047ad5e74d93f896f5e16a52dc5f21c`).
Fresh source and restore Compose projects used separate PostgreSQL 18.1
containers and volumes. The source applied migration `0011`, the worker started
with an empty queue, and the gateway completed side-effect-free dry-run. No
real KOOK, PUBG or model credential was loaded into this local drill; provider
calls and production deployment were not performed.

OrbStack did not activate the requested loopback host port for PostgreSQL on
the `internal: true` network. A checked-in local-only client adapter now runs
the existing backup/restore utility through `docker compose exec`, verifying
the pinned PostgreSQL image, internal project-owned networks, loopback-only
port bindings and project-owned volume before each command. Credentials travel
to a temporary mode-0600 passfile in the container's tmpfs, not Docker argv.
Encrypted age backup and decryption/archive verification passed. Restore into
the separate fresh PG container passed with all 37/37 public base-table counts
matching: 11 migration rows and one synthetic tenant, team and sync job.
App insert/update/delete passed in a rolled-back transaction while app DDL was
denied. The backup role could read tables and current/future sequence state but
could not write or call `nextval`; the app retained future sequence usage. The
restored disposable database passed the same permission probes and was removed
through exact-marker guarded cleanup. The focused backup/restore and adapter
unit tests pass 21/21.

Both new Compose projects and the previous temporary source project were
stopped with ordinary `docker compose down`; their isolated named volumes were
preserved. The pre-existing `pubg-saas-pg18` integration-test fixture remains
running and is not part of the public application stack. During the SaaS stop,
`pnpm test:pubg` passed 68/68, and read-only checks showed private OpenClaw
still `running/healthy` and 9Router still `running` on the available OrbStack
machine. Neither runtime was stopped, restarted or modified. This proves the
offline private regression and process-health independence; no private PUBG
tool query was issued.

The KOOK test-server credentials in `apps/pubg-saas/.env.local` were not read
or used for this M2 local run; the previously recorded P3 smoke remains limited
to gateway auth, one labeled outbox delivery and sequence-1 resume. Human-user
P3 flows and real PUBG/model provider acceptance remain open. Clean Linux host
backup, scheduled retention, clean-host egress verification, measured M204
resource headroom and isolated-cloud recovery also remain open.

A later read-only KOOK inventory used the mode-0600 test credential and found
one guild with one text channel; no identifiers/names were retained and no
message was sent. This does not satisfy the human-user P3 cases; no test actor
was available. A fresh restore-PG run also started the actual one-shot SaaS
worker with an internal-only provider network: it discovered one synthetic
team and one delayed job, attempted zero syncs, and exited successfully. The
guarded disposable database was removed and its Compose project stopped while
preserving its volume. No PUBG/model provider call was possible. Full detail is
in `.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

Reproduction commands and artifact handling are recorded in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`;
the repository procedures remain in `infra/pubg-saas/README.md` and
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`.

Post-0012 local acceptance is now committed as `a04224a`. The local ARM64 image
`local/pubg-saas:git-a04224a` was Compose-started against fresh isolated PG18.1
source and restore containers. Migration 0012, gateway dry-run, encrypted age
backup, new-container restore and all 37/37 public table counts passed; the
restore manifest contained 12 migrations and synthetic tenant/team/job counts
of 1:1:1. App DML/no-DDL, backup read-only/no-nextval and app sequence-use
probes passed before and after restore. With both temporary public projects
stopped, Kurisu tests passed 68/68; private OpenClaw remained healthy and
9Router remained running, with neither restarted or changed. Current source
gate: SaaS/PostgreSQL 100/100, private 68/68, affected typechecks, backup
safety 14/14, secret scan and diff check passed. No real provider credential
was used, and no image push, deployment, production DB, 9Router or private
runtime change occurred. Full evidence and reproduction references are in the
dated M2 local rehearsal checkpoint.

The local egress source adds a dedicated HTTPS CONNECT proxy and removes the
gateway/worker from the public bridge. Focused tests pass 6/6, including
private/metadata resolution denial and WSS dispatch. Local Compose confirmed
no app default route, metadata denial, `host.docker.internal` denial, and
credential-free public HTTPS through the proxy. With the shared isolated PG
fixture explicitly supplied, `pnpm test:pubg-saas` passed 92/92 with no skips;
without that env var the suite skips PostgreSQL tests and is not accepted.
Private source regression remained 68/68 with affected typechecks passing.
Commit `8316f4e` builds as ARM64 image `local/pubg-saas:git-8316f4e`, digest
`sha256:1e94dfc77c0ad6d07928d3138e789e18ad19e17286f14647a1b50709f05e5b77`.
The committed-image migration/worker/dry-run/egress repetition passed; after
plain Compose `down`, Kurisu tests again passed 68/68 and read-only OrbStack
status showed OpenClaw healthy and 9Router running. Idle PG/proxy memory was
28.58/13.22 MiB under 1 GiB/128 MiB caps; this is not loaded M204 headroom.
The proxy restricts addresses, not public hostnames; clean Linux/cloud checks,
schedule installation and host resource headroom still remain.

## M2 amd64 image and build-context hardening — 2026-10-14

Committed `.dockerignore` fix `f70d29b` excludes `*.env.local`. A first local
amd64 Buildx build occurred before that rule; the credential file was not loaded
by an application process and no image was pushed, but it may have entered the
local BuildKit context/cache. SaaS-specific private cache records were pruned
(820 MiB); remaining matching records are shared final runtime/entrypoint
layers. Rebuilt commit `f70d29b` as `linux/amd64`, manifest-list digest
`sha256:329b330f43cdd84861dde5072109467306d894886c60ecff49b52633e01c18e4`.
The offline read-only container probe returned Node `x64` and confirmed the
local env file is absent from the final image; its temporary tag was removed.
This remains a local emulated image smoke, not clean amd64 Linux Compose or
restore acceptance. `pnpm check:secrets` and `git diff --check` passed.
Evidence is recorded in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

## M2 CI and combined multi-architecture build — 2026-10-14

Added `.github/workflows/pubg-saas.yml` with ephemeral PostgreSQL integration,
private Kurisu regression, public/private typechecks, architecture/secrets
gates, backup safety tests, the synthetic 200-team benchmark, Compose config
render, and a no-push amd64/arm64 OCI build. All Actions are SHA-pinned; the
workflow has read-only repository permissions and uses only synthetic values.
It has not run on GitHub because the branch is not pushed.

Its source/database steps then passed locally against the reusable isolated
PostgreSQL fixture: `pnpm check:secrets`, `pnpm check:architecture`, SaaS PG
tests (92/92), Kurisu tests (68/68), both typecheck groups, backup/restore
tests (21/21), and the 200-team benchmark. The fresh benchmark completed
200/200 worker runs without failures; query p95 was 81.67 ms, worker read p95
61.25 ms, and pool use peaked at 16/20 with no waiters. This is test-fixture
data, not canonical M204 capacity. The GitHub workflow itself remains
unexecuted.

A local Buildx OCI build from the same runtime source verified both amd64 and
arm64; manifest-list digest is
`sha256:cf6fb5cbb1e1771845b86bdb40cc649ac14a496e47311ce6bf3155935d941d3a`.
`python3 scripts/verify-pubg-saas-oci.py` checks the generated archive. Compose
render passed with synthetic placeholders and started no services. Clean Linux
host/restore, installed backup scheduling, measured canonical-host resources,
cloud independence, live provider acceptance, KOOK quota eligibility and
human-actor P3 flows remain open.

The current source commit `91bb60f` was then built locally for ARM64 as
`local/pubg-saas:git-91bb60f` (manifest digest
`sha256:ce344830bab21504e5f1ca13690eba539f989d09f9ce2d413ced48ffe2ed0682`).
Fresh source and restore PG18.1 Compose projects passed migration 0011,
gateway dry-run, and an empty/delayed-queue worker startup without real
credentials. Encrypted age backup verification and restore matched all 37/37
public tables; source and restored app/backup permissions passed, with the
synthetic tenant/team/job counts at 1:1:1. After plain `down` on both projects,
`pnpm test:pubg` passed 68/68 while OpenClaw remained healthy and 9Router
remained running. The first two failures were harness context-label/env
omissions; targeted reruns passed without source changes. Evidence and exact
commands are in `.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.
Real KOOK/PUBG/model acceptance remains skipped for lack of test credentials.

Current `91bb60f` also passed an emulated AMD64 Compose path: fresh PG18.1
source/restore containers, migration 0011, gateway dry-run, worker startup,
encrypted backup and fresh-container restore (37/37 tables), and source/restore
permission probes. The restored disposable DB was guarded-cleaned, and both
Compose projects were stopped with volumes preserved. A fresh Ubuntu VM could
not provision under OrbStack in three network modes (no guest IP after two
minutes); AMD64 emulation is not recorded as native clean-Linux acceptance.
The reusable isolated PG fixture remains running, private OpenClaw remained
healthy, and 9Router remained running. No image push/deploy or real provider
credential use occurred. Details: `.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

The existing synthetic 200-team benchmark now reports in-process RSS/heap
peaks (10 ms samples). A targeted run passed 200/200 authorized tasks and
worker team runs, with 0 failures, pool 16/20 and no waiters; query P95/P99
79.83/110.50 ms, worker P95/P99 62.37/103.50 ms, Node RSS 169.8 MiB peak and
heap 54.2 MiB peak. A separate coarse local sample saw 24 GiB host RAM and
74% free before/min/after, and PG fixture memory 58.5→112.2 MiB (four samples).
These are local Mac/fixture observations, not `example-node` headroom or an SLO;
canonical-host and actual container-service resource gates remain open.

Final local source gate on `7ff2d6d` passed: SaaS/PostgreSQL 92/92, Kurisu
68/68, backup/restore plus Compose PG adapter 21/21, both typecheck groups,
architecture/secrets checks and diff check. The final benchmark completed
200/200 authorized tasks and worker runs without failures; details and exact
resource counters are in the dated M2 rehearsal checkpoint. Native
clean-Linux/cloud independence, installed backup scheduling and live
eligibility/human-actor gates remain open.

M2 source follow-up adds Worker `GET /healthz`, bound to container loopback,
and a Compose healthcheck with no published port or tenant data. Targeted tests
passed 2/2; full SaaS/PostgreSQL tests now pass 94/94, Kurisu remains 68/68,
and both typecheck groups plus all 21 backup/Compose-PG safety tests pass. Ruby
YAML syntax parsing passed. A fresh local ARM64 image and isolated Compose stack
then applied migration 0011 and reached `WORKER_HEALTH=healthy` with an empty
queue; no provider calls or gateway startup occurred. The project was stopped
with plain `down`, preserving its empty named volume; private OpenClaw remained
healthy and 9Router remained running. No image was pushed. Host alert routing,
canonical-host capacity, and native cloud recovery remain open. Evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

Official KOOK policy was rechecked: an unverified developer is limited to one
bot/one developer-owned guild, 200 sends/day and 60 requests/min; verified
eligibility lists up to 10,000 guilds and 240 requests/min, while proactive
messages share a 10,000/day account-wide ceiling resetting at 12:00 Beijing.
At the Goal's 30 queries/team/day planning baseline, 200 teams would mean
6,000 ordinary one-reply sends/day (60% of that shared cap) before other bots
or operational messages; two counted replies/query would exceed the cap. This
is planning arithmetic only. The one-guild/one-channel test inventory does not
prove verification, written capacity approval or remaining quota. Do not raise
the 200/day runtime budget or claim capacity before those facts are confirmed.

## Concurrent 9Router upstream diagnostic detail patch — 2026-10-10

The operator-approved Apply rollout deployed
`local/9router:git-83bb76b5e7c8-20261010T032550Z` with manifest digest
`sha256:828a0c7b2c54e169c8ec4a0219f764c1ca2024efb04a79afb5db2f95a269be9a`.
The effective npm 0.5.95 route and Combo bundle both report `verified`; health,
policy, diagnostic-header, reference-preservation and fallback fixtures passed.
The authorized real prompt-only smoke saw `sunburst` return 502, then `flare`
succeed, with no request-scoped cooldown or account lock. Rollback and bounded
evidence are in `.agent/checkpoints/2026-10-10-9router-upstream-diagnostics-detail-patch.md`.

The “Selected model is at capacity” screenshot was a Codex development task UI
capacity error, not a WhatsApp or 9Router provider response.

## Concurrent Amadeus runtime fix — 2026-10-10

Amadeus 1.10.2 is deployed on CasaOS `example-node`. The native heartbeat sender
now blocks text-only `NO_REPLY`, handles control-prefixed sentinels, and strips
leading internal control markers from real alerts. This does not change the
active Image Lab scope or its production GPT-only image invariant. Evidence and
rollback are in
`.agent/checkpoints/2026-10-10-amadeus-heartbeat-silent-delivery-release.md`.

## Concurrent VPS traffic window release — 2026-10-10

VPS accounting now samples the KiwiVM provider and subscription counters every
60 seconds, retains three days of bounded deltas, and exposes complete-aware
12-hour `reportWindow` fields for whole-VPS bytes, active subscription bytes,
retired Legacy bytes when available, and an explicitly uncalibrated
other-service/unattributed residual. Amadeus 1.10.3 is deployed with the
updated owner query and 09:30/21:30 Asia/Shanghai report prompts. The first
provider window is intentionally `unknown` until a full 12 hours of post-rollout
sample coverage exists. Evidence and rollback are in
`.agent/checkpoints/2026-10-10-vps-traffic-window-release.md`.

Active Goal: `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md` (operator-selected for this worktree).

Production invariant: Amadeus 1.9.7 remains GPT-only for image generation; local Qwen stays outside the production route and is used only by the Image Lab.


## Concurrent VPS daily traffic fuse Goal — 2026-10-10

Goal: `docs/AMADEUS_VPS_DAILY_TRAFFIC_FUSE_GOAL.md`.
Status: `PHASE_0_READONLY_AUDIT_CAPTURED; PHASE_1_SOURCE_IMPLEMENTED; QDISC_AND_RECOVERY_DESIGN_PENDING; LIVE_APPLY_PENDING`; **this document submission is not permission to modify live traffic control**.

Policy: Shanghai-local calendar day (00:00 to next 00:00), 40 GB one-time warning, 50 GB whole-gateway threshold, shared 2 Mbps non-management business egress shaping until next 00:00, then verified automatic release. KiwiVM remains provider quota truth; local WAN monitoring needs calibrated scope and truthful source/coverage states. A VPS-side timer must restore speed even when OpenClaw/WhatsApp is unavailable.

Kurisu alert events **must reuse** the existing `worldline_notification_intent` -> presentation adapter -> canonical WhatsApp owner outbox. Warning/engagement are 世界线偏移, verified release is 世界线收束, scheduled VPS report remains D-Mail; operator failures use the current policy's appropriate theme. Never add a second sender or hand-built theme renderer.

Compatibility: `example-account-01`-`example-account-05` plus `example-device` remain valid, Legacy stays retired, and existing VLESS/HY2 security hardening, ports, SSH recovery, subscriber credentials, and 09:30/21:30 jobs stay intact. Separate explicit runtime apply/checkpoint is mandatory.

The owner/read-only integration was deployed as Amadeus `1.10.4` from commit
`633dd21`; OpenClaw and Product Radar are healthy on CasaOS `example-node`, and
the protected runtime checkpoint/post-deploy evidence are recorded in
`.agent/checkpoints/2026-10-10-amadeus-1.10.4-vps-traffic-fuse-source-release.md`.
The VPS traffic-fuse service/timers remain uninstalled and the existing foreign
`fq` root qdisc remains unchanged.

## Concurrent VPS proxy security hardening Goal — 2026-10-09

Active concurrent Goal: `docs/AMADEUS_VPS_PROXY_SECURITY_HARDENING_GOAL.md` (explicitly selected by the operator).

Current security baseline: the active proxy identities are `example-account-01`–`example-account-05`
plus `example-device`; Legacy is retired and its old subscription/HY2/VLESS
credentials are rejected. The hardening Goal must not rotate any active token,
HY2 secret, VLESS UUID, Reality key/shortId, SNI, hostname or public proxy
port, and must not require client re-import.

Planned scope is server-side only: Xray REALITY anti-steal loopback fallback
gate with exact SNI allowlist + blackhole, fallback inbound traffic telemetry,
HY2 masquerade egress audit/local-only replacement when necessary, bounded
failed-auth telemetry and conservative optional throttling using Hysteria's
reported client addr, plus owner-only Kurisu security visibility. Existing
09:30/21:30 reports are updated in place only after compatibility acceptance.

Status: `PHASE_0_4_APPLIED; VLESS_HY2_COMPATIBILITY_PASS; OPENCLAW_AND_REPORTS_APPLIED; MANUAL_REPORT_SENT; DIRECT_OWNER_DM_QUERY_PASS_2026-10-09T11:08+08:00; TASK_OUTPUT_EXPOSURE_ACCEPTED_RESIDUAL; ACTIVE_CREDENTIALS_UNCHANGED; COMPLETE`.

The operator explicitly pre-authorized the scoped Git/macOS/frpc/frps/Caddy/DNS-if-needed/runtime-secret/restart/smoke mutations in the active Goal and asked execution to continue without routine confirmation until `https://image.example.com` is deployed and usable. This authorization does not extend to SSH-auth/firewall changes, unrelated DNS/services, credential rotation, or other out-of-scope destructive operations.

## Active Image Lab target — 2026-10-08

The current LAN debug surface is being replaced by a deliberately small Image Lab:

```text
Mode:
  Quality — base Qwen 16-step
  Fast    — real Fun-Acc/PDD 4-step

Generation resolution:
  1024x1024
  1024x768
  768x1024

Edit resolution:
  automatic from reference geometry, capped at 1024px / 1MP

Seed:
  -1 random
  >=0 fixed
```

No CFG/strength/sampler/cache/FA/mmap/model controls are exposed. Reference editing remains supported through Qwen3-VL + mmproj. The Image Lab path must not inject an edit strength below 1.0. Exactly one local `sd-server` may be resident; profile changes restart that single engine rather than keeping both profiles loaded.

LAN/private direct access remains no-login. The exact public host `image.example.com` requires password-only application authentication using a runtime-only verifier; the operator-provided plaintext password must never enter Git, logs, Caddy, frp configs or checkpoints.

Public topology remains the existing architecture:

```text
image.example.com -> VPS Caddy -> VPS frps -> HomeLab frpc -> macOS Image Lab :18798
```

Only the UI is public. Qwen bridge/engine ports remain loopback-only.

Status: `SOURCE_AND_FOCUSED_CHECKS_PASS; MAC_UI_REDEPLOYED; PUBLIC_HTTPS_LOGIN_PAGE_LIVE; UNAUTH_APIS_BLOCKED; QUALITY_CFG1_DEPLOYED_FOR_OPERATOR_COMPARISON; TASK_MODAL_AND_AUTO_EDIT_RESOLUTION_DEPLOYED; OPERATOR_IMAGE_CHECK_PENDING`.

Quality remains capped at 16 steps. For the operator's sampling comparison,
the base profile now uses CFG 1 while retaining the same model, VAE, sampler,
and schedule. The operator will submit and judge the next image; no generation
was submitted during this configuration change. The protected pre-deploy
snapshot and rollback details are in
`.agent/checkpoints/2026-10-08-qwen-image-quality-cfg1-redeploy.md`.

Task-history image viewing now opens a modal without replacing the main output
preview. Reference edits automatically preserve valid source geometry or scale
proportionally within the 1024px / 1MP cap; completed task and result metadata
show the actual output dimensions. Reference bytes and MIME are preserved.
Focused bridge/UI tests (35), JavaScript/Python syntax checks, secrets scan and
`git diff --check` passed. The Mac bridge and UI LaunchAgents were applied; the
bridge is `ready`/`idle`, the local task queue is empty, local UI returns 200,
the public HTTPS root returns 200, and unauthenticated public tasks return 401.
No login or image generation was performed. Protected rollback snapshot and
details: `.agent/checkpoints/2026-10-08-qwen-image-modal-auto-resolution.md`.

The exact `image.example.com` Caddy site is now deployed from
`infra/vps/image-lab.example.Caddyfile`. The existing full Caddyfile validated
before and after the append, Caddy reloaded successfully, DNS already resolved
through the existing Cloudflare proxy, and Caddy obtained a valid Let's Encrypt
certificate. The authenticated Mac UI and single frpc mapping are now live:
`image.example.com` returns its password page over verified HTTPS. The
runtime verifier exists only at the documented Mac secrets path with mode
`0600`; its contents were not read. Wrong-password login and unauthenticated
public model/task/generation requests return `401`. The HomeLab guest reaches
the Mac UI at `192.168.5.3:18798`; frpc has exactly one additional mapping and
reports `qwen-image-lab-tcp` start success. Persistent IPv4/IPv6 INPUT rules
drop non-loopback TCP `18798` while permitting Caddy's loopback upstream; SSH
was verified in a new session and all unrelated firewall rules are unchanged.
Evidence and rollback are in `.agent/checkpoints/2026-10-08-qwen-image-public-lab-caddy-staged.md`,
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-frps-port.md`,
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-firewall.md`, and
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-frpc.md`.

The new bridge reports ready and exposes only Quality/Fast. The public login
page and unauthenticated gates are verified. The earlier local Quality
1024x1024 fixed-seed smoke timed out at 600 seconds after reporting 15 of 16
steps; the UI received HTTP 504. The task failed after 610003 ms and is not
running. Generation deadlines are now 900000 ms in both profiles and the UI
proxy waits 910 seconds; the separate model-load timeout remains 600 seconds.
The bridge reports `deadlineMs: 900000`, and local UI/model-discovery smoke
passed after redeployment. The operator has since authenticated to the public
Image Lab and reports that several Fast-mode outputs look good across random
and fixed seeds. Quality CFG 1 is now deployed at 16 steps for operator
comparison; no image was generated during this config change. Evidence and
rollback are in
`.agent/checkpoints/2026-10-08-qwen-image-quality-cfg1-redeploy.md`.

The operator reported poor image quality and requested restoration of the
engine configs from `origin/main`. Quality/Fast JSON files now match that Git
revision: Quality remains 16 steps / CFG 1 with implicit legacy
`--diffusion-fa` and no configured prefix cache; Fast remains 4 Fun-Acc/PDD
steps / CFG 1 with `--diffusion-fa`, `q8_0` and mmap. The stale-engine port
ownership guard and SIGTERM child cleanup remain enabled. No image was
generated during the config restoration. Deployment and rollback evidence:
`.agent/checkpoints/2026-10-09-qwen-image-restore-origin-config.md`.

The 12:23 Quality task was marked successful after 92.169 seconds, but its
image was visibly incomplete. Investigation found an orphan Fast engine still
holding port 18795 after a bridge restart. The bridge now checks that its
internal port is free before starting and handles SIGTERM by stopping its own
engine child. Evidence is in
`.agent/checkpoints/2026-10-09-qwen-image-quality-stale-fast-engine.md`.

The earlier `--fa` plus prefix-cache `auto` trial is retained as historical
evidence in `.agent/checkpoints/2026-10-09-qwen-image-quality-fa-prefix-auto.md`.

The Image Lab task history now has an authenticated, task-ID-bound image viewer.
Seed entry uses decimal text and BigInt validation up to `9223372036854775807`;
the server converts the decimal string to an exact integer before forwarding,
and large effective seeds are serialized as strings for browser display. The
updated Mac LaunchAgent was applied and local UI/model-discovery smoke passed.
Public HTTPS still presents the password page and unauthenticated health,
models, tasks and generation APIs return `401`. No authenticated public image
request was made. Evidence and the protected pre-deploy Mac snapshot are in
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-seed-view-redeploy.md`.

## Previous local Qwen image debug UI baseline — 2026-10-07

The stable local Qwen bridge remains on loopback port 18793. A separate
LaunchAgent serves the generation/edit page on port 18798 and proxies only to
that bridge; all private/loopback clients are allowed without a UI login. The
current LAN URLs are `http://192.168.5.3:18798` and
`http://192.168.5.112:18798`. The user UI access code from the first version
was removed. Successful PNG results now auto-save to
`~/Pictures/Amadeus/QwenImage` (directory `0700`, files `0600`); the page and
task history display saved paths and save failures. `/`, `/api/tasks`,
unauthenticated model discovery, and both LAN URLs returned HTTP 200 after
deployment. This does not alter the GPT-only production route, 9Router, or the
paused Fun-Acc candidate. Status:
`RUNNING; AUTO_SAVE_DEPLOYED; LAN_SMOKE_PASS; NO_REAL_POST_DEPLOY_GENERATION_TEST`.

The unconfirmed request from the 2026-10-07 UI restart is historical. Before
the 2026-10-08 source rollout, the bridge reported `idle` and no `sd-server`
process was running; there is no model request currently in flight.
Rollback files and deployment evidence:
`.agent/checkpoints/2026-10-07-qwen-image-debug-ui-autosave.md`.

Paused Goal: `docs/AMADEUS_QWEN_IMAGE_2_1_FUNACC_4STEP_ACCELERATION_GOAL.md` (paused by operator; preserve candidate work without deployment).

Completed/deployed baseline Goal: `docs/AMADEUS_QWEN_IMAGE_2_1_UNCENSORED_EDIT_FALLBACK_GOAL.md`.

Superseded Goal: `docs/AMADEUS_KREA2_NSFW_LOCAL_FALLBACK_GOAL.md`.

## Active runtime operation — 2026-10-07

Add an explicit production fallback gate defaulting to disabled. Keep the
configured `openai/amadeus-image` route and 9Router's `cx/gpt-image-2.5`
primary unchanged. `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=1` remains candidate-only and
does not enable normal production fallback. The currently reported 9Router
`arthur-combo` HTTP 408 is a primary-provider failure; after this cutover it
must remain a visible failure, not trigger a Qwen request. Do not alter 9Router
or the local Qwen bridge as part of this operation.

Status: `DEPLOYED; OPENCLAW_HEALTH_PASS; FALLBACK_GATE_OFF; CANDIDATE_WORK_PRESERVED`.

## Paused acceleration objective — 2026-10-07

The paused Goal was narrowed to a **1024-class-only** Fun-Acc/PDD 4-step local Qwen acceleration profile, with detailed speed and quality testing reserved for the operator after any future deployment.

Target:

```text
Qwen-Image-2.1 Uncensored Q4_K_M
+ stable-diffusion.cpp Metal
+ real Fun-Acc / PDD 4-step semantics
+ correct custom sigma schedule
+ CFG approximately 1
+ supported Flash Attention
+ Qwen-Image-2.1 prefix cache (q8_0 first, auto fallback)
+ mmap if stable
+ Qwen3-VL-8B Q4_K_M + mmproj for edits
+ idle shutdown 900s
```

Production resolution in this Goal:

```text
T2I: 1024x1024
Edit: preserve source aspect ratio inside a 1024-class envelope
2K: out of scope
```

Required validation is minimal:

- service/model starts;
- one 1024 text generation works;
- one single-reference edit works and visibly depends on the reference;
- no OOM/crash;
- OpenClaw can reach the protected bridge;
- normal OpenClaw/WhatsApp service health remains green.

No formal 16-step vs 4-step benchmark, detailed visual scoring, <=180s target, <=120s stretch target or 2K test is required before deployment. The operator will evaluate real-world speed and image quality after deployment.

The existing 600-second image timeout stays unless the minimal smoke proves it insufficient.

Status: `PAUSED_BY_OPERATOR; CANDIDATE_CHANGES_PRESERVED; NOT_DEPLOYED`.

## Concurrent VPS security operation — 2026-10-07

The old shared subscription URL token has been revoked. After the operator's
explicit authorization, the Xray VLESS UUID and Hysteria 2 password were also
rotated, the four current subscription formats were updated in place, and both
proxy services were restarted. The current URL token is unchanged; clients must
refresh or re-import their subscriptions to obtain the new proxy credentials.
The old proxy credentials no longer authenticate against the running services.
The four current public subscription links return `200`; Caddy, Xray, Hysteria,
and the subscription responder are active. Current links remain outside Git in
a local `0600`-protected file. Evidence:
`.agent/checkpoints/2026-10-07-vps-proxy-credential-rotation.md`. Prior stages:
`.agent/checkpoints/2026-10-07-vps-subscription-old-url-revoked.md` and
`.agent/checkpoints/2026-10-07-vps-subscription-rotation-staged.md`.

## Concurrent 9Router runtime upgrade — 2026-10-07

At the operator's authorization, 9Router npm `0.5.95` was built from committed
source `cb223a0` over the existing digest-pinned `0.5.75` base and deployed to
CasaOS machine `example-node` as
`local/9router:git-cb223a0bc9e4-20261007T065751Z`. Managed TTS-style,
runtime-policy, and image Combo safety patches were applied to the exact new
package. Focused tests, secrets scan, isolated image checks, live health,
expected auth rejection, GPT Image Combo, and runtime policy checks passed.
Protected pre-switch backup:
`/DATA/AppData/9router/backups/router-upgrade-20261007T065751Z`. Evidence and
manual rollback instructions:
`.agent/checkpoints/2026-10-07-9router-0.5.95-upgrade.md`. Qwen WhatsApp
fallback acceptance remains pending; do not mark the active Goal complete.

## Paused Qwen fallback Goal scope

- keep `cx/gpt-image-2.5` as the primary image backend;
- keep 9Router's active image Combo primary-only;
- replace the paused Krea2 local fallback with `abenzerps/Qwen-Image-2.1-Uncensored-GGUF` using `qwen-image-2.1-UC-Q4_K_M.gguf`;
- make single-reference image editing the P0 local fallback capability;
- use Qwen3-VL-8B GGUF + verified mmproj/`--llm_vision` + `qwen_image_2.1_vae_bf16.safetensors`;
- route eligible failed reference edits to the protected local `/v1/images/edits` path without dropping the reference image;
- preserve the existing Asset Registry -> native task_completion -> Completion Agent -> exactly one WhatsApp image+caption lifecycle;
- keep Gemini image generation absent;
- retire active Krea service/env/token/source plumbing only after Qwen candidate acceptance.

## Current live state — 2026-10-07

Amadeus **1.9.7** is deployed on the canonical CasaOS machine. OpenClaw runs
`local/openclaw-amadeus:git-4316946bd3fe-20261007125707`; 9Router remains the
sole `cx/gpt-image-2.5` primary. `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0` and
`AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0`; the route overlay returns the primary
failure without issuing a Qwen request. The operator-reported
`nine_router/arthur-combo` HTTP 408 was not re-probed with a live image request.

OpenClaw/Product Radar health, Gateway registration, NAS read-only smoke,
owner notification/outbox, and post-deploy maintenance passed. The optional
media-adapter smoke was skipped because that service is absent; managed log
policy reported a warning. The Qwen bridge and protected token plumbing were
not modified by this cutover. Rollback and verification evidence:
`.agent/checkpoints/2026-10-07-amadeus-1.9.7-gpt-only-image-release.md`.

The 1.9.6 GPT-to-Qwen WhatsApp acceptance is superseded by this request to keep
production GPT-only; the Fun-Acc Goal remains paused and is not deployed.

### Historical pre-Qwen baseline

The previous stable release was **Amadeus 1.9.5**. The earlier Krea2 candidate
exceeded its 600-second deadline and was paused; the old runtime was restored
before Qwen work began. The 2026-10-06 Phase 0 read-only audit found the live
image-task timeout at 120000 ms while the source example said 600000 ms. That
discrepancy was resolved using Qwen benchmark evidence: only the local image
fallback uses 600000 ms; ordinary Agent, text, caption, TTS, and ASR deadlines
were not changed. The old Krea candidate and rollback records remain historical:

The Krea candidate and rollback evidence remain historical:

```text
.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-candidate.md
.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-paused.md
```

## P0 acceptance boundary

A prompt-only local generation is not sufficient.

The Goal still requires a real WhatsApp **single-reference edit** where:

```text
GPT Image primary -> eligible operational failure
Qwen-Image-2.1 Uncensored local fallback -> /v1/images/edits
reference bytes preserved -> edited image returned
Asset Registry -> Completion Agent
exactly one WhatsApp image + natural Kurisu caption
```

Safety/policy refusals remain terminal and must not trigger the uncensored local fallback.

### Historical candidate and benchmark evidence

Two initial default-strength Phase 1 edits changed only the collar/outline, not
the jacket body. The same-checkpoint `strength=1.0` Test B recolored the full
jacket. Full-strength Test C shifted the jacket hue, but strength-0.9 C2 changed
the pot to teal and preserved the blue jacket/scene. Full-strength Test D had
broader color drift; strength-0.9 D2 changed `TEA` to `COFFEE` while preserving
the surrounding illustration. Side-by-side inspection plus approximate
out-of-edit-ROI pixel comparisons supports C2/D2 locality. Test A produced a
recognizable but notably pale fox image. Phase 1 reference-edit smoke tests
B/C/D pass; review text-to-image quality and proceed to Phase 2 only after
memory/swap headroom recovers. The local candidate server is loopback-only;
production and source runtime remain unchanged.

Phase 2 benchmark completed on 2026-10-07: cold edit 447.64 s, warm edits
310.93/338.26 s, warm text-to-image 253.28 s; peak sampled RSS ~13.4 GiB,
minimum free memory 11%, and swap peaked at 27,783.56/28,672 MiB before
recovering to 82% free after stopping the candidate. Implement strict serial
generation and bounded idle shutdown. The candidate-only image deadline is
600,000 ms (cold edit + 120 s margin, rounded up to the 600 s minimum); do not
change unrelated deadlines. The local candidate server is stopped. Production,
provider code, 9Router, and Krea state remain unchanged.

Asset revision, byte-size and SHA-256 pins were recorded on 2026-10-07.
The uncensored-model repository SHA256SUMS matches the local diffusion and VAE
hashes; the official Qwen3-VL repository pins the local encoder and mmproj
filenames and byte sizes. The external `sd-server` binary digest is also
recorded. At that pinning stage, no asset or runtime was changed.

On 2026-10-07, the new protected Qwen bridge was installed as a macOS
LaunchAgent with explicit `--apply`. It uses its own mode-0600 bearer token;
the Krea LaunchAgent remains absent. Complete asset/runtime hash validation,
host `/health`, authenticated and unauthorized OpenClaw-container -> bridge
`/v1/models` checks, and one real host bridge `/v1/images/edits` request passed.
The synthetic portrait reference produced one 768×768 PNG in 398.35 s: the pot
turned teal while the person, blue jacket and composition remained visually
recognizable. The artifact and input stay outside Git. This proves the bridge
path, **not** the provider fallback, Asset Registry or WhatsApp delivery.
The first real OpenClaw-container edit using Node's built-in `fetch` failed
after about 303 seconds (`fetch failed`). A retry with `undici.fetch`,
`undici.FormData`, and an `Agent` with 600000 ms headers/body timeouts
completed in about 409 seconds and returned a 537640-byte image. Built-in
`fetch` cannot use that Agent (`UND_ERR_INVALID_ARG`). The candidate
image-route source uses the successful client; container transport success
does not yet prove the OpenClaw route or WhatsApp delivery.
At that bridge-test stage, OpenClaw/9Router had not been switched and Amadeus
1.9.5 remained live. Service
idle shutdown was observed after about three minutes: the bridge remained
healthy with state `idle`, port 18795 closed, and system free memory recovered
to 81% (swap remained elevated near its pre-run level). The installed bridge
and engine config match the current source bytes. A protected OpenClaw
candidate checkpoint/switch was then performed as described below.
Evidence: `.agent/checkpoints/2026-10-07-amadeus-qwen-image-bridge-candidate.md`.

On 2026-10-07, the operator authorized `--apply`. Commit `e0a2217` was
built as an immutable OpenClaw image and switched on the canonical CasaOS
host with `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=1 --candidate --build-auto`. The
candidate sends image generation/edit requests directly to Qwen and does not
attempt GPT Image; this temporary test mode is not the final fallback route.
The protected pre-switch checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006185442`.
Post-switch OpenClaw/Product Radar health, Gateway registration, container
Qwen token permissions (0600), authenticated `/v1/models`, NAS read-only
smoke, and owner outbox smoke passed. 9Router remains on its previous
primary-only image. No real WhatsApp image request has yet been accepted.
Evidence: `.agent/checkpoints/2026-10-07-amadeus-qwen-image-local-only-candidate.md`.

Status: `PAUSED_BY_OPERATOR; PHASE_0_AUDITED; PHASE_1_TESTS_B_C_D_PASS; PHASE_2_BENCHMARK_COMPLETE; QWEN_BRIDGE_CANDIDATE_EDIT_PASS; AMADEUS_1.9.7_GPT_ONLY_DEPLOYED; QWEN_FALLBACK_DISABLED; KREA_ACTIVE_SOURCE_RETIRED; NOT_DEPLOYED_FUNACC`.

On 2026-10-07, commit `6b7623e` corrected the bridge's image-edit extra
argument from ignored `denoising_strength` to the pinned engine's `strength`.
The authorized local LaunchAgent restart is healthy and authenticated
OpenClaw-container model discovery returns HTTP 200. The effective requested
strength is now 0.9 instead of the engine default 0.75. The operator later
confirmed the corrected local pose edit appeared acceptable. This local-only
candidate result did not exercise the production GPT-primary fallback. Evidence:
`.agent/checkpoints/2026-10-07-qwen-image-edit-strength-restart.md`.

Formal Amadeus 1.9.6 deployment evidence:
`.agent/checkpoints/2026-10-07-amadeus-1.9.6-qwen-fallback-release.md`.


## Concurrent VPS subscription accounting Goal — 2026-10-08

See `docs/AMADEUS_VPS_SUBSCRIPTION_ACCOUNTING_GOAL.md`. Status:
`OPERATOR_CLOSED_WITH_ACCEPTED_RESIDUALS; OWNER_DIRECT_QUERY_REPORTED_NORMAL; SUBSCRIPTION_LINKS_24_OF_24_VERIFIED; LEGACY_TOKEN_PRESERVED; RECONCILIATION_UNCALIBRATED`.
The operator reported a normal direct owner query and requested that the
existing token be preserved. Both report Cron jobs remain enabled at 09:30 and
21:30 Asia/Shanghai; the 21:30 execution was still in the future at closure.
The provider/proxy relationship remains uncalibrated, no anomaly is claimed,
and the prior tool-output exposure remains documented. See the Goal and
`.agent/checkpoints/2026-10-08-vps-subscription-accounting-deployment.md` for
evidence. Subscription URLs are not stored in Git.
