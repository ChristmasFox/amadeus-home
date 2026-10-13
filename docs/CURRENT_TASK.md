# Current Task — PUBG KOOK SaaS V0.1 source implementation

Date: 2026-10-14 (Asia/Shanghai).

## Operator-selected source implementation Goal — 2026-10-13

The operator explicitly activated `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md` for this
worktree. Continue its phases while preserving the separate Image Lab/runtime
work recorded below; this activation does not authorize deploy, external
exposure, cloud provisioning, production credentials, private OpenClaw restart,
or 9Router administration.

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
Additive migrations through `0011` upgrade public schema/outbox rows, add
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
roster; roster changes invalidate scoped sync state.

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

M2 is active: worker cycle logs now expose aggregate queue age/state and
process RSS/heap without tenant IDs. The local synthetic 200-team simulation
passed. The KOOK sender now reserves daily quota in PostgreSQL across restarts;
the full SaaS/Postgres suite passes 86/86 with no skips, including concurrent
budget admission, outbox deferral and the integrated runtime. Independent
worker capacity, alert rules, quota/resource measurements,
backup/restore, clean-host recovery and private/public independence drills
remain. P3 real
test-server smoke now proves gateway authentication, one labeled outbox
delivery, and sequence-1 session resume. Full human-user flows (duplicate input,
cross-channel routing, management callbacks and unauthorized denial) and KOOK
eligibility remain unverified; the available guild has one text channel and no
test actor was available. P4's deidentified prompt benchmark also remains open.
No live provider accuracy, latency or capacity is claimed. P4 now has a
de-identified 100-case synthetic corpus across ten query families, an
owner-only external-file exporter, and a mock runner test; the real model
benchmark still awaits protected provider credentials. Query sessions still
derive from durable ingress, fresh KOOK membership and DB ownership, with
explicit DM grants and no fallback to the private team.
Current source map: `docs/PROJECT_MAP.md`.

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

The public-schema-only age backup/restore utility has 11 safety tests. A real
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
