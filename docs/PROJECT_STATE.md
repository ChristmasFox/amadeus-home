# Project State — 2026-10-15

## 2026-10-15 — Lab P1 `LIVE_VERIFIED`; formal release pending

The authorized Lab-only order has now completed source push, candidate build,
guarded deployment, controlled Dreaming, privacy review, and incremental
index/retrieval acceptance. Candidate version `1.10.5` remains healthy at
`sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`.
The Dreaming run succeeded at `2026-10-15T22:34:09+08:00`, wrote Light and REM
narratives, read one allowlisted owner workspace, and promoted zero candidates.
The existing daily job remains enabled at `03:00 Asia/Shanghai`; next run is
`2026-10-16T03:00:00+08:00`. No schedule change was made.

The before-read peer admission, owner-target allowlist match, Telegram fail
closed behavior, and group/channel exclusion passed. A sanitized scan of six
changed files found zero phone, ambiguous number, Owner phone, WhatsApp JID, or
group JID matches. The pre-index protected checkpoint at
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T144403Z-post-dreaming`
contains a SQLite online backup with `quick_check=ok` and a verified complete
Workspace copy. Incremental indexing moved from 3 files/70 chunks and
`dirty=true` to 5 files/92 chunks and `dirty=false`; FTS and semantic/hybrid
retrieval passed. P1 evidence validates as `LIVE_VERIFIED` for candidate source
`57e472ebe014a0b4d3574d7ef30107340dc99308`.

The formal release dry-run passed for tag `lab/v1.10.5`, promotion scope
`existing-live-openclaw-digest`, and no container switch. Formal release,
notification, and tag creation remain pending. Detailed sanitized evidence is
in `.agent/checkpoints/2026-10-15-lab-live-verified-dreaming-release-pending.md`.
The earlier stop below is retained as a historical checkpoint and is
superseded by this outcome.

## Earlier Lab candidate deployment — Dreaming preflight stopped at that checkpoint (superseded)

The reordered Lab-only sequence completed source push, candidate build, and
candidate deployment. Source `57e472ebe014a0b4d3574d7ef30107340dc99308` is at
`origin/main`. `BUILD_VERIFIED` is recorded for Lab OpenClaw 1.10.5,
`local/openclaw-amadeus:git-57e472ebe014-20261015140824`, digest
`sha256:4cb3c044925bb371b7232e47520b04d17633862549b9e315e555fbc9ce7aefd9`.
The build includes the before-read Dreaming peer-admission, backfill admission,
and no-corpus patches.

The candidate was applied only to Lab `openclaw` through
`scripts/deploy-openclaw.sh` via the guarded release wrapper. The protected
pre-switch checkpoint is
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261015141417`;
its online SQLite snapshot, sessions, and Workspace are present. Candidate
health and plugin registration passed. Post-deploy index status is 3/3 files,
70 chunks, `dirty=false`, hybrid mode, valid identity, FTS available, and a
complete 1024-dimension vector index. Keyword and semantic retrieval returned
positive scores; live before-read, Dreaming peer-admission, and backfill
admission markers were verified. Product Radar was untouched. The candidate
remains live and no rollback was needed.

The authorized controlled Dreaming run stopped before invocation because the
live `memory-core` config has no `dreaming` entry. The similarly named enabled
automation is an `agentTurn` limited to `memory_search`, not a Dreaming
executor; it was not run. No controlled Dreaming read or write occurred and
no transcript, phone number, or memory snippet was inspected or recorded.
P1 `LIVE_VERIFIED` is incomplete (including incremental refresh); formal
release and tag were not started. Gate, PostgreSQL, and M2 remain untouched.
Sanitized acceptance evidence is in
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261015141417/postdeploy-acceptance.json`;
checkpoint and rollback notes are in
`.agent/checkpoints/2026-10-15-lab-candidate-deployment-dreaming-stop.md`.

## 2026-10-15 — Earlier Lab Memory Core acceptance snapshot (superseded by candidate rollout above)

Arthur authorized the ordered Lab-only acceptance sequence for OrbStack
`nyannyan` / container `openclaw`. The configured 9Router Embedding endpoint
passed one synthetic probe (HTTP 200, 1024 finite dimensions). Before any
index write, a protected external checkpoint was created at
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T124516Z`. The
agent SQLite online backup passed `quick_check` and `integrity_check`; the
memory directory plus `MEMORY.md` archive passed content comparison and
checksum verification. The authorized force reindex completed; exact keyword
retrieval returned 3 results with positive FTS and vector scores, a paraphrase
returned a positive vector match, and current status is 3/3 files with
`dirty=false`, FTS available, hybrid mode, and vector dimension 1024. Modified-
file incremental refresh and restart persistence remain open. The authorized
controlled Dreaming run was stopped because the live image lacks the source
admission marker and function, and its sanitized policy allows both WhatsApp
and Telegram. A subsequent metadata-only cron-history query found that the
pre-existing scheduled job completed automatically on 2026-10-15 at 03:00
Asia/Shanghai (200245 ms, delivery not requested); a 2026-10-13 run had failed.
The job remains enabled and is next due 2026-10-16 at 03:00. Its source
isolation and exact read/write effects are unverified. No transcript, prompt,
summary, or memory text was read. Current metadata reports no session corpus,
ingestion state, audit entries, promotions, or `DREAMS.md`; these observations
do not prove what the scheduled run accessed. The cron was not changed. The
ordered procedure stopped here; candidate build, apply, and formal Lab release
were not started. Gate/M2 was not touched.
Reindex checkpoint evidence is in
`.agent/checkpoints/2026-10-15-lab-memory-reindex-prewrite.md`; the Dreaming
stop evidence is in
`.agent/checkpoints/2026-10-15-lab-dreaming-preflight-stop.md`.

## 2026-10-15 — PUBG SaaS Kurisu-aligned traffic and context

Commit `83c1bcc761842676ec750708a43f8d0f33e9d39a` is pushed to `origin/main`.
ARM64 image `local/pubg-saas:git-83c1bcc761842676ec750708a43f8d0f33e9d39a`
(image ID `sha256:e30b16c473b4f9c1ce183271fe43060001f367f9e052050b5f57ab5c52bd14d9`)
was built locally and deployed to `pubg-saas-m2-clean`. Migrations 0017–0020
are applied. Only Gateway and Worker were replaced; PostgreSQL
`e47fd49fcab53a8525be06a2a4eee1113a52ca83a332bffea85d9a2b09957d79`,
egress-proxy `c5cd33cba2197197a59a011dc4728ec7098e2cdacd3ba454ca67d099c11bb0aa`,
and SaaS 9Router `2ce5980081437b6a6e4b593ccb96ad2aff091c1be0790104cdd253d02ff8c631`
were unchanged. Gateway is running with zero restarts; Worker is healthy with
zero restarts. KOOK resumed at `last_sn=74` (`2026-10-15T04:20:45.338Z`); recent
Gateway/Worker error-record counts are zero. Protected mode-0600 rollback
records and steps are in
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-83c1bcc-pre-switch`
and `.../20261015-pubg-saas-83c1bcc-post-switch`.

The 200/day KOOK send quota, ingress per-user/channel/tenant/bot
requests-per-minute gates, and public-only conversation message/character/
12-hour expiry caps are removed. KOOK provider rate headers/429 behavior,
8,000-character per-message limit with ordered splitting, eight-player team
cap, server-side write authorization/redaction, 300-second Agent timeout, and
shared-key `/players` 10/minute gate remain. Conversation and query sessions
persist per channel/DM actor; each tool call revalidates current trusted
authorization. The public Worker uses the shared Domain match selection and
facts semantics; the former missing Oct 14 21:07 duo and 23:01 squad remain
restored. Full differences and their reasons are recorded in
`.agent/checkpoints/2026-10-15-pubg-saas-kurisu-alignment.md`.

Validation passed: SaaS PostgreSQL 150/150 and PUBG/Kurisu 71/71, zero skips;
typechecks, SaaS build, architecture checks, secrets scan, and diff check. The
isolated PG18 test container was reused. Arthur's KOOK acceptance remains
pending; M2 is not complete. No production, private Kurisu/OpenClaw, or
9Router configuration was changed.

## 2026-10-14 — PUBG SaaS public SOUL-sourced persona rollout

Commit `642f04eb5566f3b429373462a6ea75c3dd7c521b` is pushed and deployed on
OrbStack VM `pubg-saas-m2-clean` as ARM64 image
`local/pubg-saas:git-642f04eb5566f3b429373462a6ea75c3dd7c521b` (image ID
`sha256:ee197854e86f63d518b264fa054d9eca45bf524289a9936d059f9ae5099c60a1`).
Only Gateway and Worker were replaced. Gateway is running and Worker is
healthy; both have zero restarts. The read-only KOOK probe returned connected,
`last_sn=61`, updated within five minutes. PostgreSQL, egress-proxy, and SaaS
9Router container IDs were unchanged; no migration ran. Gateway and Worker had
zero error/fatal/uncaught/startup-failure log matches in the 10-minute window.
No manual model/PUBG call was made.

The public Agent's speaking-style source is the `说话方式` section of the
private workspace `SOUL.md`, mirrored as a verbatim public-safe excerpt in
`apps/pubg-saas/src/application/public-agent-soul.md`. The sole line naming
the private assistant was excluded. Memory, personal details, DMs, and private
nickname mappings were not read or copied; private runtime files were not
modified. Both main and recovery Agent prompts use this copy, and tests pin the
excerpt and enforce privacy exclusions.

Validation passed: SaaS/PostgreSQL 146/146 with no skips using isolated PG18,
PUBG/Kurisu 70/70, builds/typechecks, architecture, secrets, and diff checks.
The mode-0600 pre-switch rollback record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-642f04e-pre-switch.txt`.
Full results and rollback steps are in
`.agent/checkpoints/2026-10-14-pubg-saas-public-soul-rollout.md`.

Arthur's live KOOK acceptance is pending; M2 is not complete.

## 2026-10-14 — PUBG SaaS public Agent rich battle reports

Commit `adeb839f5bfec07134a11259608edaa7e9171096` is pushed to `origin/main`
and deployed on OrbStack VM `pubg-saas-m2-clean` as ARM64 image
`local/pubg-saas:git-adeb839f5bfec07134a11259608edaa7e9171096` (image ID
`sha256:206a98e2f0cf9540c34a0dd1ccd4e94c646569026d3bddd6f1b84eb0be6489ba`).
Only Gateway and Worker were recreated. Worker is healthy, Gateway is running,
both have zero restarts, and the read-only KOOK probe reports connected with
`last_sn=61`. PostgreSQL, egress-proxy, and SaaS 9Router were unchanged. No
migration or manual model/PUBG query was run. The protected pre-switch rollback
record is `/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-adeb839-pre-switch.txt`.

The effective game-day boundary is 06:00 in `Asia/Shanghai`, shared by Kurisu,
the Domain, and the PUBG Skill; the prior 05:00 reply text was inconsistent.
The reported 5-versus-7 match totals cannot be adjudicated without comparing
the separate SQLite/PostgreSQL cache contents and coverage, so no count was
assumed or synthesized. The public Agent now receives bounded Domain facts:
damage source and direction breakdowns, up to 10 safe match summaries, and
approved stats for up to 8 roster players. Internal IDs, telemetry evidence,
and debug fields are excluded. Per-step output budget is 1,600 tokens; overall
timeout remains 300 seconds. The public persona uses generic style traits only;
private memory, personal details, DMs, private nickname mappings, and private
runtime files were not used or changed.

Validation passed: `pnpm test:pubg-saas` 144/144 using the isolated PostgreSQL
test database; `pnpm test:pubg` 70/70; PUBG/SaaS typecheck and builds;
architecture, secrets, and diff checks. Gateway and Worker had no error,
fatal, uncaught-exception, or startup-failure log matches in the inspected
10-minute window. Detailed evidence and rollback steps are in
`.agent/checkpoints/2026-10-14-pubg-saas-rich-agent-reports-rollout.md`.

Arthur's live KOOK acceptance remains pending; M2 is not complete.

## 2026-10-14 — PUBG SaaS KOOK reply cleanup rollout

Commit `ef81896` is pushed to `origin/main` and deployed on OrbStack VM
`pubg-saas-m2-clean` as immutable ARM64 image
`local/pubg-saas:git-ef81896a1c85a22afaf8c533e0d95929b425962f`
(`sha256:fe49c38fb9183882b68058b8b4d0fab90b0f6f111c317b682c03bffee9d9018f`).
Only Gateway and Worker were recreated. Worker is healthy and both have zero
restarts. The read-only KOOK session probe returned `connected=true`,
`last_sn=59`, updated at `2026-10-14T14:13:30.421144Z`. Gateway and Worker
had zero error-level log matches; Worker cycle records had no queue errors,
team failures or alerts. PostgreSQL (`e47fd49fcab5`), egress-proxy
(`c5cd33cba219`) and SaaS 9Router (`2ce598008143`) were unchanged. No migration,
model request, PUBG API request, or private runtime change was made.

The assistant context previously prefixed replies with `[回复成员N]`, which
the model could echo. Speaker formatting is now plain text, instructions forbid
repeating internal context labels, conversation history is cleaned before
reuse, and outbound messages are sanitized before outbox persistence and at
the final KOOK HTTP boundary. Successful `message_outbox` rows use `{}` as a
privacy scrub; the sanitized transcript remains linked to its source event
and KOOK remote message ID for the existing 12-hour retention period.

Validation passed: SaaS/PostgreSQL 141/141 on isolated PG18; `pnpm test:pubg`
70/70; focused ingress/outbox and sender regressions 10/10; PUBG/SaaS
typecheck/build, architecture checks, secrets and diff checks. The protected
pre-switch rollback record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-ef81896-pre-switch.txt`
(mode 0600). Detailed evidence and rollback steps:
`.agent/checkpoints/2026-10-14-pubg-saas-reply-cleanup-rollout.md`.

Arthur's live KOOK retest remains pending; M2 is not complete.

## 2026-10-14 — PUBG SaaS friendly-damage filter correction

Commit `3c51d4b` is pushed to `origin/main` and deployed on OrbStack VM
`pubg-saas-m2-clean` as immutable ARM64 image
`local/pubg-saas:git-3c51d4b6c0b55a15ba4ec39bd391d28aac21f98d`
(`sha256:56d3d9fb493e17ac0832d62c159544d232a7bfdfe892b56e18fe1231a10963da`).
Only Gateway and Worker were replaced; the Worker is healthy, both have zero
restarts, and the read-only KOOK session query reports `connected=true`,
`last_sn=53` at `2026-10-14T12:49:54.194Z`. Gateway and Worker had zero startup
error-log matches. PostgreSQL (`e47fd49fcab5`), egress-proxy (`c5cd33cba219`)
and SaaS 9Router (`2ce598008143`) were unchanged. The protected rollback record
is `/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-3c51d4b-pre-switch.txt`.

General friendly-damage wording now clears model-generated `OTHER`; KICK and
PUNCH require explicit current wording, with only verified filters carried by
an explicit follow-up. The query result exposes Domain-applied filters and the
Agent must not replace prior real numbers without a fresh query. Validation:
SaaS/PostgreSQL 139/139; `pnpm test:pubg` 70/70; PUBG/SaaS typecheck and build,
architecture, secrets and diff checks passed. No migration, real model call or
PUBG API call was performed. Arthur's live KOOK friendly-damage test remains
pending; M2 remains open.

Detailed deployment and rollback evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-friendly-damage-rollout.md`.

## 2026-10-14 — PUBG SaaS shared Domain and presentation rollout

Commit `ac628dd` is deployed on OrbStack VM `pubg-saas-m2-clean` as immutable
ARM64 image
`local/pubg-saas:git-ac628dde9ad46d824603d387446f9e1a95eeaa28`
(`sha256:7d05776e3b9232b2ac67653378ad4e66015ba62c3ccc67b00b9383ff61f46293`).
Only Gateway and Worker were recreated with Compose `--no-deps`; no image was
pushed and no migration was run. Worker is healthy, both new containers have
zero restarts, the KOOK session probe returned `connected=true` at
`2026-10-14T11:44:08.669Z`, and the post-startup error-level log match count
was zero for both. PostgreSQL, egress-proxy and SaaS 9Router IDs did not change.

The mode-0600 pre-switch rollback record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-ac628dd-pre-switch.txt`;
full result and rollback steps are in
`.agent/checkpoints/2026-10-14-pubg-saas-ac628dd-deployment.md`. No human
message, model request or PUBG API call was made. Arthur's real KOOK acceptance
is pending; M2 is not complete.

## 2026-10-14 — Agent tool-loop recovery and eight-player roster rollout

Commit `d936f79` was fast-forward pushed to `origin/main`. It raises the public
Agent overall deadline to 300 seconds, uses a 120-second step timeout and a
128-step runaway guard, summarizes completed tool results after timeout/guard
recovery, reuses identical query output, and queries the full eight-player
roster at once. PostgreSQL-backed binding and authorization enforce the eight
member cap while allowing an existing member to replace their own account.
SaaS tests passed 133/133 on the reused isolated PG18 service; focused
integration passed 28/28; PUBG/Kurisu passed 68/68; package typecheck/build,
architecture and secret checks passed.

Buildx verified both amd64 and arm64. An encrypted backup restored to a fresh
isolated PostgreSQL 18.1 instance with 39/39 table counts and app/backup table
and sequence permission boundaries verified. The disposable restored database
was removed by its exact marker; isolated volumes were retained.

Only Gateway/Worker were replaced on authorized `pubg-saas-m2-clean` with
`local/pubg-saas:git-d936f79`. Both are running; Worker is healthy and the
read-only KOOK session probe is connected. The database was already at
migration `0016`; PostgreSQL, egress-proxy and SaaS 9Router container IDs did
not change. The protected rollback record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-d936f79-pre-switch.txt`.

The post-deployment real `昨日小队战绩` model/tool/outbox verification is still
pending a trusted human group event. Arthur was asked to send that query; no
bot-authored or synthetic production event will be used. M2 remains open.
Detailed evidence: `.agent/checkpoints/2026-10-14-pubg-saas-agent-loop-recovery-rollout.md`.

## 2026-10-14 — Public conversational Agent M204 rollout

Source commits `1e74e5a` and `f5c40e2` route every trusted human KOOK message
through the Vercel AI SDK `ToolLoopAgent`, preserve the existing authorized
Domain executor, and fix Compose PostgreSQL snapshot stdin forwarding. Focused
source validation passed: SaaS/PostgreSQL 126/126, private Kurisu regression
68/68, SaaS typecheck/build, 24 backup/Compose adapter tests, architecture and
secret checks. Local Buildx verified `linux/amd64` and `linux/arm64`; no image
was pushed.

After the separately authorized M204 rollout, `pubg-saas-public` Gateway and
Worker run `local/pubg-saas:git-f5c40e2`. PostgreSQL is at migration `0016`.
Gateway is running with zero restarts and persisted KOOK session state at
`last_sn=29`; Worker and PostgreSQL are healthy. Existing PostgreSQL,
egress-proxy, and independent 9Router container IDs were unchanged. A protected
encrypted pre-migration snapshot was verified before migration. An isolated
synthetic recovery restored 39/39 public tables and passed app/backup database
permission probes. The current local daily budget row is 15/200; developer
eligibility and the attribution of existing usage remain unverified.

No live group message, model call, or PUBG API request was initiated as a
deployment smoke. A stored WS session is not proof of an end-to-end reply, and
the session sequence had not advanced within the last two minutes at the final
read-only check. Arthur will perform real KOOK acceptance. M2 remains open.
Rollback uses the protected pre-deploy image setting and encrypted snapshot;
from the live Compose directory, restore that setting and run
`docker compose up -d --no-deps --wait gateway worker`. Full evidence and
reproduction are in `.agent/checkpoints/2026-10-14-pubg-saas-agent-runtime-rollout.md`.

## 2026-10-14 — Public conversational Agent source correction (pre-rollout)

The active source removes `KookGroupWriteIntentParser` from the ordinary
message path and runs every trusted human group message through a bounded
Vercel AI SDK `ToolLoopAgent`. The model can answer directly, or call several
tools in one turn. Existing `QueryPlanSchema`, authorization services and the
shared PUBG Domain executor remain in use; each tool call revalidates the live
ingress lease, actor, tenant/team binding, roster and channel membership.
Follow-up query state remains scoped to the current actor. A new
`meleeKind=KICK|PUNCH|OTHER` query slot reaches the existing Domain telemetry
filter.

Migration `0015` adds channel/actor-scoped recent conversation storage with
speaker and reply links (12-hour retention), plus minimal Agent run status.
Migration `0016` records authorization denials distinctly. KOOK mention IDs
are replaced with `@成员` before model input, history persistence, and
model-facing write-tool results; write authorization continues to use only the
trusted mention metadata inside the server. Provider errors, Domain tool
errors, authorization denials, and KOOK outbox quota/send failures have
separate status and safe diagnostics. Daily budget exhaustion keeps its
durable deferred outbox row.

Validation passed: SaaS/PostgreSQL 126/126, private PUBG/Kurisu regression
68/68, SaaS typecheck, and SaaS package build. Tests cover unbound ordinary
chat replies, direct and multi-step Agent behavior, quote/history handling,
speaker separation, tool/domain data, kick filtering, authorization denial,
provider/tool fallbacks, mention-ID redaction and outbox daily-budget logging.
At this checkpoint, no load/scale benchmark, Docker image build, deployment,
or live KOOK request had been run. The subsequent rollout is recorded above;
Arthur's real KOOK test-server experience is still required. M2 is not
complete. Source evidence and reproduction:
`.agent/checkpoints/2026-10-14-pubg-saas-agent-architecture.md`.

## 2026-10-14 — Group-only account binding deployed to isolated SaaS

Planner streaming incompatibility was fixed in commit `53b49e5` by sending
`stream:false`; one real Planner request succeeded against the isolated
9Router. Commit `8bcbe4c` adds one automatically provisioned KOOK-guild team,
group-only self-binding, Steam-default `/pubg me`, natural-language account
and team-name intents, real PUBG resolution before persistence, and
admin-only `@member` delegation with current KOOK permission checks. The
intent model cannot choose recipient IDs; only two bounded write actions are
accepted. Existing tenant/team scoping and legacy management handlers remain.

Validation passed: SaaS/PostgreSQL 117/117, private Kurisu 68/68, relevant
typechecks, architecture check, secrets scan and diff check. Local OCI build
verified amd64+arm64 (manifest
`sha256:72000a4c40ab4bdedf4a82d37a609cba62f3e218d7fed49d88e761f1d4741f6d`).
On `pubg-saas-m2-clean`, only Gateway and Worker were recreated as
`local/pubg-saas:git-8bcbe4c4812a72a9c4841a8d4df7b62eda0f3bfb`. Worker is
healthy; Gateway is running and its persisted KOOK WebSocket state is
connected. PostgreSQL, egress-proxy and 9Router kept their prior container
IDs. No PUBG lookup or user-message acceptance was performed; Arthur's manual
KOOK acceptance remains next. Backup rehearsal remains paused. No private
OpenClaw/9Router change, image push or production deployment occurred. See
`.agent/checkpoints/2026-10-14-pubg-saas-group-binding-live.md`.

## 2026-10-14 — Isolated public SaaS model connection attempt

Source commit `87de87d` limits cleartext HTTP and direct model egress to exact
authorities in `MODEL_ALLOWED_INTERNAL_HOSTS`; other private addresses remain
subject to the guarded egress proxy. Its 7 focused model-config/routing tests,
SaaS typecheck, secret scan and diff check passed. M204 OrbStack built local
ARM64 image `local/pubg-saas:git-87de87d06a4ed3c9b8df4dab26a2d1c3947efabe`
(image ID `sha256:b4ac246a14797e058a82a7d4c4cf035880035b86735b369793e718684a51aa33`);
the image was not pushed.

On `pubg-saas-m2-clean`, the ignored stack `secrets/gateway.env` was updated
from the isolated 9Router `apiKeys` table and remains mode 0600. It contains
the model endpoint, model ID and API key; no secret values are retained here.
Only Gateway and Worker were passed to the Compose recreate command, but Compose
also recreated `egress-proxy` because it shares the changed image tag. The PG
container stayed unchanged and healthy; Worker is healthy; Gateway and the new
9Router are running (neither has a configured Docker healthcheck).

The post-restart KOOK state row has a session and an `updated_at` later than the
new Gateway start time. Exactly one minimal planner request was issued. 9Router
recorded an upstream `ok`, while the SaaS planner returned fallback
`provider_error` with `requestCount=1`. No retry was made. Model acceptance is
not complete; response/structured-output compatibility is a hypothesis pending
Arthur's next instruction. No private OpenClaw or private 9Router action was
taken. Full evidence: `.agent/checkpoints/2026-10-14-pubg-saas-9router-integration.md`.

## 2026-10-14 — M204 live KOOK P3 Gateway started

Isolated Compose project `pubg-saas-p3-live-058118d` now runs on M204 from
app commit `058118d`, local ARM64 image
`local/pubg-saas:git-058118d` (manifest
`sha256:fd1825f35b0c953b3e98e1b9f82397e0b3c992d18aa4e0f9237ebc79ae7af017`).
Its fresh PG18.1 volume has all 14 migrations. PostgreSQL, Gateway, Worker and
the egress proxy are running; Worker and PostgreSQL health checks pass. A
boolean-only DB probe confirms the Gateway's KOOK WebSocket session handshake.
Gateway has only the two test-bot credentials from the protected, ignored
`.env.local`; it has no PUBG or model credential. Four fixed synthetic Steam
players are enabled solely for this isolated acceptance; production refuses
that mode. Worker has no outbound network and uses only its internal PG network.
Arthur's ordered live commands cover synthetic create, one-use callback/repeat,
second-channel bind, admin mutation and unauthorized denial. Those human steps
remain pending, so this records startup readiness, not completed P3 acceptance.
The project is intentionally left running. No image push, deployment, 9Router
change, private OpenClaw restart or private data access occurred. Evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-p3-live-gateway.md`.

## 2026-10-14 — Current-source M204 SaaS Compose and encrypted recovery

App commit `7249b12` built locally on host-profile OrbStack `nyannyan` as
ARM64 image `local/pubg-saas:git-7249b12` (manifest
`sha256:2c17198eb271c4a103585830dc2944abe8dbbeff8d25ab22a733ea4ac9c8faee`).
Fresh isolated source and restore PG18.1 projects applied 14 migrations and
matched all 37/37 public-table counts; synthetic tenant/team/job counts were
1/1/1. App/backup DML, DDL and sequence boundaries passed on both databases.
The restored Worker was healthy with one delayed job, zero due work/attempts,
and no inbox/outbox events. Both projects were stopped with plain `down`,
preserving their isolated volumes. Kurisu tests passed 68/68 afterward; private
OpenClaw and 9Router IDs/start times remained unchanged with restart count 0.
No real PUBG/model credential, image push, deployment, 9Router edit or private
OpenClaw restart occurred. The guest lacked `age` and OrbStack did not stream
the long-lived snapshot session through the one-shot adapter; the tested
workaround was a temporary PG18.1+age helper confined to each internal PG
network. Detailed evidence and commands:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-current-7249b12-local-recovery.md`.

## 2026-10-14 — M204 Worker metrics relay host-loopback acceptance

Commit `7f3b95b` built on OrbStack machine `nyannyan` as local ARM64 image
`local/pubg-saas:git-7f3b95b` (image ID
`sha256:e52c734edc432eb5f9d84af9aa2c8086467f38146ec9dade75e26fe6b4c00d47`).
The isolated Compose project initialized a fresh PG18.1 volume, applied current
migrations and started a healthy Worker on an empty queue. Host-loopback
`GET /metrics` returned 200 with `pubg_saas_worker_up 1`; a query-string path
returned 404 and POST returned 405. Docker inspection confirmed that only
`egress-proxy` published the loopback relay port; Worker had no host port and
only joined `postgres_private` and `egress_internal`.

The project was stopped with ordinary `docker compose down`, retaining its
isolated volume. OpenClaw and 9Router IDs, start times, running states and
restart counts were identical before and after (both counts 0). Focused
relay/Worker tests passed 14/14, and the full SaaS/PostgreSQL suite passed
106/106 with no skips on the reused loopback-only PG18.6 fixture. Current
SaaS/private typechecks passed, the private PUBG regression passed 68/68, and
architecture, secret and diff checks passed. The Gateway was not started; no
PUBG/model request or real credential was used. The full encrypted
backup/restore and role-boundary drill is documented in the prior current-image
checkpoint; this change only adds the
fixed-path metrics relay and Compose port mapping. No image was pushed and no
production or private runtime was changed. Reproduction:
`.agent/checkpoints/2026-10-14-pubg-saas-metrics-relay-host-acceptance.md`.
The same source commit also built as local OCI for `linux/amd64` and
`linux/arm64`; the verifier accepted both under manifest-list digest
`sha256:7cfc5d19b320b431f2da8b93afc4f1b6b6fd22f63bf884c139945d32d4da2d68`.
The archive was removed and not pushed. This is multiarch build evidence, not
an amd64 Linux Compose runtime test; full evidence is in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-current-ci-gates.md`.
The amd64 image then passed a Compose smoke under emulation on the M204 ARM64
machine: PG and Worker health checks passed, Worker `process.arch` was `x64`,
and host metrics returned 200. The isolated volume was reused and retained;
private OpenClaw/9Router remained running and unchanged. This does not replace
a native x86_64 Linux runtime test.

The current native ARM64 image also passed a full fresh-PG recovery repeat in
two new M204 Compose projects. All 14 migrations applied; Worker/egress health
and the loopback metrics relay passed. An age-encrypted backup restored into a
separate fresh PG18.1 container with 37/37 public-table counts, 14 migrations
and synthetic tenant/team/job rows of 1/1/1. App/backup role probes passed
before and after restore, including future-sequence grants. After guarded
target cleanup and ordinary `down`, Kurisu passed 68/68 and private
OpenClaw/9Router IDs, start times and restart counts remained unchanged. No
Gateway, PUBG/model call, image push or deploy occurred. Evidence and
reproduction: `.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

The same current ARM64 image was copied locally into the isolated Linux VM
with `docker save/load`; all eight rootfs layers and runtime configuration
matched. Its fresh PG18.1 Compose project applied 14 migrations, reached healthy
Worker/egress state, and exposed the metrics relay with GET 200. The credential-
free Worker-network smoke confirmed direct public/metadata TCP was unreachable,
private-host/metadata proxy CONNECTs returned 403, and public HTTPS through the
proxy returned 200. Plain `down` retained the PG volume. This VM shares M204's
physical OrbStack host, so this does not prove cloud or physical-host-outage
independence. Evidence: `.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

The M204-generated current age artifact also restored on the separate Linux VM
into a fresh PG18.1 project: verification, 37/37 public-table counts, 1/1/1
tenant/team/job rows and app/backup role boundaries passed. The current Worker
started healthy against that restored DB with one delayed job and zero
attempts/due work; metrics reported up=1. The marked target was cleaned and
the project stopped with plain `down`. This VM shares M204's physical OrbStack
host, so this is local portability evidence, not cloud or host-outage proof.
Details: `.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

The isolated 200-team benchmark now accepts up to 50 synthetic query tasks per
team. A 30-per-team replay completed 6,000 authorized tasks across 200 teams
and 800 users on the reusable local PG18.6 fixture: 132,000 SQL statements,
zero scope/task failures, 219.88 tasks/s, and 200/200 Worker team runs. Pool
peak was 16/20 without waiters; benchmark RSS peaked at 257 MiB. This was a
burst replay on the local fixture; M204 service-container headroom, paced daily
load, live provider throughput and SLO remain unverified. Evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-6000-query-benchmark.md`.

The 6,000-task replay was repeated on M204 through an isolated PG18.1 Compose
fixture with explicit 1 CPU/1 GiB PG limits and a 1 CPU/512 MiB runner cap. It
completed in 47.609 s at 126.03 tasks/s, with 0 failures, 200/200 Worker team
runs, 16/20 peak pool connections and no waiters; runner RSS peaked at 115 MiB.
Its disposable schema count returned to zero, and plain `down` preserved the
test volume. OpenClaw/9Router IDs, start times and restart counts were unchanged.
This does not measure the live Compose Gateway/Worker containers or a production
SLO. Full run details are in the checkpoint above.

## 2026-10-14 — Current-source SaaS CI and multiarch build gates

At current source commit `20b06da` (documentation-only `5409671` follows), the
full public SaaS/PostgreSQL suite passed 104/104 with no skips on the existing
loopback-only isolated `pubg-saas-pg18` test container (PostgreSQL 18.6,
`pubg_test`). The database container remained running and was reused. The
architecture check passed, as did all 23 backup/Compose-adapter safety tests.
Buildx generated a local OCI image for both `linux/amd64` and `linux/arm64`,
and `scripts/verify-pubg-saas-oci.py` accepted both platform manifests. The OCI
file was removed after verification; there was no image push. This does not
close real provider, human KOOK, persistent scheduling, host metrics scraping
or final release-review gates. Evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-current-ci-gates.md`.
The later relay commit `7f3b95b` passed the updated full suite 106/106 and
verified M204 host metrics scraping; see the current entry above.

## 2026-10-14 — Current-source M204 SaaS image and recovery acceptance

Commit `20b06da` built natively on OrbStack ARM64 machine `nyannyan` as
`local/pubg-saas:git-20b06da` (`sha256:492a72e07d7fcd7bc169b2bc8e0f8ac409d050f6843c93b69d77277a2e181f17`).
Two uniquely named isolated Compose projects used separate fresh PG18.1
containers and volumes. Source migrations through `0014` passed, the Worker was
healthy on an empty queue, and the Gateway ran only in dry-run mode. The Worker
metrics endpoint returned 200 inside its container. Its Compose host-loopback
binding returned 502 when requested from the OrbStack machine; host scraping
there remains unverified and no egress boundary was weakened.

The source database contained one synthetic tenant, team and delayed job plus
a migrator-owned sequence. Age backup/verification and fresh-container restore
passed with SHA-256
`76fbe72fac3bb4e66ec96f611dc7fe471703e2ee3cfad6b1623351b718b4663a`;
37/37 public-table counts, all 14 migration rows and fixture counts 1/1/1
matched. App rollback DML, DDL denial, backup table/sequence SELECT, backup
DML/`nextval` denial, app sequence usage, and restored default sequence grants
passed on source and restored PG. The disposable restore DB was removed through
its guarded cleanup command.

Both temporary projects were stopped with plain `down`, retaining their
isolated volumes. Kurisu regression passed 68/68; private OpenClaw and 9Router
IDs/start times were unchanged with restart counts 0. No real PUBG/model
credential, production database, image push/deployment, 9Router setting or
private OpenClaw runtime was touched. Exact steps and limitations:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-current-image-local-recovery.md`.

## 2026-10-14 — Canonical M204 local SaaS Compose and recovery rehearsal

The current host profile resolves to OrbStack machine `nyannyan`; earlier
notes that `example-node` was absent mistook the profile's machine alias. On
`nyannyan`, current commit `87543bc` built local ARM64 image
`local/pubg-saas:git-87543bc` (`sha256:75c6984f8256c782062fa6ae786c5cdd33028f30df445b27b930040d9f50d4c2`).
Isolated PG18.1 Compose applied migrations through `0014`; the Worker reached
healthy on an empty queue with zero teams attempted and zero provider calls.
No Gateway live session or provider credential was used.

The source DB held only synthetic test rows: one tenant, team and delayed sync
job, plus a migrator-owned sequence. Encrypted age backup/verification and
restore to a separate fresh PG18.1 container passed. The artifact SHA-256 was
`86b3f57bd632a0da6a01f83c872f39d9acaaadeed32379c31f3d9198907b50b9`;
37/37 public-table row counts, all 14 migrations and fixture counts 1/1/1
matched. Source and restored databases passed app DML-with-rollback, app DDL
denial, backup table/sequence reads, backup DML and `nextval` denial, app
sequence use, and restored default sequence grants.

Both test projects were stopped with ordinary `docker compose down`, retaining
their volumes. With the SaaS test containers stopped, `pnpm test:pubg` passed
68/68. Private OpenClaw remained healthy and 9Router remained running; IDs and
start times did not change and restart counts remained 0. The only attempted
backup failure was the Mac-side `orb` streaming adapter: its kept-open `psql`
snapshot output was buffered and timed out. A minimal reproduction confirmed
ordinary one-shot queries work; running the unchanged backup utility and PG18
tools in a temporary resource-limited container on the isolated DB networks
passed. No source test, security assertion or database safety guard was
weakened. No image push, deployment, production DB, 9Router change or private
OpenClaw restart occurred. Detailed commands:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

## 2026-10-14 — M204 bounded synthetic 200-team measurement

The existing M2 benchmark ran against a fresh internal-only PG18.1 test
container on host-profile machine `nyannyan`. It used a 1 GiB/1 CPU PostgreSQL
cap and a 512 MiB/1 CPU benchmark runner sharing only the database's internal
network namespace. Fixture: 200 tenants/teams, 800 users and roster accounts,
400 matches and 1,600 match-player rows, all under a temporary schema that the
benchmark removed. No live PUBG, KOOK or model requests occurred.

With concurrency 8, all 200 authorized query tasks and all 200 worker team
reads passed with 0 failures. Query phase: 32.42 s, P95/P99 86.95/207.99 ms.
Worker read phase: 522 ms, P95/P99 2.09/21.78 ms. The 20-connection pool
peaked at 16 active, 0 waiting. Node process RSS peaked at 93,360,128 bytes;
sampled cgroup usage peaked at 114.5 MiB for the runner and 80.08 MiB for PG.
The PG reached its configured 1 CPU cap during query work. Host MemAvailable
was 6.63 GiB at baseline, at least 6.54 GiB during samples, and 6.66 GiB after.
This closes the missing M204 synthetic host measurement but does not establish
production capacity, continuous load, API-rate compliance or alert SLOs. The
test project was stopped without deleting its named volume. Private OpenClaw
and 9Router remained at the same IDs/start times, restart count 0. Full
evidence is in the M2 rehearsal checkpoint.

## 2026-10-14 — Separate-host SaaS restore and Worker startup

Transferred `local/pubg-saas:git-87543bc` locally from M204 to the isolated
Ubuntu 24.04 ARM64 VM without a registry. A new Compose project and PG volume
restored an age-encrypted synthetic snapshot: 37/37 table counts, 14
migrations, tenant/team/job 1/1/1, and app/backup permission probes passed.
The current Worker, PostgreSQL and egress proxy became healthy on the restored
database. Its only sync job was delayed, so the Worker attempted zero teams
and made no PUBG request. The proxy returned 403 for the M204 private target;
the Gateway was not started. This is separate-host restore/Worker startup
evidence, not full cloud independence, live API/model behavior or RPO/RTO
measurement. The test Compose project was stopped without deleting its volume.

## 2026-10-14 — Current-image KOOK test-bot authentication on restored VM

The operator-authorized KOOK test credential was streamed into an owner-only
env file on the isolated Linux VM, used by the current Gateway, then removed;
the file was reset to placeholders. Gateway session state was persisted in the
separately restored PG. Gateway and Worker ran together, Worker was healthy,
and SQL probes showed no ingress event, outbox row, or due sync job. No KOOK
message was sent and no PUBG/model request occurred. The Gateway/Worker/PG/proxy
containers were stopped without deleting the PG volume. This proves current
image test-bot authentication with an independently restored database, but
leaves human-user flows and real provider behavior unverified.

## 2026-10-14 — KOOK and PUBG quota source audit

The official KOOK message reference describes a 10,000-message daily
developer-account aggregate across bots, resetting at 12:00 Asia/Shanghai. Its
developer policy additionally lists 200 messages/day per bot, one bot and one
self-created server for unverified accounts; verified accounts are listed at
up to 10,000 servers and 240 API calls/minute. The local 200-send bot budget
is conservative, but the SaaS cannot observe messages sent by sibling bots.
Live developer verification and account-share allocation remain unverified.

PUBG's official FAQ describes 10 requests/minute as a testing/development
default, with a higher limit requested for launch. The synthetic worker and
200-team test did not contact PUBG, so neither live API headers nor launch-key
rate compliance has been established. Official sources and operational notes
are in `infra/pubg-saas/README.md`.

At the optional 200-team × 30-query/day workload, one bot response per query
means up to 6,000 reserved sends/day before management traffic. This exceeds
the current 200-send default and unverified bot allowance. A verified account
would need to allocate this bot a safe share of the published 10,000/day
developer-account total; other bots and events reduce the available share.
The reservation logic does not assume KOOK's first-reply discount.

## 2026-10-14 — Synthetic SaaS RPO/RTO restore timing

In the isolated Ubuntu 24.04 ARM64 VM, an encrypted 37-table synthetic PG18.1
backup completed in 641 ms and verified in 135 ms. The backup manifest now
records `snapshotRequestedAtUtc` before PostgreSQL snapshot export; the
measured upper-bound snapshot age at simulated failure was 0.624 s. Restore and
all 37/37 table counts took 1.558 s; the restored Worker reached healthy 14.619
s after simulated failure. It discovered one delayed synthetic job and made
zero provider attempts. App rollback DML, app DDL denial, backup sequence read
and backup `nextval` denial passed. This is a small-fixture recovery sample,
not a production SLO or proof of the uninstalled six-hour timer. The disposable
database was removed with exact-marker cleanup and both test Compose projects
were stopped without deleting their volumes. Details:
`.agent/checkpoints/2026-10-14-pubg-saas-rpo-rto-rehearsal.md`.

## 2026-10-14 — Isolated six-hour backup timer auto-trigger

Temporarily enabled a test-only systemd timer in the isolated Linux VM with
the repository's six-hour UTC calendar. It automatically fired at 00:00:01
UTC; the oneshot exited 0 in about one second, encrypted the synthetic
37-table PostgreSQL backup, and completed seven-day prune with zero pairs
removed. The artifact is mode 0600 with SHA-256
`c015ed1d7111222e044c6e2ae36a6c3b7f4aa49a7fc91d2d846757544d9af488`. The
test service ran as root only to use the local Compose-PG adapter. Timer,
service and env file were removed after the run, and the source PG project was
stopped without deleting its volume. No M204 or production timer was installed.
Full evidence: `.agent/checkpoints/2026-10-14-pubg-saas-rpo-rto-rehearsal.md`.

## 2026-10-14 — Isolated Linux SaaS image and recovery drill

Built the current tree locally in OrbStack as
`local/pubg-saas:git-516371e6e73f`, ARM64 manifest
`sha256:2590b6d7f0fea5783620ed20ed3bbe4212fba0c49ac29aa9945a2fbd338b758e`.
The image was copied locally (no registry) into a fresh network-isolated
Ubuntu 24.04 ARM64 VM, where fresh source and restore Compose projects used
separate PG18.1 containers/volumes and applied migrations through `0014`.
Age backup verification and restore matched 37/37 public base-table counts and
14 migration rows; synthetic tenant/team/job rows matched 1/1/1. App DML with
rollback, app DDL denial, backup read-only/no-`nextval`, and app future-sequence
use passed on both databases. The exact-marker disposable restore database was
cleaned; Compose projects were stopped with plain `down`, preserving isolated
volumes.

The checked-in `scripts/tests/pubg-saas-egress-smoke.mjs` also passed inside both
Gateway and Worker Compose network namespaces on this clean Linux guest: no
default route, direct public/metadata TCP denied, proxy CONNECT to metadata and
`host.docker.internal` returned 403, and credential-free public HTTPS via proxy
returned 200. The proxy-only project was stopped after the smoke.

The six-hour UTC systemd timer and service template passed `systemd-analyze`
calendar/unit checks using temporary validation copies, without installation.
The backup job was initially not executable (`100644`) despite being used as
`ExecStart`; the repository mode is now `100755`. Its actual run against the
synthetic isolated PG created and verified an encrypted 37-table backup, ran
retention, and a separate stale-fixture prune removed exactly one expired pair
while preserving recent artifacts. The timer remains uninstalled pending an
authorized host apply.

With public Compose down, `pnpm test:pubg` passed 68/68. Read-only checks show
private OpenClaw healthy with restart count 0 and unchanged container ID/start
time; 9Router also kept the same ID/start time and restart count 0. Neither was
modified or restarted. No real KOOK/PUBG/model credentials, image push,
production database, or deployment was used. Canonical CasaOS resource/alert
acceptance, scheduled backup, live provider/human P3 checks, and the public-only
cloud isolation drill remain open.

The current image was then built natively in the same isolated Ubuntu 24.04
ARM64 VM with VFS storage. Clearing the inherited host proxy variables let the
build complete: `local/pubg-saas:git-6313ef7`, image ID
`sha256:e144276b8061d2362d2abcd9ecdd26421b5bed049541bfe90b268210e601afc8`.
Compose render, Gateway/Worker no-credential dry-runs and the two-service egress
smoke passed on that Linux-built image. No provider credentials were used and
the Compose project was stopped afterward. The earlier guest-native build
attempts failed due overlayfs and stale proxy environment; both conditions are
resolved in this isolated VM. Detailed reproduction commands are in
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

The same latest image then completed a fresh source-to-restore database
rehearsal using new Compose project names/volumes. Encrypted backup verification
and restore passed: 37/37 public table counts and 14 migration rows matched;
synthetic tenant/team/job counts were 1/1/1. App rollback DML/DDL denial,
backup read-only/no-`nextval`, and app sequence-use probes passed on both
databases. After stopping the public projects, Kurisu regression passed 68/68;
private OpenClaw and 9Router IDs/start times stayed unchanged with restart
count 0. The disposable restore DB was removed by exact marker/name; Compose
used plain `down` with no volume deletion. No real provider credentials,
production DB, deployment, push, 9Router change or private OpenClaw restart.

The systemd backup service and six-hour timer were then integration-tested as
temporary `/run` units in the dedicated Linux VM. The actual oneshot completed
under a temporary service identity; the age artifact verified against 37
public tables, and systemd reported the next timer event. The Compose adapter's
owner-only `.env` requirement caught a group-readable staging fixture; the
fixture was corrected without weakening that check. Units, service identity,
group access and staging were removed afterward. This does not count as
persistent M204/canonical-host scheduling.

## 2026-10-14 — PUBG SaaS current-source M1 and local recovery acceptance

Commit `880a5cf` completes confirmed team leaderboard preferences and
team-scoped aliases in migrations `0013` and `0014`. Both mutations recheck
team-admin authority and require an actor/channel-bound one-use confirmation.
The SaaS/PostgreSQL suite passes 100/100 with no skips, private Kurisu
regression passes 68/68, and both typecheck groups and the SaaS build pass.

Built local ARM64 image `local/pubg-saas:git-880a5cf` with manifest digest
`sha256:6dd0afafea5fc7d33c1ed3eed34e7834b0bed911dbf8f31da373671acf8d142f`.
Separate fresh PG18.1 Compose projects applied all 14 migrations. The
encrypted age backup restored to a fresh PG container with 37/37 public table
counts and all 14 migration rows matching; tenant/team/job, preference, alias
and sequence state survived. DML/DDL and app/backup role boundaries passed
before and after restore. With the SaaS projects stopped, Kurisu regression
passed 68/68; read-only checks showed OpenClaw healthy and 9Router running.
No private service was restarted or changed, and no provider credentials,
production DB, image push or deployment was used.

The image and rehearsal used the local OrbStack Docker context. The canonical
CasaOS machine `example-node` was absent from the available machine inventory;
canonical-host Compose/resource validation remains open. Full evidence and
reproduction references:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md` and
`infra/pubg-saas/BACKUP_RESTORE_REHEARSAL.md`.

## 2026-10-14 — KOOK test-server Gateway authentication check

An isolated PG18.1 test project on current image `880a5cf` applied through
migration `0014`; the Gateway used the protected test bot credential, a local
placeholder PUBG key, no model configuration and a five-message daily limit.
Read-only KOOK inventory found one test guild and one text channel without
retaining identifiers. The authenticated Gateway session was persisted in
`kook_gateway_state` (`last_sn=0`). No human event arrived, so no inbox/outbox
delivery or command/button flow was exercised. The test stack was stopped with
plain `down`, its named PG volume retained, and the temporary credential copy
removed. This is authentication evidence only; human P3 acceptance remains
open. No message, PUBG/model request, production change or deployment occurred.

## 2026-10-14 — PUBG SaaS post-0012 local acceptance

Commit `a04224a` adds migration 0012, bounded per-bot retention and the
`/pubg privacy` statement. The locally loaded ARM64 image
`local/pubg-saas:git-a04224a` (manifest digest
`sha256:9920ad368398723be3703e49c8543ffaec6c3984994aa0f937d957c7e894bdf1`)
passed isolated Compose startup and migration. An encrypted age backup
restored to a separate fresh PG18.1 container; all 37 public table counts
matched, including 12 migration rows and synthetic tenant/team/job counts
1:1:1. App DML/no-DDL and backup read-only/no-nextval permissions passed on
source and restore. The private Kurisu suite passed 68/68 with public Compose
stopped; read-only checks showed OpenClaw healthy and 9Router running, with no
restart or config change. SaaS/PostgreSQL tests passed 100/100, both typecheck
groups and backup safety 14/14 passed. No provider credentials, image push,
deployment, production DB or private runtime changes were used. Clean Linux and
cloud recovery, backup schedule installation, canonical-host capacity, live
provider and human P3 gates remain open. Detailed evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

## 2026-10-14 — PUBG SaaS local M2 container rehearsal

The local ARM64 image `local/pubg-saas:git-f0aa16b` was built with digest
`sha256:f6985df9ea17bde1d7f5b60826e7fb336047ad5e74d93f896f5e16a52dc5f21c`.
Fresh source/restore Compose projects used isolated PostgreSQL 18.1 volumes;
migration `0011`, empty-queue worker start and gateway dry-run passed without
real provider credentials. A local-only `docker compose exec` adapter now keeps
the DB on its internal network and checks container, network, port and volume
ownership before invoking PostgreSQL tools. Encrypted backup, decrypt/archive
verification and fresh-container restore passed; all 37/37 public table counts
matched. App DML/no-DDL and backup read-only/table/sequence boundaries passed
before and after restore. Focused adapter/backup unit tests pass 21/21.

The source, restore and prior temporary SaaS projects were stopped with
`docker compose down` and their synthetic volumes preserved. The pre-existing
`pubg-saas-pg18` test fixture remains available. With the SaaS projects stopped,
`pnpm test:pubg` passed 68/68; private OpenClaw remained running/healthy and
9Router remained running on the available OrbStack machine. Neither service
was restarted or modified, and no private PUBG tool query was made. The
test-server KOOK credential file was not used for this local drill. Human P3
flows, real PUBG/model provider acceptance, clean Linux/cloud restore, retention,
clean-host egress verification, measured host headroom and isolated-cloud
independence remain open. No production database or deployment was touched. Evidence:
`.agent/checkpoints/2026-10-14-pubg-saas-m2-local-container-rehearsal.md`.

Follow-up: a separate read-only KOOK inventory (one guild, one text channel;
no identifiers retained, no message sent) confirmed only the test bot's current
inventory. A fresh restore-PG worker one-shot discovered one synthetic team
and one delayed job, attempted zero provider syncs, and exited successfully on
an internal-only network. The disposable database was guarded-cleaned. Human
P3 actor flows remain unverified.

The M2 application egress boundary now keeps gateway/worker on internal
networks and sends fetch/WSS through an HTTPS CONNECT proxy that refuses
non-public DNS answers. Focused tests pass 6/6; local Compose verified no app
default route, direct metadata denial (`ENETUNREACH`), proxy denial to metadata
and `host.docker.internal` (403 each), and a credential-free HTTPS HEAD via the
proxy (200). With `PUBG_SAAS_TEST_DATABASE_URL` set to the reusable isolated PG
fixture, the full SaaS suite passed 92/92 with no skips; private tests passed
68/68 and both affected typecheck groups passed. No provider credentials were
used and no KOOK message was sent. Clean Linux/cloud, schedule installation,
host resource headroom and cloud independence remain open.
Source commit `8316f4e` was built as ARM64 image
`local/pubg-saas:git-8316f4e` with manifest digest
`sha256:1e94dfc77c0ad6d07928d3138e789e18ad19e17286f14647a1b50709f05e5b77`.
After the committed-image Compose project was stopped with plain `down`,
Kurisu tests passed 68/68 again and read-only checks showed private OpenClaw
healthy and 9Router running. Idle PG/proxy memory was 28.58/13.22 MiB under
1 GiB/128 MiB limits; this is not a capacity result. The configured
`example-node` host profile is still unavailable.

An amd64 build exposed a Docker context omission: `.env.local` was not ignored
before the first local cross-architecture build. The file was not loaded by an
application process and no image was pushed. SaaS-specific private BuildKit
cache records were pruned (820 MiB); commit `f70d29b` now excludes
`*.env.local`. A rebuilt local `linux/amd64` image from that commit had
manifest-list digest
`sha256:329b330f43cdd84861dde5072109467306d894886c60ecff49b52633e01c18e4`;
an offline read-only runtime probe returned Node `x64` and confirmed the env
file is absent from the final image. This does not establish clean amd64 Linux
Compose/restore or M204 capacity. No production, 9Router or private OpenClaw
runtime was modified.

The workflow's local equivalent passed the isolated SaaS/PostgreSQL suite
(92/92), Kurisu regression (68/68), both typecheck groups, backup/restore
safety suite (21/21), architecture/secrets gates and synthetic 200-team
benchmark. That run completed 200/200 worker team runs with zero failures;
authorized query p95 was 81.67 ms, worker read p95 61.25 ms, and pool peak was
16/20 with no waiters. These measurements are limited to the local PG fixture;
GitHub Actions has not run and no M204 capacity claim is made.

Added an SHA-pinned, read-only `.github/workflows/pubg-saas.yml` to run isolated
PG-backed public tests, private Kurisu regression, typechecks, backup safety,
the 200-team synthetic benchmark, Compose render, and a no-push multiarch image
build. Local Compose render passed with placeholders. A combined local OCI build
reported `linux/amd64` and `linux/arm64` (index digest
`sha256:cf6fb5cbb1e1771845b86bdb40cc649ac14a496e47311ce6bf3155935d941d3a`).
`scripts/verify-pubg-saas-oci.py` validates both platforms. GitHub Actions has
not run because no push was performed; this is source/local acceptance only.

On 2026-10-14, rebuilt current commit `91bb60f` locally as an ARM64 image
(`local/pubg-saas:git-91bb60f`, manifest digest
`sha256:ce344830bab21504e5f1ca13690eba539f989d09f9ce2d413ced48ffe2ed0682`).
Fresh isolated source and restore PG18.1 Compose projects completed migration,
gateway dry-run and delayed-queue worker startup. Encrypted backup/verify and
fresh-container restore matched 37/37 public tables. App DML/DDL and backup
read/write/sequence boundaries passed on both databases; synthetic
tenant/team/job row counts matched 1:1:1. With both public Compose projects
stopped via plain `down`, Kurisu tests passed 68/68, OpenClaw remained healthy
and 9Router remained running. Only local placeholders were used; no image was
pushed, no deploy occurred, and no private runtime or 9Router config changed.
Real provider checks, clean Linux/cloud recovery and independence, schedule
installation and canonical M204 headroom remain open. Details and the corrected
harness configuration are recorded in the dated rehearsal checkpoint.

The same current commit also passed a local `linux/amd64` Compose simulation
with fresh AMD64 PG18.1 source and restore containers, migration 0011,
gateway/worker smoke, encrypted backup and restore (37/37 public tables), and
app/backup role probes on both databases. The projects were stopped with
volumes preserved. OrbStack could not provision a clean Ubuntu VM in three
network configurations because the guest never received an IP, so this emulated
result is not native clean-Linux acceptance. Read-only post-stop checks showed
OpenClaw healthy and 9Router running; no private runtime was modified. No image
was pushed or deployed. Full evidence is in the dated rehearsal checkpoint.

The 200-team benchmark now includes in-process RSS/heap peak sampling. Its
targeted local run passed with 0 failures and 200/200 worker team runs; pool
peaked at 16/20 with no waiters. Authorized-query P95/P99 were 79.83/110.50 ms,
worker-read P95/P99 were 62.37/103.50 ms, process RSS peaked at 169.8 MiB and
heap at 54.2 MiB. A separate coarse sample measured the 24 GiB Mac host at 74%
free memory before/min/after and the isolated PG fixture at 58.5→112.2 MiB in
four samples. This does not measure gateway/worker container peaks or canonical
`example-node` capacity; no SLO or production headroom claim is made.

## 2026-10-13 — PUBG KOOK SaaS M1 source acceptance; M2 active

The operator selected `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md` for this worktree.
M1 source/offline acceptance passed: the KOOK query handler, bounded AI SDK
planner and deterministic query executor are wired; an independent public
worker writes match and team-scoped telemetry facts to PostgreSQL. Overlapping
teams merge shared match-player facts while scoped reads return only each
registered roster. Validation passed with 74/74 SaaS tests on isolated
PostgreSQL 18, all 68 private PUBG-related tests, `pnpm typecheck:pubg`,
`pnpm build:pubg-saas`, dry-runs, and the secrets scan. Full evidence and
reproduction commands: `.agent/checkpoints/2026-10-13-pubg-saas-m1-source-acceptance.md`.

This is source acceptance only. No SaaS service, real KOOK guild, external
model provider, production database, OpenClaw, 9Router or container was changed.
M2's 200-team load/resource work, backup/restore and public/private independence
drills remain open; P3 live guild acceptance and P4 prompt benchmark remain
external acceptance gates.

## 2026-10-10 — 9Router bounded upstream diagnostic headers deployed

9Router is live on CasaOS `example-node` as
`local/9router:git-83bb76b5e7c8-20261010T032550Z`, manifest
`sha256:828a0c7b2c54e169c8ec4a0219f764c1ca2024efb04a79afb5db2f95a269be9a`.
The source commit is `83bb76b5e7c8`; the protected rollback checkpoint is
`/DATA/AppData/9router/backups/router-upgrade-20261010T032550Z`.

The effective npm 0.5.95 route now exposes bounded diagnostic headers for
allowlisted SSE event/type/code/reason fields, and Combo records them without
logging prompts, image bytes, response bodies or credentials. The route and
Combo markers are verified. Diagnostic-header, reference-preservation,
fallback, health, runtime-policy and isolated speech checks passed. A real
prompt-only smoke observed `sunburst` 502 followed by successful `flare`; the
request-scoped failure produced no cooldown or account lock.

The separate “Selected model is at capacity” message came from the Codex
development task UI and is unrelated to WhatsApp or the 9Router image route.

Detailed evidence and rollback: `.agent/checkpoints/2026-10-10-9router-upstream-diagnostics-detail-patch.md`.

## 2026-10-10 — Heartbeat silent delivery fix deployed

Amadeus 1.10.2 is live on CasaOS `example-node` as
`local/openclaw-amadeus:git-5085b3fb0b3f-20261010010836` with manifest
`sha256:61649779f7d830db39ad2e58c180aaa0688bfad0855a007fef70d279bd0ee68a`.
The native heartbeat final sender now suppresses text-only `NO_REPLY`, handles
control-prefixed sentinels, and removes leading internal control markers from
real alerts. The container is healthy, the Amadeus plugin registered, managed
Cron targets passed, and no heartbeat-triggered send was observed after the
switch. Protected checkpoint and evidence are recorded in
`.agent/checkpoints/2026-10-10-amadeus-heartbeat-silent-delivery-release.md`.

The active release source commit is `5085b3f`; the protected external rollback
checkpoint is `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261010010836`.

Active Goal: `docs/PUBG_KOOK_SAAS_V0_1_GOAL.md` for this worktree. The public Image Lab
is reachable at `https://image.example.com` with a password login page and
valid HTTPS. The updated task-image modal, automatic edit resolution and precise
large-seed input are deployed to the Mac UI. Quality remains capped at 16 steps;
CFG 1 is deployed for the operator's comparison after multiple Fast-mode outputs
looked good across random and fixed seeds. The operator's Quality image review
remains pending. Production image generation remains GPT-only.

The current Quality and Fast engine configs match `origin/main`. Quality is
16 steps / CFG 1 with implicit legacy `--diffusion-fa` and no configured
prefix cache. Fast is 4 Fun-Acc/PDD steps / CFG 1 with `--diffusion-fa`,
`q8_0` and mmap. The bridge retains the stale-engine port ownership guard and
SIGTERM child cleanup. The operator requested this config restoration after
reviewing a visibly incomplete Quality image. Evidence:
`.agent/checkpoints/2026-10-09-qwen-image-restore-origin-config.md`.

The incomplete 92.169-second Quality task was likely served by an orphan Fast
engine left on port 18795 after a bridge restart. The bridge refuses to start
against an occupied engine port and performs graceful child cleanup on
SIGTERM. Checkpoint:
`.agent/checkpoints/2026-10-09-qwen-image-quality-stale-fast-engine.md`.

## 2026-10-09 — 9Router image diagnostics and false-lock fix deployed

The operator-approved Apply rollout deployed `local/9router:git-ed872b3f3978-20261009T130134Z`
with manifest digest `sha256:1a068329307c0a46f7699bfe05034f7375891113adddd3efb44ce7b23aa97045`.
Only 9Router was restarted; OpenClaw remains on
`local/openclaw-amadeus:git-a1983e9b637d-20261009090331`. The effective npm 0.5.95
CLI bundle reports the upstream-diagnostics and runtime-policy markers, and the
three health endpoints plus unauthenticated model boundary passed.

The compiled parser now preserves valid Codex image results and emits typed
`image_result_missing`, `sse_incomplete`, `transport_interrupted`,
`upstream_failed`, `safety_refusal` and `account_unavailable` outcomes. The
request-scoped 502 selector fixture returned zero cooldown and zero provider
updates, while a genuine 429 retained a bounded native cooldown/update. The
reference fixture preserved unchanged bytes/MIME across sunburst → flare → 2.5
and verified the success model header. A real edit smoke produced one successful
sunburst result; a later provider failure made exactly three bounded attempts and
left the active Codex row active with no image locks or error state. Evidence and
rollback: `.agent/checkpoints/2026-10-09-9router-image-diagnostics-cooldown-fix.md`.

## 2026-10-09 — Engine configs restored from origin/main

The operator requested the previously published engine configuration. The two
source JSON files match `origin/main`: Quality remains 16 steps / CFG 1 with
default `--diffusion-fa` and no prefix-cache model args; Fast remains 4
Fun-Acc/PDD steps / CFG 1 with default `--diffusion-fa`, `q8_0` and mmap. The
bridge stale-engine guard remains installed. No generation was submitted.
Deployment evidence: `.agent/checkpoints/2026-10-09-qwen-image-restore-origin-config.md`.

## 2026-10-09 — Full Flash Attention enabled for both profiles

The operator requested full `--fa` on Fast as well as Quality. Both profiles
use `q8_0` prefix cache. Quality remains 16 steps / CFG 1; Fast remains 4
Fun-Acc/PDD steps / CFG 1. No image generation was submitted. Deployment and
rollback evidence: `.agent/checkpoints/2026-10-09-qwen-image-both-profiles-full-fa.md`.

## 2026-10-09 — Quality Flash Attention with q8_0 prefix cache deployed

The operator clarified that the Quality cache should return to 8-bit `q8_0`,
while keeping `--fa`. The Quality source config sets `prefixCacheType: q8_0`;
Quality remains 16 steps / CFG 1, and Fast is unchanged. No image generation
was submitted. Deployment and rollback evidence:
`.agent/checkpoints/2026-10-09-qwen-image-quality-fa-q8-0.md`.

## 2026-10-09 — Quality Flash Attention and prefix cache comparison deployed

The source-managed Quality profile now launches with `--fa` and
`--model-args qwen_image_2_1_prefix_cache=true,qwen_image_2_1_prefix_cache_type=auto`.
It remains the base model at 16 steps / CFG 1 without Fun-Acc/PDD arguments or
adapter. Fast remains unchanged at 4 Fun-Acc/PDD steps / CFG 1 with its existing
Flash Attention, q8_0 prefix cache, mmap and Fun-Acc/PDD settings. The service
restart completed; bridge health is ready/idle, no task is active, no
`sd-server` process is resident, installed bridge and profile configs match Git
source, and the local and public UI roots return 200. The operator will generate
and judge the image; no generation was submitted during this configuration
change. Protected rollback snapshot and evidence:
`.agent/checkpoints/2026-10-09-qwen-image-quality-fa-prefix-auto.md`.

## 2026-10-08 — Image Lab task modal and automatic edit resolution

The Mac bridge and UI LaunchAgents were updated from Git source. Task-history
image viewing now uses a separate modal and keeps the active result preview
untouched. Edit requests send `resolution=auto`; the bridge uses valid source
geometry or scales within the 1024px edge, 1MP and 32px alignment limits while
preserving reference bytes and MIME. Completed task/result metadata report the
actual PNG dimensions. Quality remains 16 steps / CFG 1 and Fast remains four
Fun-Acc/PDD steps / CFG 1. The focused bridge/UI suite passed (35 tests), as
did Python and JavaScript syntax, `pnpm check:secrets`, and `git diff --check`.
Bridge health is ready and idle; local UI and public HTTPS root return 200, and
the unauthenticated public task API returns 401. No login or generation was
performed. Protected pre-deploy snapshot:
`~/Library/Application Support/Amadeus/backups/qwen-image-modal-auto-before-20261008T2016+0800`.
Rollback evidence: `.agent/checkpoints/2026-10-08-qwen-image-modal-auto-resolution.md`.

## 2026-10-08 — Quality CFG 1 comparison deployed

The Mac bridge and Quality engine config now use CFG 1 at 16 steps, preserving
the same model, VAE, sampler, and base schedule. Fast remains Fun-Acc/PDD at 4
steps and CFG 1. The focused bridge/UI suite passed (32 tests), the secrets scan
passed, and Python/shell syntax plus `git diff --check` passed. The installed
bridge and both profile configs match Git source; bridge health is ready, no
task is active, and no `sd-server` process is left running. The public HTTPS
root and local UI both return HTTP 200. No image was generated during this
deployment; the operator will evaluate the Quality output. Protected rollback
snapshot and evidence:
`.agent/checkpoints/2026-10-08-qwen-image-quality-cfg1-redeploy.md`.

## 2026-10-08 — Image Lab image viewer and seed precision redeployed

The Mac Image Lab now exposes `查看图片` for successful tasks with saved PNGs.
The authenticated `/api/tasks/<id>/image` route serves only that task's bounded
PNG and never accepts a filesystem path. Seed input is decimal text validated
with browser BigInt up to signed 64-bit maximum; the server receives an exact
decimal string and converts it to an integer before forwarding. Values outside
JavaScript's safe integer range are returned to the page as strings so the
effective seed remains exact.

`infra/macos/manage-qwen-image-debug-ui.sh --apply` installed and restarted the
LaunchAgent. Its immediate `bootout`/`bootstrap` sequence encountered launchd
error 5, so the source-managed manager now retries bootstrap up to ten times
with a one-second interval. The managed apply and local LAN/model-discovery
smoke then passed. Local page checks found the image-view button and large-seed
control. `https://image.example.com/` returned the password page with valid
TLS; unauthenticated health, models, tasks and generation requests returned
401. The operator will perform authenticated public validation; no login or
public image generation was performed by this deployment.

Focused bridge tests (15) and debug UI tests (16), Python compilation, shell
syntax checks, secret scan and `git diff --check` passed. Protected pre-deploy
Mac snapshot: `~/Library/Application Support/Amadeus/backups/qwen-image-public-lab-ui-before-seed-view-20261008T082412Z`.
Detailed rollback and evidence: `.agent/checkpoints/2026-10-08-qwen-image-public-lab-seed-view-redeploy.md`.

The previous Quality smoke timed out after 600 seconds at step 15/16 and
returned HTTP 504 after 610003 ms; it is not running. Both engine generation
deadlines are now 900000 ms, the UI proxy deadline is 910 seconds, and engine
load stays capped at 600 seconds. The Mac bridge reports `deadlineMs: 900000`;
bridge/UI source files and both engine configs match the installed runtime.
The first bridge LaunchAgent bootstrap returned macOS error 5; a source-managed
ten-attempt retry was added and the subsequent restart passed. Local no-login
and model-discovery smoke passed. Public HTTPS root returned 200 and protected
unauthenticated health/models/tasks/generation requests returned 401 with the
exact public Origin. The operator will perform login and public image checks;
Fast smoke and Quality rerun remain open. Protected pre-deploy snapshot:
`~/Library/Application Support/Amadeus/backups/qwen-image-timeout-before-20261008T084228Z`.
Detailed evidence and rollback: `.agent/checkpoints/2026-10-08-qwen-image-generation-timeout-redeploy.md`.

## 2026-10-08 — Image Lab Caddy TLS route staged

The source-managed exact site in `infra/vps/image-lab.example.Caddyfile` is
appended to the VPS Caddyfile. The original Caddyfile is protected at
`/var/backups/amadeus-image-lab/20261008T073835Z/caddy/Caddyfile.pre` (directory
`0700`, file `0600`); Caddyfile validation and reload passed. The existing
Cloudflare-proxied DNS already resolves, and Caddy obtained a Let's Encrypt
certificate for `image.example.com`. Public HTTPS now reaches Caddy and returns
`502` because `127.0.0.1:18798` has no listener. No DNS or frp changes were
made during the Caddy stage. Subsequently, frps was updated to allow the
additional TCP `18798` port and `maxPortsPerClient` was raised from 10 to 11,
after saving a root-only checkpoint and verifying the candidate with frps
0.69.0. The restart passed and its complete listening-port set matched before
and after; `18798` remains unbound until frpc is configured. At the operator's
explicit `Apply` instruction, one persistent IPv4/IPv6 INPUT rule was added to
drop non-loopback TCP `18798` while preserving Caddy's loopback upstream.
A separate SSH connection succeeded after the change; the before/after rule
comparison confirmed no other firewall changes. At the time of this Caddy-only
stage, the runtime-only password verifier had not yet been provisioned. Evidence and rollback
commands are in
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-caddy-staged.md` and
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-frps-port.md` and
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-firewall.md`.

## 2026-10-08 — Image Lab UI and frpc route live

The new one-engine bridge and two-profile configuration are installed on M204;
the bridge health endpoint reports `ready`. The LAN UI LaunchAgent serves on
`0.0.0.0:18798`, preserves LAN no-login behavior, and the exact public Host
serves the password-only login page. The operator entered the password into
the hidden native prompt; the runtime scrypt verifier is present with mode
`0600`, and its contents remain outside Git and logs. LaunchAgent `bootstrap`
returned macOS error 5 on its first attempt; a direct retry loaded each service
successfully. Local LAN root and model discovery return 200; public wrong
password, models, tasks, and unauthenticated generation return 401.

HomeLab frpc config has one new `qwen-image-lab-tcp` proxy to the verified Mac
address `192.168.5.3:18798`, remote TCP `18798`. Config validation passed before
and after, frpc is active, and the current session log reports successful
startup of the new proxy and all eight previous proxies. The protected pre-
change config is at
`/Volumes/Avalon/backups/amadeus-image-lab/frpc/20261008T075816Z/frpc.toml.pre`
(directory `0700`, file `0600`); checkpoint:
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-frpc.md`.

Public HTTPS returns 200 with certificate verification result 0. VPS frps
listens on 18798, while persistent IPv4 and IPv6 guards block non-loopback
access to that plaintext tunnel port; Caddy reaches it over loopback. A local
Quality 1024x1024 fixed-seed generation smoke is in progress; Fast and public
authenticated generation acceptance remain pending. The operator will verify
their password session and public page directly.

Production remains GPT-only: the live Amadeus container reports
`AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0` and
`AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0`.

## 2026-10-10 — VPS 12-hour traffic windows deployed

Amadeus 1.10.3 is live as immutable image
`local/openclaw-amadeus:git-e1a862c1ca96-20261010022421`. The VPS accounting
collector now samples every 60 seconds, retains three days of bounded provider
and account deltas, and publishes complete-aware 12-hour `reportWindow` fields
for whole-VPS bytes, active subscription bytes, retired Legacy bytes when
complete, and the uncalibrated other-service/unattributed residual. The
09:30/21:30 Asia/Shanghai VPS reports and owner queries use these fields while
keeping cumulative quota, lifetime provider growth, and proxy totals separate.

The first post-rollout provider window is intentionally unknown until a full
12 hours of sample coverage exists; at `2026-10-10T02:27:06Z` the live snapshot
had five provider samples and `subscriptionBytes=5518957198`, while
`providerBytes` and the residual remained unknown. The accounting service is
active and schema 5 is verified. No proxy credential, SSH, firewall, or proxy
service was changed.

Rollback checkpoints are `/root/amadeus-gateway-backups/vps-accounting-window-20261010022302`
on `amadeus-gateway` and
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261010022421`; full evidence
is in `.agent/checkpoints/2026-10-10-vps-traffic-window-release.md`.

## 2026-10-08 — VPS subscription accounting and owner reports deployed

Amadeus 1.9.9 is live on CasaOS `example-node` as
`local/openclaw-amadeus:git-b80f9a7882cc-20261008052549`. VPS subscription
accounting is active from T0 `2026-10-08T04:58:07Z`; KiwiVM remains the whole-plan
source and proxy reconciliation remains `uncalibrated`. The five Labmem accounts
passed HY2 and VLESS connectivity checks and their individual traffic counters
were observed; the legacy credentials also passed after both proxy services
restarted. Counter generations and cumulative accounting survived Xray and
Hysteria restarts.

The existing owner report Cron jobs retain their IDs and are enabled at 09:30
and 21:30 Asia/Shanghai, using the owner outbox. The midday report acceptance
was delivered; a date-limited recovery event key is configured for the 2026-10-08
evening run after the midday test used the regular key. Post-deploy checks passed
for OpenClaw/Product Radar health, Amadeus registration, NAS read-only access,
owner outbox and Cron definitions. Managed log policy reports a warning because
the host daemon has no default logging configuration; existing managed
containers have bounded logs. No daemon restart was made.

Protected rollback checkpoints:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261008052549` and
`/Volumes/Avalon/backups/operation-skuld/vps-subscription-accounting/phase2-prechange-20261008T042931Z`.
Deployment evidence: `.agent/checkpoints/2026-10-08-vps-subscription-accounting-deployment.md`.

The operator closed the Goal after reporting that a direct owner query returned
normally and instructing that the old token remain unchanged. All 24 public
subscription URLs returned HTTP 200 and matched their server files. The 21:30
recovery-key report was still scheduled for later that day at closure, and is
not claimed as already executed. Reconciliation remains `uncalibrated`; no
anomaly is claimed. A prior tool result exposed a legacy bearer-token path; it
was a recorded residual at closure. The later security operation below revoked
the Legacy subscription and proxy credentials. Full closure evidence is in the
Goal and deployment checkpoint.

## 2026-10-08 — Legacy retired; example-device active

After the earlier accounting Goal was closed, the operator explicitly
authorized the formal Legacy shutdown and a Mac mini-only `example-device`
identity. Legacy is disabled; its subscription token, HY2 secret, and VLESS
UUID were replaced in the live account store, its subscription directory was
removed, and its client was removed from active Xray. Xray and Hysteria were
restarted, terminating any existing Legacy sessions. Its old four-format
subscription URLs return 404, old HY2 authentication returns 403, and a VLESS
tunnel attempt with its old UUID is denied. The six active accounts (five
Labmem plus M204) have 24 working public subscription formats. M204 HY2 and
VLESS tunnels both reached external HTTPS successfully. The public usage
snapshot contains no credential fields and retains Legacy only as disabled
history.

The protected pre-change recovery checkpoint is
`/root/amadeus-checkpoints/2026-10-08-example-device-retirement-prechange` on
`amadeus-gateway`, mode `0700` and owned by root. Its SQLite backup passed
`quick_check`; it includes original Legacy keys and must not be restored without
immediately reapplying the retirement. The previous accounting/owner report
deployment remains Amadeus 1.9.9; candidate image
`local/openclaw-amadeus:git-509639ee3a5e-20261008112407` is healthy and not a
release. Report jobs remain at 09:30 and 21:30 Asia/Shanghai. Reconciliation
remains `uncalibrated`. Evidence:
`.agent/checkpoints/2026-10-08-example-device-legacy-retirement.md`.

## 2026-10-09 — VPS proxy security hardening complete with accepted residual

Source commit `8434e2b4018c` adds an exact-SNI Xray Reality fallback gate,
reset-safe fallback counters, bounded HY2 failed-auth tracking and conservative
enforcement, sanitized security snapshots, and owner-only Amadeus presentation.
Xray now sends Reality fallback to loopback `127.0.0.1:24431`; only exact
`www.apple.com` SNI reaches the audited camouflage target, and other gate
traffic is blocked. Hysteria had no masquerade configured and continues to use
its default 404 behavior. Auth, Xray stats, HY2 stats and fallback gate remain
loopback-only. No active account credential or client-visible node parameter
changed.

example-device and example-account-01 passed real VLESS and HY2 HTTPS smokes; HY2 passed
again after the limiter entered `enforce`, with TLS verification enabled. The
owner security snapshot reports fallback/auth aggregate telemetry and the
configured fallback traffic signal. On 2026-10-09, those counters include
controlled hardening acceptance traffic and do not establish compromise.
Provider/proxy reconciliation remains `uncalibrated`.

OpenClaw now runs immutable image
`local/openclaw-amadeus:git-8434e2b4018c-20261009024420` and is healthy. Only
the image field changed in the live Compose file; container mounts, port
bindings, restart policy and networks were preserved. The existing morning and
evening report IDs remain enabled, no-deliver, and scheduled for 09:30/21:30
Asia/Shanghai; their prompts include the security facts. One manual morning
report was delivered through the existing owner outbox using a manual key. The
owner completed the direct owner-DM security query at
`2026-10-09T11:08:01+08:00`. The visible result reported all listed source
statuses as `ok`. HY2 limiter mode was `enforce` with full 900-second coverage,
15 window failures / 19 over 12 hours,
zero limited requests, and about one failure source. Reality fallback was
76,424 B with the configured observation signal, and reconciliation remained
`uncalibrated`. This is sanitized observational evidence and does not establish
compromise.

Protected rollback evidence: VPS `/root/amadeus-checkpoints/2026-10-09-vps-proxy-security-hardening-preapply`;
CasaOS `/root/amadeus-checkpoints/2026-10-09-openclaw-proxy-security-hardening-preapply`;
repo `.agent/checkpoints/2026-10-09-vps-proxy-security-hardening.md`.

During a later read-only acceptance diagnostic, six active subscription
bearer-token directory names appeared in task tool output. Their values are not
reproduced in Git or this record. No runtime/account state changed and no token
was rotated; the Goal explicitly forbids rotation. The operator explicitly
chose to preserve the credentials and accept this documented residual. The
Phase 0 no-credential-output control was violated once and is not described as
passing. The owner-DM query passed at 2026-10-09 11:08:01 +08:00 with sanitized
source and security facts recorded above; no compromise is inferred from the
observation signal. The Goal is complete with this accepted exception.

## 2026-10-07 — Qwen LAN debug UI automatic save deployed

A lightweight macOS LaunchAgent serves the local generation/reference-edit
page at `192.168.5.3:18798` and `192.168.5.112:18798`. It accepts private and
loopback clients without a UI login, requires same-origin write requests, and
proxies only to the authenticated loopback Qwen bridge at `127.0.0.1:18793`.
Successful PNG results are saved to `~/Pictures/Amadeus/QwenImage` with
directory/file modes `0700`/`0600`; saved paths and save failures appear in the
page and task history. After `infra/macos/manage-qwen-image-debug-ui.sh
--apply`, `/`, `/api/tasks`, model discovery, and both LAN URLs returned HTTP
200; installed Python/HTML hashes match the repository files. No post-deploy
generation/edit acceptance request was sent.

At the user's direct deployment instruction, an earlier image request was
still connected between the stable bridge and model engine. Restarting the UI
closed its old client socket, while the bridge-to-engine connection remained
active. The request's output cannot be confirmed or recovered through the new
UI, whose in-memory task list reset on restart. Let it finish before submitting
another image request. The production GPT-only route, 9Router, and paused
Fun-Acc candidate are unchanged. Rollback:
`infra/macos/manage-qwen-image-debug-ui.sh --stop --apply`; protected restore
backup and evidence: `.agent/checkpoints/2026-10-07-qwen-image-debug-ui-autosave.md`.

## 2026-10-07 — Amadeus 1.9.7 GPT-only image route deployed

Release source commit `4316946bd3fe` runs on CasaOS machine `example-node` as
immutable image
`local/openclaw-amadeus:git-4316946bd3fe-20261007125707` (manifest
`sha256:5244b1f681a33c64cba633095c6529e613dcba0dddf6637213028965a2b806ba`).
The production environment has `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0` and
`AMADEUS_QWEN_IMAGE_FALLBACK_ENABLED=0`; the existing route overlay is
fail-closed for automatic Qwen fallback. 9Router remains the unchanged sole
`cx/gpt-image-2.5` primary. The operator reported an `arthur-combo` HTTP 408;
no live image request was issued to re-probe it, so the provider timeout remains
unresolved and will surface directly without fallback.

Protected pre-switch checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261007125707` (mode `0700`,
18 backup items). The saved pre-switch Compose names the prior image
`local/openclaw-amadeus:git-e7a815c07114-20261007054830`; the previous `.env`
and runtime state are protected in the same checkpoint. Post-deploy evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261007125707`.
OpenClaw/Product Radar health, Gateway registration, NAS read-only smoke,
owner notification/outbox and post-deploy maintenance passed. The optional
media-adapter smoke was skipped because the service is absent; managed log
policy returned `warning`. Release evidence:
`.agent/checkpoints/2026-10-07-amadeus-1.9.7-gpt-only-image-release.md`.

The Qwen bridge/token were not modified. The Fun-Acc Goal is paused and its
uncommitted candidate work remains preserved outside the deployed commit.

## 2026-10-07 — 9Router 0.5.95 protected runtime upgrade deployed

Committed source `cb223a0bc9e4a2652acfc012797abd79aedf930c` is running on
CasaOS machine `example-node` as immutable image
`local/9router:git-cb223a0bc9e4-20261007T065751Z` (manifest
`sha256:2e5f966f3b063f9d5045e0b75ace38758e9e5e6867505bbb39a2a5a9a1f966e4`).
The npm package is `0.5.95`; its base remains pinned to
`decolua/9router:0.5.75@sha256:7c893bc2c27ecea2ae337abd5eacfec9e5763091b3a3b7862fc0625b770bb156`.
The exact package passed the TTS-style, runtime-policy, and Combo-safety source
patches. Focused tests, secrets scan, isolated image checks, health, expected
host-loopback auth rejection, live GPT Image Combo and runtime-policy checks
passed. The previous image archive is outside Git and SHA-256 verified. The
protected pre-switch backup is
`/DATA/AppData/9router/backups/router-upgrade-20261007T065751Z`; its directory
is mode `0700` and its files are mode `0600`. The existing
`0.0.0.0:20128` container port binding was retained, not changed by this
release. Rollback and evidence:
`.agent/checkpoints/2026-10-07-9router-0.5.95-upgrade.md`.
9Router remains the sole `cx/gpt-image-2.5` primary; Qwen fallback ownership
remains in OpenClaw. Real WhatsApp fallback acceptance remains open.

## 2026-10-07 — Amadeus 1.9.6 cloud-primary/local-Qwen release deployed

Release commit `e7a815c` is running on CasaOS machine `example-node` as
`local/openclaw-amadeus:git-e7a815c07114-20261007054830` (image ID
`sha256:ea225fc0ebbc8cd64a340883d16990fa538e3f94fd066ed2f67a849b4d14ec7b`).
9Router remains the sole `cx/gpt-image-2.5` primary; production
`AMADEUS_QWEN_IMAGE_LOCAL_ONLY=0` enables one OpenClaw-owned Qwen fallback for
eligible operational failures. Safety refusals and invalid requests do not
fall back. OpenClaw/Product Radar health, Gateway registration, authenticated
Qwen model discovery, NAS read-only smoke, owner notification/outbox and
post-deploy maintenance passed. Optional media-adapter smoke was skipped
because the adapter is absent; log policy reported a warning. Krea active
source, deployment env and Compose secret mount are retired; external model
files are preserved.

The user confirmed the corrected local-only pose edit looked acceptable, but
the production GPT-failure-to-Qwen WhatsApp path and healthy-primary reference
edit have not been proven end to end. Goal remains open. Protected rollback and
evidence: `.agent/checkpoints/2026-10-07-amadeus-1.9.6-qwen-fallback-release.md`.

## 2026-10-07 — Qwen edit strength corrected before production release

Commit `6b7623e` corrected the bridge's native edit parameter to
`{"strength":0.9}`. The authorized Mac LaunchAgent restart is healthy after
startup asset verification, and the OpenClaw container's authenticated
`/v1/models` request returned HTTP 200. The operator later reported the corrected
local-only pose edit looked acceptable. This was candidate-path validation,
not evidence of the production primary-failure fallback. Protected pre-restart
local copies and recovery details:
`.agent/checkpoints/2026-10-07-qwen-image-edit-strength-restart.md`.

## 2026-10-07 — Qwen local-only OpenClaw candidate before production release

Operator-authorized candidate commit `e0a2217` was briefly running on the
canonical CasaOS host as OpenClaw image
`local/openclaw-amadeus:git-e0a2217f302d-20261006185442`. The temporary
`AMADEUS_QWEN_IMAGE_LOCAL_ONLY=1` switch routes image generation and edits
directly to the authenticated local Qwen bridge; GPT Image is not attempted
for candidate image requests. 9Router remains on the unchanged primary-only
image, and Amadeus is still version 1.9.5, not a release. Health, Gateway
registration, authenticated container-to-bridge reachability and protected
token mode passed. The pre-switch checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006185442`.
Real WhatsApp image/caption acceptance and the final GPT-primary-to-Qwen
fallback remained pending when this candidate was superseded by the 1.9.6
release above. Evidence:
`.agent/checkpoints/2026-10-07-amadeus-qwen-image-local-only-candidate.md`.

## 2026-10-07 — Qwen edit bridge candidate, OpenClaw not switched

The Qwen-Image-2.1 Uncensored bridge is installed as a separate loopback-only
Mac LaunchAgent with its own protected token. Complete pinned asset/runtime
hash validation, host health, authenticated OpenClaw-container reachability,
and one real single-reference edit through `/v1/images/edits` passed. The
synthetic portrait's pot turned teal in one 768×768 PNG after 398.35 seconds,
visually preserving the blue jacket and scene. The Krea LaunchAgent was absent
at preflight. OpenClaw and 9Router are still the Amadeus 1.9.5 primary-only
baseline; no candidate OpenClaw overlay or release has been deployed. The model
child stopped after about three idle minutes, leaving the bridge healthy and
host memory free at 81%; swap remained elevated near its pre-run level.
Protected rollout, real WhatsApp fallback, and Krea source retirement remain
open. Evidence:
`.agent/checkpoints/2026-10-07-amadeus-qwen-image-bridge-candidate.md`.

## 2026-10-07 — VPS proxy credentials rotated

At the operator's explicit authorization, the one Xray VLESS UUID and the
Hysteria 2 password were regenerated on the VPS. The four subscription bodies
at the existing current token URL were updated; the token and Reality keypair
were not changed. Both proxy services were stopped before the six live files
were atomically replaced, then started with the new credentials. The old
credentials are absent from the live server and subscription files. Candidate
Xray configuration and Hysteria loopback startup tests passed. Both services
are active and listening on TCP/UDP 2053; eight local HTTPS body checks on 443
and 8443 and four public HTTPS checks passed. This does not prove client-side
handshakes; the owner's devices must refresh or re-import their subscription.
Two later 20-second network samples still showed approximately 5.4–6.8 Mbps
of aggregate interface traffic. Successful post-restart Hysteria connections
came from one source IP matching the current SSH egress, but the traffic cannot
be attributed to a device or protocol from these counters alone. Further
isolation is needed if the aggregate usage keeps rising.
The root-only protected checkpoint is
`/root/amadeus-gateway-checkpoints/proxy-credential-rotation-20261007T014956`.
Evidence: `.agent/checkpoints/2026-10-07-vps-proxy-credential-rotation.md`.

## 2026-10-07 — VPS subscription token rotation completed

A new shared random subscription token is active for Clash/Mihomo,
Shadowrocket, and Quantumult X. After the operator's explicit revocation
request, the old token was removed from both Caddy matchers and its subscription
directory was deleted. All four old public links return `404`; all four new
public links return `200`. Local checks also passed for both formats over ports
443 and 8443. Caddy and the subscription responder remain active, and the
Caddyfile is `root:caddy` mode `0640`. Proxy UUIDs and Xray/HY2 client
credentials were not changed; already-imported proxy configurations may still
connect at that stage. The proxy credential rotation above supersedes that
intermediate state. Current URLs remain outside Git in a local `0600` file. Protected
pre-revoke checkpoint:
`/root/amadeus-gateway-checkpoints/subscription-old-url-revocation-20261007T003714`.
Evidence: `.agent/checkpoints/2026-10-07-vps-subscription-old-url-revoked.md`;
the earlier staged checkpoint remains at
`.agent/checkpoints/2026-10-07-vps-subscription-rotation-staged.md`.

## 2026-10-06 — Wild Krea2 local fallback rollout paused

The operator paused the local Krea2 deployment after two real WhatsApp
text-to-image attempts reached the local engine but exceeded the 600-second
image deadline. The previous Amadeus 1.9.5 runtime was restored from the
pre-candidate checkpoints: OpenClaw
`local/openclaw-amadeus:git-0a062a1c2c13-20261005153543` and 9Router
`local/9router:git-0a062a1c2c13-20261005T153458Z`. OpenClaw is healthy, WhatsApp
is connected, the primary route is back on 9Router/GPT, and the Krea bridge plus
the synthetic primary test endpoint are stopped. The candidate source and
external model assets remain preserved for a later optimization pass; no Krea2
release or version bump was made.

## 2026-10-06 — Wild Krea2 local fallback candidate (paused)

The local `ModdiAdam/Wild_Krea-2-turbo_NSFW` Q4_1 transformer is pinned and
hash-verified outside Git with the pinned Metal `stable-diffusion.cpp` runtime,
Qwen3-VL 4B Q4_K_M text encoder, and Wan2.1 VAE. Direct 1024-class generation,
the protected loopback bridge, and OrbStack container-to-bridge requests passed;
the bridge reports one active worker, one queued request, and a 600-second image
deadline. The cold/warm portrait and landscape benchmark completed without OOM;
the host remained responsive and Qwen TTS stayed healthy, although macOS swap
was high after the large model runs.

The active image desired state is one native `cx/gpt-image-2.5` primary. Gemini
image fallback is removed. An OpenClaw-only provider fallback sends
`local/wild-krea2-turbo-nsfw` to the authenticated loopback bridge for eligible
429/5xx/transport failures. Reference-image requests remain fail-closed until a
local edit path is separately proven. Candidate images are
`local/9router:git-2290e8926b70-20261006T095859Z` and
`local/openclaw-amadeus:git-2290e8926b70-20261006100001`; this is not yet a
version release.

The authenticated 9Router primary smoke passed (PNG, 818180 bytes), and a
real owner WhatsApp reference-image request established the activity path but
failed at the Codex entitlement boundary; it correctly did not degrade to
prompt-only Krea generation. A prior synthetic-primary failure produced a valid
local Krea image and claimed one Asset Registry attachment, but it used a CLI
session without an active WhatsApp completion port, so it is not accepted as
the required end-to-end WhatsApp fallback proof. The remaining gate is one
owner WhatsApp text-to-image request while the primary is deliberately made to
return 503, followed by proof of exactly one image primitive, native completion,
and the natural caption.

Protected checkpoints and external evidence:
`/Volumes/Avalon/backups/operation-skuld/amadeus-model-capability/amadeus-image-preapply-20261006T095850Z-70815.json`,
`/DATA/AppData/9router/backups/router-upgrade-20261006T095859Z`,
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006100422`, and
`/Volumes/Avalon/models/krea2/acceptance/`.

Full candidate evidence: `.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-candidate.md`.

## Amadeus 1.9.5 — current live image retry and safety chain

Release commits `adcd431` and `0a062a1` are live in immutable OpenClaw
2026.9.4 image
`local/openclaw-amadeus:git-0a062a1c2c13-20261005153543`; image manifest
`sha256:f1723c78db0f21f4867d2b607b4407d13babb997f41eced25e5628469e9bb80c`.
Runtime `/opt/amadeus/VERSION=1.9.5`. OpenClaw and Product Radar are healthy,
Gateway registration passed, and post-deploy maintenance passed.

The native image generation overlay classifies safety/policy refusals,
account/entitlement failures, invalid requests, and transient provider faults.
Only the transient class receives one bounded retry. The typed failure lifecycle
passes the category to localized Kurisu notices: safety failures suggest a
non-sensitive reformulation and never advise bypassing safeguards; raw upstream
payloads remain suppressed. The 9Router Combo patch returns a safety refusal
without trying the next provider while retaining fallback for ordinary eligible
provider failures.

9Router is live as
`local/9router:git-0a062a1c2c13-20261005T153458Z`; image manifest
`sha256:347a905f925d5b29ea16e950cddc1c2d56fe4cb14ca10560a160534913fdf57e`.
The exact compiled fixture passed the synthetic safety no-fallback check and
the ordinary fallback checks without changing provider or account state.

Focused tests, Amadeus delivery tests, typecheck, secrets scan, BuildKit image
builds, health/smoke, Gateway registration, NAS read-only smoke, owner
notification/outbox smoke, and post-deploy maintenance passed. The optional
media adapter was absent and its network smoke was skipped. No unsafe live
prompt acceptance was performed.

Protected checkpoints:
`/DATA/AppData/9router/backups/router-upgrade-20261005T153458Z` and
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261005153543`; external
deployment evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261005153543/`.
Full evidence:
`.agent/checkpoints/2026-10-05-amadeus-1.9.5-image-retry-safety-chain.md`.

## Amadeus 1.9.4 — superseded inbound image reference recovery release

Release commit `5c738c9` repaired model-authored `/media/inbound/` staging path
references before native image generation. Evidence remains in
`.agent/checkpoints/2026-10-04-amadeus-1.9.4-inbound-image-reference-recovery.md`.

## Historical release context retained below

# Project State — 2026-10-04

## Amadeus 1.9.4 — current live inbound image reference recovery release

Release commit `5c738c9` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-5c738c9be1ff-20261003190303`; image manifest
`sha256:c5513dc0127a074e047f701f1b9747073d95369903da4c1b25de0f600676b89b`.
Runtime `/opt/amadeus/VERSION=1.9.4`. The affected private-chat image was
successfully downloaded and sent in model context. The failure happened when the
model-authored `image_generate` call reproduced the inbound temporary path with
one separator missing, so native media loading returned `Local media file not
found`.

The plugin now stores the current inbound image path at `message_received`, binds
it to the current image context at `before_dispatch`, and repairs only model
parameters containing `/media/inbound/` immediately before `image_generate`.
Durable generated-image paths are not rewritten, and no image bytes or paths are
logged. Verification passed: the focused inbound-reference tests (2), the full
Amadeus suite (132), `pnpm typecheck:amadeus`, `pnpm check:secrets`, and
`git diff --check`. The BuildKit image build, Gateway registration, OpenClaw and
Product Radar health, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance passed. The optional media adapter was absent and its
network smoke was skipped; the host Docker default log policy remains a warning.
Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003190303`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003190303/`.
Full evidence:
`.agent/checkpoints/2026-10-04-amadeus-1.9.4-inbound-image-reference-recovery.md`.

## Amadeus 1.9.3 — superseded live reply envelope recovery release

Release commit `e2a94af` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-e2a94af6def4-20261003182157`; image manifest
`sha256:583f747e0b0a410e1133ea8383c1d6b2b5e95b1010592b40054c74f724a9f698`.
Runtime `/opt/amadeus/VERSION=1.9.3`. A successful image completion had a
legacy `MEDIA:/...` path prepended to a valid v2 typed reply, so the decoder
sent the generic format-error text even though the attachment was delivered.
The decoder now strips only that compatibility prefix, parses the typed
envelope, and never uses the path for asset selection.

Verification passed: 130 Amadeus tests, focused delivery regressions,
typecheck, architecture and delivery-boundary checks, secrets scan, BuildKit
image build, OpenClaw and Product Radar health, Gateway registration, NAS
read-only smoke, owner notification/outbox smoke, and post-deploy maintenance.
The optional media adapter was absent and its network smoke was skipped; the
host Docker default log policy remains a warning. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003182157`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003182157/`.
Full evidence:
`.agent/checkpoints/2026-10-04-amadeus-1.9.3-media-envelope-recovery.md`.

## Amadeus 1.9.2 — superseded live upscale recovery release

Release commit `8e667cf` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-8e667cf26122-20261003174442`; image manifest
`sha256:e0a96aea78b62d2598b93f021e2dfc2e9f55411a245401272f9e06015b09c83b`.
Runtime `/opt/amadeus/VERSION=1.9.2`. The host-native ImageAssets service is
running with the pinned Real-ESRGAN MLX engine and default tile size 256.

The observed 2x result (`853x1843 -> 1185x2560`) was a plain multiplier request
that also carried a model-authored `2k` profile, so the service applied its
2560px long-edge cap. A 4x request from `1185x2560` failed in untiled MLX
inference before producing an asset. The plugin now forwards `2k`/`4k` only
when the user explicitly names that profile; ordinary 2x/4x requests preserve
exact multiplier dimensions. Large capped 4x jobs use a bounded x2 inference
pass before the deterministic profile resize, and all large jobs use tiled
inference by default.

Verification produced ready assets for the prior failures: exact 2x
`853x1843 -> 1706x3686`, exact 4x `853x1843 -> 3412x7372`, and capped 4x
`1185x2560 -> 1778x3840` with `engineScale=2`. The source originals remained
unchanged. Focused service tests, 129 Amadeus tests, typecheck, architecture
and delivery-boundary checks, secrets scan, BuildKit image build, OpenClaw and
Product Radar health, Gateway registration, NAS read-only smoke, owner
notification/outbox smoke, and post-deploy maintenance passed.

Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003174442`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003174442/`.
Full evidence: `.agent/checkpoints/2026-10-04-amadeus-1.9.2-upscale-recovery.md`.

## Amadeus 1.9.0 — superseded private reply recovery release

Release commit `d43246a` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-d43246af1d21-20261003063024`; image ID
`sha256:347056d00ce97a01b40b0335c66753229647fbbf9f2ac070b91f6b007a5f429f`.
Runtime `/opt/amadeus/VERSION=1.9.0`. The 14:22 private VPS status reply was
normal assistant text, but the strict DeliveryEnvelope boundary treated it as
malformed JSON and sent the generic format-error response. The decoder now
recovers safe plain external-user text as a typed text part; protocol-shaped
objects, paths, fenced payloads, control tokens, voice runs and internal origins
remain strict. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003063024`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003063024/`.

Release verification passed: 129 Amadeus tests, focused decoder and reply-hook
regressions, typecheck, architecture and delivery-boundary checks, BuildKit
image build, secrets scan, OpenClaw and Product Radar health, Gateway
registration, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance. The optional media adapter was absent and its network
smoke was skipped; the host Docker default log policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-03-amadeus-1.9.0-plain-reply-recovery.md`.

## Amadeus 1.8.9 — superseded upscale target recovery release

Release commit `f82fb78` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-f82fb78b712f-20261003060001`; image ID
`sha256:9902b49c364c093b88621bde1ec9692df846dbb091087cfb64658f8539f90716`.
Runtime `/opt/amadeus/VERSION=1.8.9`. The recent private-chat upscale failures
were caused by model calls putting inbound staged paths or filenames in
`target.imageId`; the service rejected them as `image_id_invalid`. The plugin
now accepts only canonical `img_[0-9a-f]{32}` IDs and otherwise falls back to
the reply/current-conversation image resolver. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261003060001`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261003060001/`.

Release verification passed: 128 Amadeus tests, focused upscale target
regression, typecheck, architecture and delivery-boundary checks, BuildKit
image build, secrets scan, OpenClaw and Product Radar health, Gateway
registration, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance. The optional media adapter was absent and its network
smoke was skipped; the host Docker default log policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-03-amadeus-1.8.9-upscale-target.md`.

## Amadeus 1.8.8 — superseded private image completion fallback release

Release commit `e4e3498` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-e4e3498ba664-20261002162339`; image ID
`sha256:2869cfc03311c84eb95e0cb383d6aa1290d454f9fc086cd055b89c1179bae856`.
Runtime `/opt/amadeus/VERSION=1.8.8`. The private WhatsApp failure showed a
successful image generation followed by a native continuation timeout. The
fallback now transfers an unprepared media claim without hijacking the private
session route, so the generated image remains deliverable and later follow-ups
use their own inbound runs. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002162339`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002162339/`.

Release verification passed: 127 Amadeus tests, typecheck, architecture and
delivery-boundary checks, build, secrets scan, OpenClaw and Product Radar
health, Gateway registration, NAS read-only smoke, owner notification/outbox
smoke, and post-deploy maintenance. The optional media adapter was absent and
its network smoke was skipped; the host Docker default log policy remains a
warning because `/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-03-amadeus-1.8.8-image-completion-fallback.md`.

## Amadeus 1.8.7 — superseded silent protocol guard release

Release commit `8037979` is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-8037979fe652-20261002120821`; image ID
`sha256:93b594cf543139fbb8a0927766df65c25ba5079463c80f26ce0eb4847ad49f24`.
Runtime `/opt/amadeus/VERSION=1.8.7`. The typed DeliveryEnvelope decoder now
silences control-token-prefixed uppercase sentinels, and the WhatsApp final
text adapter rejects any control token before provider send. Normal typed text,
voice and image delivery remain unchanged. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002120821`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002120821/`.

Release verification passed: 126 Amadeus tests, typed decoder and pinned
WhatsApp boundary regressions, typecheck/build, architecture checks, secrets
scan, OpenClaw and Product Radar health, Gateway registration, NAS read-only
smoke, owner notification/outbox smoke, and post-deploy maintenance. The
optional media adapter was absent and its network smoke was skipped; the host
Docker default log policy remains a warning because `/etc/docker/daemon.json`
is absent. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.7-silent-protocol-guard.md`.

## Amadeus 1.8.4 — superseded unrestricted Kurisu image caption release

Release commit `808678c` (caption behavior implementation `f196b4d`) is on
`main`. The release is live in immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-808678cdc952-20261002085415`; image ID
`sha256:dc4c9461f1e1ce06db75bba2dab51bf65802bac39bce764f6f88f909580d545a`.
Runtime `/opt/amadeus/VERSION=1.8.4`. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002085415`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002085415/`.

The successful post-generation image caption no longer has an Amadeus
character-count ceiling or a short-caption instruction. The Completion Agent
is asked to let the current Kurisu persona choose wording, detail, tone and
natural length from the generated image. Fallback caption enrichment follows
the same rule. Structured protocol, JSON, path, `MEDIA:` and internal control
token rejection remains in place.

Release verification passed: 125 Amadeus tests, 87 Delivery tests plus the
pinned delivery contract, typecheck/build, secrets scan, image-route authority
and integration preflight, OpenClaw and Product Radar health, Gateway
registration, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance. The optional media adapter was absent and its network
smoke was skipped; the host Docker default log policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.4-unrestricted-kurisu-caption.md`.

## Amadeus 1.8.3 — superseded native image completion caption release

Source commits `dfcc7fa`, `66489ff`, `2ae5b6d`, `0565c44` and release commit
`6bde9f9` are on `main`. The release is live in immutable OpenClaw 2026.9.4
image `local/openclaw-amadeus:git-6bde9f91e5f7-20261002081707`; image ID
`sha256:c05ec704c628bb9a735c07426450735b078aeff947447fb4289505e23d478a7b`.
Runtime `/opt/amadeus/VERSION=1.8.3`. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002081707`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002081707/`.

The completion path now imports the trusted generated image before native
continuation, preserves exact `image_generate:<taskId>` provenance, carries
verified image bytes as read-only Completion Agent context through durable
queued handoff, and waits while a handoff is `session_queued`. The native
caption is bound to the existing inline attachment. A real owner WhatsApp
acceptance produced `image_completion_caption_ready` with
`caption_source=native_completion`, one image provider primitive and no
separate completion text send. Failure/malformed/timeout fallback remains
attachment-only and idempotent; unrelated text, voice, TTS/ASR, upscale and
reference-image paths are unchanged.

Release verification passed: 125 Amadeus tests, pinned image-route tests (10),
build/typecheck, secrets scan, plugin/config/skill preflight, OpenClaw and
Product Radar health, Gateway registration, NAS read-only smoke, owner
notification/outbox smoke, and post-deploy maintenance. The optional media
adapter was absent and its network smoke was skipped. Managed Compose log
policies passed; host Docker default log policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.3-native-image-completion-caption-release.md`.

## Amadeus 1.8.2 — superseded native image completion release

Source commits `e6c31e1` (completion behavior) and `76ece67` (release gate
fixture) are pushed to `main`; `76ece67` is live in immutable OpenClaw 2026.9.4
image `local/openclaw-amadeus:git-76ece6705ee5-20261002065812`. The image ID is
`sha256:c86e41c4d2bdddd9dfb7c70a7b31d3a261bb851efce54571737103d3efda4ea3` and
runtime `/opt/amadeus/VERSION=1.8.2`. OpenClaw health, zero-restart check,
Gateway registration, Product Radar health, NAS read-only smoke, owner outbox
smoke, and protected rollback checkpoint pass.

After a successful ordinary `image_generate`, Amadeus still owns the trusted
generated attachment, Asset Registry, DeliveryEnvelope, 9Router route, and
single channel image send. The completion overlay now clears only native media
primitives and falls through to native `task_completion` / Completion Agent
continuation, preserving native task terminal settlement and the natural
completion reply. The pinned integration test proves one typed completion and
one native continuation with no duplicate native attachment/media primitives.
Voice/TTS/ASR, normal text, upscale/document, reference-image routing, and other
DeliveryEnvelope behavior were left unchanged.

Release verification passed: `pnpm test:amadeus` (124), pinned image-route
tests (10), build/typecheck, secrets scan, plugin/config/skill preflight,
OpenClaw and Product Radar health, Gateway registration, NAS smoke, owner
notification/outbox smoke, and post-deploy maintenance. The optional media
adapter was absent and its network smoke was skipped. Managed Compose log
policies passed; the host Docker default policy remains a warning because
`/etc/docker/daemon.json` is absent. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.2-native-image-completion-release.md`.

Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002065812`; external
evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002065812/`.

## Amadeus 1.8.1 — current live structured-reply reliability release

Source commit `2525d38` is pushed to `main` and live in immutable OpenClaw
2026.9.4 image `local/openclaw-amadeus:git-2525d3892169-20261002063108`, image
ID `sha256:6d9b88d0f53664e58504ebbce1b8e7fbe647f9bf3f42ac7876d7d20edf447e77`.
Runtime `/opt/amadeus/VERSION=1.8.1`; OpenClaw health, Gateway registration,
Product Radar health, NAS read-only smoke, owner outbox smoke, and protected
rollback checkpoint pass. The checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261002063108`; external
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261002063108/`.

Malformed external structured Agent replies now settle through a bounded visible
fallback instead of being silently dropped. Literal control characters inside
JSON strings are repaired before strict validation; malformed protocol text is
never echoed or logged. Safe run correlation metadata is recorded, while trusted
internal origins remain silent. The existing `nine_router/arthur-combo` route
continues to serve the agent/tool loop; web search provider selection remains a
separate retrieval configuration. Full evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.1-structured-reply-release.md`.

## Amadeus 1.8.0 — superseded reference-image route release

Source commit `2244f98` is pushed to `main` and live in immutable OpenClaw
2026.9.4 image `local/openclaw-amadeus:git-2244f98140e0-20261001145719`, image
ID `sha256:c418bc6397c713c401ed9bc060542d3464318c4c1f6cb9c6b1b38f14ce8c4e35`.
Runtime `/opt/amadeus/VERSION=1.8.0`; OpenClaw health, Gateway registration,
Product Radar health, and protected rollback checkpoint pass. The checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001145719` (directory
0700, manifests 0600); external evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261001145719/`.

The 1.7.9 reference-image failure root cause was the missing 9Router
`/api/v1/images/edits` route: OpenClaw sent multipart edits while live 9Router
0.5.91 exposes only `/api/v1/images/generations`. A content-free multipart
probe reproduced the HTTP 500/Next.js Server Action error. 1.8.0 adapts one
PNG/JPEG/WebP reference (<=10 MiB) into the existing logical JSON generations
contract. Codex receives `input_image`; the Gemini fallback receives
`inlineData`; the original bytes are preserved. Multi-reference input fails
closed before admission. No 9Router source/account/credential/Combo change was
made; other providers retain native multipart edits.

Focused route tests (9), exact compiled 9Router byte-preservation fixture,
live post-deploy fixture, canonical Combo verification, build/typecheck/tests,
secrets, health, Gateway registration, NAS smoke, owner outbox, and maintenance
passed. Live fixture:
`LIVE_REFERENCE_ROUTE_FIXTURE=passed route=openai/amadeus-image bytes=preserved multi_reference=blocked http_requests=0`.
No post-switch route invariant/transport/Server Action error was observed. No
paid reference-image transport smoke or manual owner WhatsApp reference-image
acceptance was performed; that is the only pending manual acceptance. No
cross-restart exactly-once claim is made. Full evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.8.0-reference-route-deploy.md`.

## Amadeus 1.7.8 — superseded image-generation repair (historical)

Source commit `9f23572` was pushed to `main` and was live in immutable OpenClaw 2026.9.4
image `local/openclaw-amadeus:git-9f2357210a07-20261001112610`, image ID
`sha256:c5c1b2d410e25b98bb71c7bf6212699f35b5a8714141c297d8bd0522143d624e`.
Runtime `/opt/amadeus/VERSION=1.7.8`, container/OpenClaw health, Product Radar
health, and Gateway Amadeus registration pass. Protected rollback checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001112610` (directory 0700,
manifest 0600); content-safe evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261001112610/`.

After 1.7.7, the owner retried image generation and it failed again. Safe logs
confirmed its `before_tool_call` handler fired but OpenClaw's pinned shallow
merge preserved the omitted `model` key. 1.7.8 writes a blank sentinel, which
the native image tool parses as no override and resolves to configured
`openai/amadeus-image`/fallback. The same task's language stayed unknown because
`event.body` could be present but blank, blocking fallback to non-empty
`event.content`; 1.7.8 selects the first non-empty field. The provider response
contained no safe parameter name, so no more specific invalid field is claimed.
No private prompt/message/image contents are retained.

Pre-apply gates passed: `pnpm test:delivery` (84 plus pinned integration),
`pnpm test:amadeus` (121), typecheck/build, architecture/fixture checks, version,
secrets, and `git diff --check`. OpenClaw/Product Radar health, plugin
registration, NAS read-only smoke, owner notification/outbox smoke, and
post-deploy maintenance passed. The optional media adapter was absent; its
network smoke was skipped. Host Docker default log policy remains a warning;
managed Compose policies are bounded.

No new paid image-generation transport smoke or manual owner WhatsApp acceptance
was performed after 1.7.8. Automated verification is not real-channel
acceptance; no cross-restart exactly-once claim is made. Detailed evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.7.8-image-route-repair.md`.

## Amadeus 1.7.7 — interim attempt, superseded after retry failed

Commit `79577cc` deployed as
`local/openclaw-amadeus:git-79577cc27dfc-20261001110629`; health and automated
gates passed, but owner retry reproduced the generation failure because omitted
hook params did not delete the original model field. The runtime was not rolled
back; the blank-sentinel correction was deployed as 1.7.8. Evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.7.7-image-route-repair.md`.

## Amadeus 1.7.6 — prior delivery-boundary repair

Source commit `092b262` was deployed in image
`local/openclaw-amadeus:git-092b262332b7-20261001102103`; its final WhatsApp
callback re-runs strict typed preparation when OpenClaw bypasses `preparePayload`.
It was superseded by the later image-generation fixes. Evidence:
`.agent/checkpoints/2026-10-01-amadeus-1.7.6-whatsapp-final-delivery-release.md`.

## Amadeus image persona 1.7.5 — prior rollout evidence, not current runtime

The earlier final-release record describes immutable image
`local/openclaw-amadeus:git-5444b3a94a82-20261001073247`, original-request
context and caption automation. It remains historical evidence only; a later
read-only audit found production had reverted to the 1.7.4 rollback image. The
1.7.5 manual owner WhatsApp/image-experience acceptance was waived and not
performed. Evidence:
`.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-final-release.md`.

## Qwen3-TTS MLX production rebaseline — applied, Gate A–G passed

Runtime rebaseline, destructive retirement cleanup, final state documentation,
and push to canonical `main` are complete. Implementation/deployment source
commit `0fdfdbb`, source cleanup commit `45f96a9`, and content-safe evidence
commit `46d0b49` are pushed to `main`.
Amadeus `VERSION=1.7.4` was not bumped.

M204 now runs only the authenticated Qwen3-TTS MLX 1.7B Base / MLX 8-bit
`mlx-audio` 0.5.6 local engine through `com.amadeus.qwen3-tts` on loopback
`127.0.0.1:18794`, using the unchanged 46s original A `kurisu-v1` reference
and Auto language. Port `18792` remains the separate ImageAssets service; this
live collision and its protected rollback evidence are documented in the active
Goal. 9Router's single `amadeus-tts` connection points to its loopback TTS
bridge and reports local Qwen3 MLX → Qwen Audio 3.1 → Qwen Audio 3.0. The live
immutable 9Router image is
`local/9router:git-0fdfdbbd91f2-20260930T211901Z`
(`sha256:c6c2bf40c95d62a49c14cd7ec7c8188002a35352bedc7cc911397e857f1caf7b`).
OpenClaw and Product Radar were not rebuilt or restarted for this Goal; the
ImageAssets endpoint stayed unchanged.

GPT-SoVITS and OminiX resident/runtime/model/venv/tuner/LaunchAgent/active
source assets and legacy 9Router provider connections have been removed after
the automated gates passed. The original Kurisu A profile remains protected
outside Git. The sole Kurisu WAV sample from the retired package is archived
outside Git at
`/Volumes/Avalon/backups/operation-skuld/amadeus-kurisu-wav-archive-20261001`;
manifest SHA-256:
`e1362946d7d04abb4d22faa4ed65e93acbeb97045445c955992ebfd58e75a6c9`.

Focused service/provision/bridge tests, Amadeus tests/typecheck/build, pinned
MLX asset verification, direct WAV/MP3 synthesis, unauthorized-auth rejection,
logical 9Router route, forced Qwen Audio 3.1 fallback, synthetic 3.0 ordering,
restart/health, secrets scan, source search and `git diff --check` passed. The
controlled local-busy test used the live cloud 3.1 endpoint; the local service
remained healthy. Memory pressure and post-warmup footprint were recorded. The
owner explicitly waived human listening/WhatsApp acceptance; none is claimed.
Detailed content-safe evidence is in
`.agent/checkpoints/2026-10-01-amadeus-qwen3-tts-mlx-rebaseline.md`.

## TTS default-only local-first policy — deployed and verified

Commit `5013800` is deployed in immutable 9Router image
`local/9router:git-5013800c8de2-20261001T045604Z`
(`sha256:816eb335fb382a3d1b2ad0e4bb62d0aa3e43cf9c318fe230ecdf78fba4ce425f`).
The owner-requested behavior is active: all valid styles/emotions normalize to
`default`, every request tries local Qwen3 MLX first, and only operational local
failure reaches cloud Qwen Audio 3.1 → 3.0. The source preserves emotion
instructions behind `AMADEUS_TTS_EMOTIONS_ENABLED`; the live Compose value is
false and bridge health reports it disabled. A non-default `angry` smoke
returned local Qwen MLX audio with no cloud fallback. ASR, OpenClaw, ImageAssets,
model/profile, credentials and voice IDs are unchanged. The follow-up task and
evidence are in `.agent/tasks/2026-10-01-amadeus-tts-default-only-policy.md`
and `.agent/checkpoints/2026-10-01-amadeus-tts-default-only-policy.md`.

## Image generation lifecycle + Kurisu caption UX — candidate applied; owner Gates A–F accepted

Source commits `1dd9dd2` (lifecycle/caption implementation) and `628703c` (Kurisu caption wording refinement)
are pushed to `main`. Amadeus VERSION remains `1.7.4`; no release bump was performed. Authorized candidate
apply uses immutable OpenClaw 2026.9.4 image
`local/openclaw-amadeus:git-628703c803e7-20260930184906`, image ID
`sha256:849311277404f7454adaaed3cbcdbf0678e4f92112adb2ff7cdfa8a4738a96f9` (ARM64). OpenClaw and
Product Radar health, Amadeus registration, NAS read-only smoke and candidate owner outbox smoke passed.
The protected external rollback checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930184906`; content-safe deployment evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930184906/`.

One pinned OpenClaw integration binds accepted to `notifyMediaGenerationAsyncTaskStarted` after detached
task scheduling and success/failure to the authoritative typed `wakeMediaGenerationTaskCompletion(params)`
status. Persisted generated `attachments[]` remain the only image authority. Kurisu's caption prompt now
allows natural free-form wording without a fixed word-count target; `AttachmentPart.caption` still obeys the
native provider maximum of 1024 characters. The captioner sees the verified registry image and workspace
persona; caption errors use a deterministic fallback and cannot block image settlement. WhatsApp uses one
native image send with caption; Telegram uses native `sendPhoto` caption. The image-generation Skill keeps
an accepted interim Agent reply silent so it does not duplicate the lifecycle acknowledgement.

Source checks passed: `pnpm workflow:plan`, `pnpm test:delivery` (66 focused tests including exact pinned
source integration), `pnpm test:amadeus` (100 tests), `pnpm typecheck:amadeus`, `pnpm build:amadeus`,
`git diff --check`, `pnpm check:secrets`, and `pnpm check:architecture`. The deployment workflow rebuilt the
OpenClaw image on the host; Product Radar reused its unchanged image. `media-organizer-adapter` was absent
before apply and was not restored; its optional network check was skipped.

The owner directly attested in chat on 2026-10-01, “真是AF全部通过”, confirming real WhatsApp owner Gates
A–F passed after candidate deployment. This owner attestation, rather than the deployment notification/outbox
smoke, is the acceptance evidence; no private chat contents/screenshots are retained. Detailed status is in
`.agent/checkpoints/2026-10-01-amadeus-image-generation-lifecycle-caption-candidate-applied.md`.
Task coordinator and delivery settlement are bounded process-local state, not a durable cross-restart
exactly-once journal; no stronger restart/replay claim is made.

## 9Router 0.5.91 upgrade and strict GPT Image account — deployed

Independent of the pending OpenClaw DeliveryEnvelope release, CasaOS 9Router
runs immutable image `local/9router:git-499d53576169-20260930T071137Z`
from committed source `499d535`. `codex/gpt-image-2.5` now admits only the
configured owner email even when other Codex connections remain enabled.
The permitted account returned a usage-limit `429` in one authenticated live
smoke; the router reported one permitted account locked and generated via the
existing Gemini model fallback. No other Codex account was used. The Next.js
standalone Server Actions body limit is `20mb`; a real >1 MB action upload has
not yet been exercised. Sixteen account definitions, all aliases, and the
`amadeus-image` Combo were preserved. Upgrade/policy checkpoints and rollback
are in `.agent/checkpoints/2026-09-30-9router-0.5.91-image-account.md`.


## Amadeus image generation background completion — prior corrective candidate (2026-09-30; superseded)

The 2026-09-30 corrective candidate used immutable image
`local/openclaw-amadeus:git-d7f2847d82f4-20260930154020`, built from committed
source `d7f2847d82f4f1dc15f84589a8a5907890992cae`. It was superseded by the
2026-10-01 lifecycle/caption candidate above. This prior candidate's OpenClaw/Product Radar health, Amadeus registration, NAS read-only and owner
outbox smokes passed at that time. Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930154020`. Deployment
evidence path:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930154020/deployment-summary.md`.
This was a candidate apply, not a version release or owner-channel acceptance.

The corrective source was committed in `351b33e` and the exact-pinned handler
integration test in `8533713`. OpenClaw 2026.9.4's
`wakeMediaGenerationTaskCompletion(params)` has `status`, `handle`, and the
authoritative generated attachments/media URLs before it builds and hands off
the `task_completion` event. The version/digest-pinned bridge claims successful
WhatsApp/Telegram `image_generation` attachments there, before the completion
Agent. Amadeus imports the trusted attachment into the existing host image
registry, creates an inline DeliveryEnvelope v2 attachment, and settles through
the single delivery ledger and channel adapter. Native competing completion is
reported delivered only after this typed handoff/settlement succeeds; bridge
errors throw instead of silently cancelling. The async tool-start receipt is
not considered a generated image.

`pnpm workflow:plan`, `pnpm test:delivery` (including execution of the exact
pinned handler integration), `pnpm test:amadeus`, `pnpm typecheck:amadeus`,
`pnpm build:amadeus`, `git diff --check`, and `pnpm check:secrets` passed before
apply. Real owner WhatsApp tests for fallback success, LLM-independent delivery,
retry behavior, subsequent upscale, document integrity and text/voice regressions
remain required; the image-generation Goal is open until those gates have real
evidence. See `.agent/checkpoints/2026-09-30-image-background-completion-candidate.md`.

## Upscale default changed to 2x — candidate applied

The requested 2x default is deployed in both runtime boundaries. OpenClaw uses
`local/openclaw-amadeus:git-d7f2847d82f4-20260930154020`; the host image service
LaunchAgent was updated from Git source and is running/healthy. Runtime code
verification confirms omitted scale -> 2 and explicit scale 4 -> 4. The Amadeus
plugin defaults to 2 from trusted current-turn metadata and preserves explicit
user 4x; model-proposed 4x cannot override the default. No actual image was
upscaled as a production smoke. Protected rollback points and evidence are in
`.agent/checkpoints/2026-09-30-upscale-default2-candidate-applied.md`.

## DeliveryEnvelope v2 earlier source/rollback history (audit only)

Git source now defines one v2 typed user-facing settlement across text, voice and
registered image attachments. The retired text/voice-only contract and the two
JSON/document workaround scripts are removed from source. The source 2026.9.4
WhatsApp plan integration is an exact version/digest-pinned **single AST function
boundary**, not a multi-bundle JSON sanitizer or disposition hint chain.

**This is not production acceptance.** The first authorized candidate apply built
a new immutable image but stopped before the Compose switch because the pinned
container Node private-glibc environment could not execute npm via its shebang.
The old config was restored from protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930074729`; the live
container remains the previous healthy immutable image. The source installer
was corrected and the next retry requires a new committed image/checkpoint.
See `.agent/checkpoints/2026-09-30-delivery-envelope-first-apply-failure.md`.

A second authorized candidate built and installed the typed WhatsApp boundary,
but non-root plugin inspection found the Amadeus image bundle unreadable (0600
root) before Compose switch. Protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930080024` restored all
affected definitions/config and the previous WhatsApp module; the old image
remains healthy. The source build/image now set code artifact permissions 0644
and explicitly verify uid-1000 readability before a runtime write. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-second-apply-failure.md`.

The third candidate passed non-root readability and pinned module install but
stopped before switch at an out-of-process CLI inspector that also fails on the
previous healthy image. The Gateway's own startup log shows Amadeus registered
in that baseline. Checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930081212` restored all
staged definitions and previous WhatsApp module; the source now gates on real
Gateway registration immediately after health. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-third-apply-failure.md`.

The fourth candidate also stopped before switch when the offline Skill CLI
omitted Amadeus; uid-1000 inspection of that exact image verified all 14
manifest-declared Skills and 27 tool declarations. Protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930084057` restored
staged definitions and the previous WhatsApp module. The next candidate checks
bundle/Skill readability before switching, then real Gateway registration and
health immediately afterward. Evidence:
`.agent/checkpoints/2026-09-30-delivery-envelope-fourth-apply-failure.md`.

A fifth candidate briefly replaced OpenClaw but had no real Amadeus
registration, so the previous immutable image/config/module were restored from
checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930085757`.
After restart, the old image also lacked Amadeus because a persisted SQLite
plugin index contained 63 entries without it. A separately protected,
consistent DB backup precedes the official registry refresh; the rebuilt
64-entry index includes Amadeus with no diagnostic. The old Gateway then
registered Amadeus twice on startup, its Skills returned, and health passed.
Source deployment now backs up this SQLite state and refreshes the index
before strict candidate plugin/Skill and post-switch Gateway gates. Evidence:
`.agent/checkpoints/2026-09-30-amadeus-plugin-registry-recovery.md`.

The previous immutable image and each failed attempt's protected runtime
snapshot remain external rollback evidence; they are not the current
production code path or a compatibility fallback.

# Historical Project State — 2026-09-29

## 2026-09-29 Amadeus image assets and on-demand upscale — deployed; owner-channel acceptance pending

The host-native image asset service is installed as launchd label
`com.amadeus.image-assets` and reports Apple MLX readiness on port `18792`.
The default Mac-local asset root, registry, model cache and token paths are
derived from the active `$HOME` host profile; no username or absolute personal
path is encoded in Git. The external volume remains an explicit override after
launchd write access is verified.

Source commits `849041e`, `d745e4f`, `6210c70`, and `7175240` add the opaque
`imageId` registry, native generation-result correlation, explicit-only
`amadeus_image_upscale`, Apple Silicon `realesrgan-mlx` runtime, CasaOS
read-only mount, and deployment Compose-path propagation. OpenClaw 1.7.4 is
healthy at image
`local/openclaw-amadeus:git-6210c70b0ca6-20260929215321`; the candidate
Compose environment is verified against the live host asset root and token.

Host acceptance passed for realistic 2x, anime 2x, explicit anime 4x, manual
`imageId`, authenticated controlled media reads, unauthenticated `401`, host
service restart durability, and OpenClaw container recreate durability. The
protected deployment checkpoints are
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929215321` and the
candidate refresh
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929215636`; post-deploy
evidence is retained under the matching external-volume deployment paths.

The remaining gate is a real owner WhatsApp inbound turn. Synthetic CLI runs
deliver through WhatsApp but lack trusted inbound sender metadata and therefore
see only the safe web tools; production sender policy was not weakened to make
the CLI probe pass. Do not claim owner-channel image-generation/upscale
acceptance until the owner sends a real inbound request and the reply/asset
correlation is recorded.

## 2026-09-29 Kurisu GPT-SoVITS v2Pro MPS production cutover — applied; owner acceptance pending

The production `amadeus-tts` cutover is applied from source commit `606270b`.
GPT-SoVITS v2Pro MPS is the only resident local TTS: the API listens on
loopback `127.0.0.1:19870` and the authenticated production adapter listens on
`127.0.0.1:19871`. The live bridge primary smoke returned
`X-Amadeus-TTS-Provider: gpt-sovits-mps` with valid MP3 audio. During a
controlled adapter stop, the same bridge returned valid cloud audio and the
container audit recorded `qwen-audio-3.1-tts-flash` as attempt 1 with
`provider_unavailable`; the executable bridge test records the exact
`qwen-audio-3.1-tts-flash` -> `qwen-audio-3.0-tts-flash` ordering.

The OminiX `com.amadeus.qwen3-tts` LaunchAgent is uninstalled and ports
`:18792` and `:18793` have no listeners. The complete rollback checkpoint is
retained at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-20260929T164028Z`;
its 2823-file manifest verifies with no missing, changed or symlinked entries.
Warm direct synthesis measured 2.581646 seconds for 3.312 seconds of audio
(RTF 0.7795); swap remained at 2202 MiB while sampled free memory was 62–78%.
All post-apply evidence is under
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/`.

On 2026-09-29 the latest active reference was changed through the
source-controlled MPS manager to
`WAV/crs_0695.WAV_0000000000_0000224000.wav`, using its matching dataset
transcript `裸の得意点が作れていないなら、つまり被験者はブラックホールに放り込まれるのと同じだから。`.
The source change is commit `fa434dc`, applied with
`infra/macos/manage-kurisu-gpt-sovits-tts.sh --apply`. Per owner request, the
active model directory retains only this one reference WAV alongside the
GPT-SoVITS weights. The previous active `crs_0274` WAV, before-change plist,
live health and final synthesis are retained in protected rollback/evidence at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-reference-20260929T200040Z-0695/`.
The earlier `crs_1373`, `crs_2263` and `crs_0274` reference evidence remains in
their respective external checkpoints. The NLTK `cmudict` and
`averaged_perceptron_tagger_eng` resources remain installed under the declared
`NLTK_DATA` runtime path.

The Goal remains open as `WAITING_FOR_OWNER_CHANNEL_ACCEPTANCE`. The owner
still needs to verify the real production voice turn for Japanese
pronunciation, Kurisu identity, visible text behavior and typed-text
isolation. MLX conversion remains a later independent Goal.

## 2026-09-29 Kurisu GPT-SoVITS v2Pro PoC — accepted for further integration

At the PoC checkpoint time, the isolated `bysq/TTS-KurisuMakise` v2Pro candidate loaded on MPS and passed
Japanese synthesis. An 8-line identical-text A/B set against the direct
`qwen-audio-3.1-tts-flash` model-bound voice, plus a five-run warm benchmark,
remain outside Git under
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-poc-20260929/`.
The candidate then listened only on loopback `127.0.0.1:19870`; it was not
managed by launchd and had not been added to production routing. Production
`com.amadeus.qwen3-tts` was healthy at that checkpoint on PID `18387`, ports
`18792`/`18793`, and its Phase 0 file hashes were unchanged. The owner listened to the paired
files and judged `GPT-SoVITS 明显比 Qwen 3.1 更像牧濑红莉栖，Gate B 通过。`
The outcome was `ACCEPTED_FOR_FURTHER_INTEGRATION`; the MPS runtime and all
external evidence remain retained. The next planned Goal was
`docs/AMADEUS_KURISU_GPT_SOVITS_MPS_PRODUCTION_CUTOVER_GOAL.md`.
MLX conversion is deferred to a later independent optimization Goal.
Evidence and rollback scope are recorded in
`.agent/checkpoints/2026-09-29-amadeus-kurisu-gpt-sovits-poc-ab.md`.

## 2026-09-29 Qwen Audio TTS default pure voice clone — deployed

The cloud `default` request is now a pure voice-clone baseline. The bridge
sends only `text`, model-bound `voice`, `format`, `sample_rate`, and Japanese
`language_hints`; it omits instruction/persona/style, speed, and pitch.
Non-default emotions append the bounded emotion instruction.

Source commit `cc1ebfd` is deployed as
`local/9router:git-cc1ebfdeec3b-20260929T081836Z`. Focused bridge tests,
syntax checks, dry-run smoke, secrets scan, all three speech health checks,
and a real cloud default MP3 synthesis passed. The protected rollback
checkpoint is `/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T081836Z`;
source evidence is `.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-default-pure-clone.md`.

# Project State — 2026-09-29

## 2026-09-29 Qwen Audio TTS model fallback — deployed

The protected `amadeus-tts` bridge now uses the bounded order
`qwen-audio-3.1-tts-flash` → `qwen-audio-3.0-tts-flash` → M204 OminiX local
fallback. The 3.1 and 3.0 cloned voices are separate protected files because
voice enrollment is model-bound. Source commit `13cbd55` is deployed as
`local/9router:git-13cbd559ab24-20260929T062044Z`; OpenClaw and ASR remain
unchanged.

3.1 voice enrollment from the authorized 46-second sample, four-case direct
cloud smoke, protected runtime preparation, live cloud bridge smoke, health/auth
checks, and the protected deployment checkpoint all passed. The temporary
`audio.example.com` Caddy/frp sample route was removed after enrollment; its
Cloudflare DNS record must be removed separately if it remains.

The protected deployment checkpoint is
`/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T062044Z`; the
dated source checkpoint is
`.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-model-fallback.md`.

## 2026-09-29 Qwen Audio TTS cloud primary — owner accepted

The Qwen Audio TTS Goal is complete. Source commits `13ca03f` and `9347de1`
add the protected voice provisioning flow, the OpenAI-compatible 9Router
adapter, cloud-first `qwen-audio-3.0-tts-flash` synthesis, and one bounded
M204 OminiX fallback. The deployed 9Router image is
`local/9router:git-13ca03fa6fe0-20260929T051222Z`; OpenClaw remains on the
existing healthy `local/openclaw-amadeus:git-9e30a3dc08e8-20260928171059`
image. No second Agent/runtime or second resident local TTS model was added,
and the existing ASR route remains unchanged.

The protected 46-second reference and cloned voice identity stay outside Git.
Direct cloud smoke passed for the supported emotion cases and formats. The
real owner WhatsApp acceptance passed for all three required cases: typed
explicit voice produced one playable cloud media reply, ordinary typed text
produced no speech request and no media, and an inbound `audio/ogg; codecs=opus`
voice note produced one playable cloud media reply. No fallback was used in
these acceptance turns. The owner confirmed playback. The CLI
`openclaw agent --deliver` path is explicitly excluded from acceptance because
it bypasses the WhatsApp TTS lifecycle.

The protected deployment checkpoint is
`/DATA/AppData/9router/backups/qwen-audio-tts-deploy-20260929T051222Z`; the
owner acceptance evidence is
`/DATA/AppData/9router/backups/qwen-audio-tts-owner-acceptance-20260929T054329Z/evidence.json`.
The dated source checkpoint is
`.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-cloud-release.md`.

## 2026-09-28 typed voice semantic modality heartbeat isolation — candidate live

Commit `bce1cc6` is pushed to `origin/main` and deployed as
`local/openclaw-amadeus:git-bce1cc67fc8a-20260928054649` on M204 OrbStack
`example-node`. Runtime SQLite/transcript evidence showed the reported private
message came from the 13:04 and 13:34 OpenClaw heartbeat polls, not an
inbound user message. Those turns carry native
`inputProvenance.kind=internal_system`, but the prior hook treated every
WhatsApp turn as typed input and caused `[[amadeus:reply-modality=default]]`
to prefix `NO_REPLY`, bypassing the core exact-token suppression.

The hook now injects typed reply modality only for
`inputProvenance.kind=external_user`. A marked `NO_REPLY` is also removed
before WhatsApp delivery as a narrow fail-closed guard. Existing inbound voice
lease handling and the sole voice-reply Skill are unchanged. Focused tests,
Amadeus tests, OpenClaw patch fixtures, architecture, secrets and build passed;
candidate health, Product Radar health and NAS read-only smoke passed. The
protected rollback checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928054649`; post-deploy
evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260928054649`.
The same heartbeat job was manually run after deployment. Its transcript
returned exact plain `NO_REPLY`, and the post-restart WhatsApp log contained no
outbound send for that run. Evidence:
`.agent/checkpoints/2026-09-28-typed-voice-heartbeat-isolation-candidate-live.md`.

## 2026-09-28 typed voice semantic modality candidate — owner-accepted

Commit `235387f` is pushed to `origin/main` and deployed as
`local/openclaw-amadeus:git-235387f23d2e-20260928043207` on M204 OrbStack
`example-node`. The previous fixed typed-text classifier was removed. Each typed
WhatsApp turn initializes a turn-scoped `replyModality=default`; the same
Agent turn semantically chooses `voice` or `default` and emits hidden control
metadata. The pinned OpenClaw TTS/WhatsApp patch records that metadata for the
current run/session, strips it globally before delivery, gates missing-marker recovery
on `voice`, and clears it at `agent_end`/TTL. The existing verified inbound
voice lease and sole `voice-reply` Skill remain unchanged.

The protected rollback checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928043207`; health,
Product Radar, NAS read-only smoke, and WhatsApp linked/connected checks
passed. Focused tests, Amadeus full tests, OpenClaw 2026.9.4 patch fixtures,
architecture, secrets, and build passed. The owner confirmed the post-deploy
WhatsApp text and voice behavior is normal. Evidence:
`.agent/checkpoints/2026-09-28-typed-voice-semantic-modality-candidate-live.md`.

## Amadeus 1.6.5 model-capability adapter release — owner-accepted

Amadeus 1.6.5 is deployed on M204 OrbStack `example-node` with healthy immutable
OpenClaw image `local/openclaw-amadeus:git-fb7dd742b609-20260927142412`.
The owner confirmed the final repaired typed-to-voice behavior: one audio
attachment plus visible text in the exact `中文：...` / `日本語：...` format.

OpenClaw uses only the logical `openai/amadeus-image` capability. 9Router owns
strict GPT Image 2.5 → Gemini 3.1 Flash Image fallback; its Combo was
provisioned and reconciled through the existing management API, without source
or database edits. `arthur-combo`, `amadeus-asr`, `amadeus-tts`, `kurisu-v1`,
MP3, tagged TTS limits, global sensitive-tool denials, group admission and
unrelated service permissions remain preserved. Group image access is limited
to the existing admitted WhatsApp/Telegram groups plus the native
`image_generate` capability; direct non-owner access remains web-only.

Release gates, protected checkpoint, owner notification, health/smoke, real
transport/fallback evidence and post-deploy evidence are recorded in
`.agent/checkpoints/2026-09-27-amadeus-model-capability-final-release.md`.
The known pinned 9Router caveat remains: upstream HTTP 400 is
fallback-eligible, while missing-prompt 400 is rejected before Combo
 dispatch; no 9Router source change was introduced. The Goal is complete.

## Source and architecture

- Canonical `origin/main` contains the prior 1.6.4 released source and the new adapter Goal plan. Candidate source is on `codex/model-capability-adapter-2026-09`; its live image is not yet a final release. Keep source branch, candidate image tag, and release version distinct.
- OpenClaw 2026.9.4 is the **sole Agent runtime**. Native Amadeus/PUBG plugins, deterministic domain/presentation and one owner outbox remain; no retired runtime, keyword router, custom image provider, or sender fallback was introduced.

## Live release and rollback

- Previous released OpenClaw on M204 OrbStack `example-node` CasaOS: `local/openclaw-amadeus:git-b389e869d6a2-20260927084301` (Amadeus 1.6.4); Product Radar `local/product-radar:git-d988000e1c5d-20260924130631`; post-deploy OpenClaw and Product Radar health passed. WhatsApp remains linked. The protected pre-1.6.4 OpenClaw checkpoint is `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927084301` (root chmod 0700; config copy 0600); post-deploy evidence is `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927084301`. The 1.6.3 checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927082000` remains available. Preserve both for rollback.
- The previous released OpenClaw config had default image-generation model `openai/ag/gemini-3.1-flash-image`, a 180-second timeout, and the owner-approved shared `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork=true` opt-in. It reuses the existing `OPENCLAW_9ROUTER_API_KEY` SecretRef/env source. No Google key/path was added. The owner confirmed real image-generation acceptance on 2026-09-27; see the acceptance record below.
- The **same** Mac `com.amadeus.qwen3-tts` LaunchAgent serves the original A (~46s) reference with pinned community MLX 1.7B Base 8-bit ICL, `language=Auto`, one bounded inference worker and `ProcessType=Interactive`. Post-1.6.4 read-only host health is HTTP 200/ready, LaunchAgent PID 50062, last exit 0. The matrix process PID 79839 is no longer present. No TTS service restart occurred; preserve the exact MPS rollback.
- The owner previously accepted real WhatsApp Japanese PTT/nonduplicated visible text/typed-without-voice and confirmed no pronunciation/naturalness/volume/rhythm anomaly after 1.6.2. This remains prior evidence, not post-1.6.3 acceptance.

## 1.6.4 image-generation rollout — owner-accepted

- The previous released 1.6.4 config had the native `image_generate` default path through the existing `openai` provider and 9Router. The bundled provider is loaded; `plugins/amadeus/skills/image-generation/SKILL.md` is eligible. The Skill uses semantic intent, with no fixed phrase router, duplicated model ID, or SOUL/global AGENTS change.
- A direct authenticated transport smoke from the OpenClaw container requested `ag/gemini-3.1-flash-image`, returned HTTP 200 and one JPEG (569,192 bytes), and handled the binary only in memory. This does not prove Agent selection or channel attachment delivery.
- CLI-driven agent turns were not real owner-inbound tests. The fresh explicit CLI session's exact `context.compiled` event offered only `web_fetch` and `web_search`; no `image_generate` call or attachment occurred. A factory reproduction under the configured owner sender rule includes `image_generate`, but this does not prove that CLI path. The owner subsequently confirmed real owner-channel image delivery, typed-text isolation, and inbound voice/TTS acceptance: “已验收 一切正常可以收尾”. Treat that owner attestation as the acceptance evidence; do not treat the CLI-only sessions as proof.
- Post-1.6.4 read-only host TTS health is HTTP 200/ready (LaunchAgent PID 50062, exit 0); no TTS or 9Router restart occurred.

## 1.6.2 stability cleanup release

- The historical 1.5.3 Voice remote branch had only an older Goal document and was retired after main-content comparison. MLX source terminology now says selected community backend, preserving the third-party caveat and explicit MPS rollback.
- Native LaunchAgent was applied with private launchd stderr, truncated above 1 MiB before each bootstrap. The previous native source/plist, protected A profile/token and exact MPS rollback remain outside Git. Same A/MLX/Auto/Interactive engine, model, timeout, worker and format are verified. Port 18792 remains deliberately wildcard for OrbStack/9Router; guest-to-host/LAN-address and authenticated 9Router speech succeeded, unauthenticated synthesis/inventory returned 401. No independent physical LAN peer test was available, so LAN exposure is conservatively assumed.
- A real WhatsApp audio inbound produced one media reply with Japanese TTS and a Chinese visible summary; an ordinary typed inbound produced a text-only reply. The owner replied “确认正常 通过” when asked to verify accepted Kurisu sound, visible text correctness/nonduplication and typed isolation. No Docker/CasaOS rebuild or new voice experiment was run. Protected native recovery and real acceptance: `.agent/checkpoints/2026-09-26-amadeus-1.6.2-stability-release.md`.

## Measured limits and operational watch

- Original single DM baseline: ASR 0.702s, Agent 3.471s, TTS+MP3 35.162s, end-to-end 42.462s. Fixed short HTTP A/MPS Interactive 20-run p50 4.48s/p95 5.28s; A/MLX 20-run p50 3.30s/p95 3.52s. A/MLX normal five-run p50 5.42s. MP3 encode remains minor; direct Opus not selected.
- MLX cold/real `vmmap` peak reached 18.4 GiB on 24 GiB Mac; swap rose from ~3.63 to ~6.75 GiB, reached ~7.03 GiB after a post-release real voice then fell to ~6.31 GiB; sampled memory pressure ~70–80% free. Idle footprint ~3.3 GiB; long-term memory safety is a monitoring gate, not a zero-risk claim. A/MPS before switch had ~9.3 GiB physical footprint. B ~15s reference hit four supervised 110s timeouts; its incomplete cells are explicitly documented, not filled with guessed p95.
- Docker cache patch-only candidate wall 39s→3s; plugin-dist-only 1s with OS/glibc/npm cached. Machine-checkable performance report and numeric data are in `docs/reports/`. Full local gates, immutable CasaOS release/checkpoint and owner notification passed. Known `LOG_POLICY=warning` and optional media adapter absence remain; post-release real WhatsApp owner acceptance and canonical `main` push passed. Four B configs remain safety-incomplete; owner explicitly cancelled further B tests after accepting released A+MLX (Goal §12). The numeric data remains incomplete, not fabricated; the performance Goal is complete as amended. Strict doctor has one known optional media-adapter failure; non-strict doctor exits 0.

Use `docs/CURRENT_TASK.md` for the next action and dated `.agent/checkpoints/2026-09-26-*` for evidence and rollback, not historical diaries as runtime instructions.
