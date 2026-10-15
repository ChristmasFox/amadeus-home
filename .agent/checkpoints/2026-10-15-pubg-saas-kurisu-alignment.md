# PUBG SaaS Kurisu alignment — 2026-10-15

## Source follow-up — KOOK channel message adapter

The public transport boundary now centralizes KOOK message type selection,
payload validation, format conversion and long-message splitting in
`apps/pubg-saas/src/channels/kook/message-adapter.ts`; Agent and Domain layers
do not apply a KOOK-specific response-length limit. KOOK's message API gives
one 8,000-character `content` limit for both plain text and KMarkdown. Card
elements separately allow 2,000 characters for `plain-text` and 5,000 for
`kmarkdown`. See the [official message API](https://developer.kookapp.cn/doc/http/message),
[KMarkdown reference](https://developer.kookapp.cn/doc/kmarkdown), and
[CardMessage reference](https://developer.kookapp.cn/doc/cardmessage).

The adapter maps Markdown headings and unordered lists to supported KMarkdown
forms, converts WhatsApp-style `_italic_`/`~strike~` and single-star bold,
preserves KOOK-supported `:emoji:` shortcuts and Unicode emoji, and turns
neutral numeric `<@id>` / `<@!id>` tokens into native `(met)id(met)` mentions.
Non-HTTP(S) Markdown links remain visible as label plus address. Long replies
split on paragraph, newline and word boundaries; link and mention tokens are
kept whole; inline emphasis and quotes are reopened in continuation messages;
large fenced code blocks are split by lines and each outbox part has a complete
fence. Existing outbox ordering holds later parts until an earlier part is
sent, with durable retry and safe failure diagnostics.

The focused sender/adapter suite passes 13/13; full SaaS/PostgreSQL tests pass
155/155 with no skips; PUBG/Kurisu tests pass 71/71 with no skips. SaaS build,
typechecks, architecture checks, secrets scan, and diff checks pass. The source
commit `0d5de29b5f61049aebaeb255312e39ad6c6a1a5b` is pushed to `origin/main`.
The amd64/arm64 OCI build passed manifest verification; the local M204 ARM64
image is `local/pubg-saas:git-0d5de29b5f61049aebaeb255312e39ad6c6a1a5b`
(`sha256:ca562817734eeb8f4dc4c68e1febf247c857401a4676a2cb1c9ed58770486c8d`).
Only Gateway and Worker were replaced. Gateway is running with zero restarts;
Worker is healthy with zero restarts. KOOK session state is present at
`last_sn=76` (`2026-10-15T04:43:36.455Z`), and the inspected 10-minute
structured error count is zero for both services. PostgreSQL, egress-proxy,
and SaaS 9Router IDs are unchanged. No registry push occurred. The mode-0600
pre/post rollback records are:

- `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-0d5de29-pre-switch`
- `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-0d5de29-post-switch`

No private OpenClaw/Kurisu/9Router resource changed. Arthur's KOOK acceptance
remains pending; M2 is not complete.

## Latest follow-up — remove SaaS-only quotas and conversation expiry

Arthur authorized removing the public-only daily sender quota, ingress
per-user/channel/tenant/bot requests-per-minute gates, and the 12-message /
6,000-character / 1,600-character-per-row / 12-hour conversation caps. Runtime
quota reservations are gone; the historic 0011 database migration remains in
sequence for upgrade compatibility and is no longer used by Gateway/Worker.
Conversation and query sessions now persist; they remain isolated by KOOK
channel or DM actor. Persisted history never grants access: each tool call
still validates the live trusted event, actor, tenant, team, channel binding,
roster and revisions.

For KOOK's 8,000-character per-message transport limit, text/kmarkdown replies
are split into ordered outbox rows without truncation; mention markup is kept
whole. Provider bucket/global headers and actual 429 retry behavior remain.
The explicit eight-player cap, write authorization/redaction, 300-second
overall Agent timeout and shared-key `/players` 10/minute admission remain;
`/matches` is not admitted through that limiter. A 1,000-item total pending
queue capacity remains as a durable-backlog safety boundary, with no
per-user-pending cap.

Source verification passed: `pnpm test:pubg-saas` 150/150 against isolated PG,
zero skipped; `pnpm test:pubg` 71/71, zero skipped; PUBG/SaaS typechecks, SaaS
build, architecture checks, `pnpm check:secrets`, and `git diff --check` all
passed. Focused PG regressions prove 11 events from one user/minute are
accepted, more than 12 old messages and 6,000 characters load into context,
past-expiry query context remains authorized only under current scope, 205
outbound sends do not hit a local daily quota, and a 17,000-character reply is
delivered in ordered chunks.

Commit `83c1bcc761842676ec750708a43f8d0f33e9d39a` is pushed to `origin/main`.
The locally built ARM64 image is
`local/pubg-saas:git-83c1bcc761842676ec750708a43f8d0f33e9d39a` (image ID
`sha256:e30b16c473b4f9c1ce183271fe43060001f367f9e052050b5f57ab5c52bd14d9`).
Migrations 0017–0020 are applied; only Gateway and Worker were replaced.
Gateway runs with zero restarts and Worker is healthy with zero restarts. KOOK
session resumed at `last_sn=74`, updated
`2026-10-15T04:20:45.338Z`; recent gateway and worker error-record counts are
zero. PostgreSQL, egress-proxy and SaaS 9Router are unchanged. No image was
pushed, no production deployment was made, and no private runtime or config
was touched. Arthur's KOOK acceptance remains pending; M2 is not complete.

Protected mode-0600 rollback records:

- Pre-switch: `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-83c1bcc-pre-switch`
- Post-switch: `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-83c1bcc-post-switch`

## Outcome

Commits `83c1bcc761842676ec750708a43f8d0f33e9d39a`,
`e355b2ef673662b60757b69966c73768e89830e5`,
`6a9171fe10ff5948b421bf6c6cf973704e82f0cd`,
`f47783d5869071224486d0c26b580eb7ebb835de`, and
`66e1006b04b8726f50a80a15c3b0024d049228f0` are on `origin/main`; follow-up
commit `122cd79` is also pushed. M204 currently runs ARM64 image
`local/pubg-saas:git-83c1bcc761842676ec750708a43f8d0f33e9d39a`
(image ID `sha256:e30b16c473b4f9c1ce183271fe43060001f367f9e052050b5f57ab5c52bd14d9`).
Only Gateway and Worker were recreated for this follow-up. PostgreSQL,
egress-proxy, SaaS 9Router, nyannyan, private OpenClaw, private 9Router, and
Kurisu were not changed.

## Root cause and code changes

The live Worker had `PUBLIC_SYNC_MAX_MATCHES=10` in the ignored
`infra/pubg-saas/secrets/worker.env`. That let the lexically first account's
recent matches fill the whole discovery set. The override was removed and the
canonical Compose value is now 500, matching the private plugin's configured
`maxMatches`. `packages/pubg-domain` now selects newest-first match IDs in a
round-robin across team members before applying a cap. This fixes starvation
without changing the shared match/domain algorithms otherwise.

The Agent now receives the complete sanitized Domain envelope plus shared
presentation and display text, including match/review facts. The former facts
whitelist, match/evidence truncation, fixed step count, and per-step token cap
are gone. Tool/API calls use shared Domain retry/timeout/concurrency defaults.
Only rate-limited `/players` discovery uses public admission. A review of
66e1006 found it had also gated `/matches`; follow-up `122cd79` removed that
extra gate to match Kurisu and PUBG endpoint policy. Endpoint allowlisting,
redirect rejection, and telemetry's no-authorization rule remain.
The overall Agent deadline remains 300 seconds; completed tool results are
summarized if the loop times out. Internal IDs, private data, and diagnostics
remain excluded from model-visible facts.

## Current public/Kurisu differences and reasons

- **Runtime and storage:** public SaaS uses KOOK Gateway/Worker plus PostgreSQL
  and separate public model configuration; private Kurisu uses its OpenClaw
  plugin and SQLite. This is the required product and tenant boundary.
- **Tenant and write authorization:** every public PUBG tool call is checked
  against current trusted KOOK event, tenant, team, user, channel binding,
  roster and revision; writes use server-side permission checks and secret
  redaction. This is required multi-tenant security.
- **Team size:** public teams cap at 8 players, as Arthur explicitly required.
- **PUBG player discovery:** public `/players` calls use a shared public-service
  10/minute admission gate because the PUBG key has a limited quota; `/matches`
  bypasses it, matching PUBG/Kurisu semantics. The limiter is not shared with
  the independent Kurisu process.
- **KOOK sender transport:** there is no local 200/day budget. Actual KOOK
  response bucket/global headers and 429 guidance control delivery. The single
  channel adapter enforces the official 8,000-character message content limit
  for both plain text and KMarkdown, and the separate card-element limits of
  2,000 plain-text / 5,000 KMarkdown characters. It converts portable Markdown
  headings/lists and WhatsApp emphasis, preserves KOOK emoji, maps numeric user
  mentions, and splits long messages at natural boundaries while keeping
  formatting structures intact. Ordered durable outbox retries keep chunks in
  sequence. These are KOOK transport/API differences; they do not cap Agent or
  Domain output.
- **Conversation retention:** public text history and query session context are
  persistent, grouped by channel or DM actor, with no row-count, character, or
  12-hour expiry cap. This matches the inspected private session scope
  configuration; private memory, DMs and user files are not imported. Public
  authorization is rechecked per request.
- **Durable queue mechanics:** public ingress admits up to 1,000 pending events
  globally (not per user), expires unhandled request payloads after one hour,
  retries with leased/idempotent outbox delivery, and prunes completed outbox
  metadata after seven days. Model usage metadata is kept for 30 days. These
  are multi-process durable-queue and operational-record mechanics; they do
  not truncate retained conversation history or grant authority.
- **Agent deadline:** 300 seconds overall, as Arthur explicitly required; the
  high runaway guard is 128 steps, enough for the eight-player query workflow.
- **Domain behavior:** time windows, match discovery/search, coverage, review,
  statistics, telemetry semantics and cache behavior are the shared PUBG
  Domain implementation. No second public statistics algorithm exists.
- **Tool interface/persona:** public Agent exposes KOOK-oriented generic tools
  and a public-safe SOUL excerpt; Kurisu exposes native OpenClaw tools. Replies
  remain model-generated in each runtime. Private memories, user data and
  private nickname mappings are excluded from the public Agent.

## Validation

- Current source: `pnpm test:pubg-saas` passed 150/150 with zero skipped against
  the reused isolated PostgreSQL test instance; `pnpm test:pubg` passed 71/71
  with zero skipped.
- `pnpm typecheck:pubg`, `pnpm typecheck:pubg-saas`,
  `pnpm build:pubg-saas`, `pnpm check:architecture`,
  `pnpm test:architecture`, `pnpm check:secrets`, and `git diff --check` passed.
- Full isolated-PG regressions include no per-minute ingress rejection,
  persistent context beyond the old caps/expiry, no local 200-message sender
  quota, and ordered split delivery for overlong replies.
- M204 build/rollout evidence will be recorded after the authorized switch.

## Previous rollout evidence — 122cd79

Only Gateway and Worker were replaced for the previous app-only switch. The
container IDs from that switch are recorded in
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-122cd79-post-switch.txt`.
Worker and Gateway have zero restarts; Worker is healthy and Compose reported
Gateway healthy. The KOOK session cursor is `last_sn=72`, updated at
`2026-10-15T03:36:45.536304Z`. Gateway and Worker had zero error/fatal-level
JSON log entries in the inspected 10-minute window.

Within the channel-bound team, the discovered-match index contains 132 IDs.
The following records are persisted and discovered (Asia/Shanghai):

- `2026-10-14 21:07:10` — competitive duo, SG_LabmemNo004 + kim_kkl.
- `2026-10-14 23:01:13` — competitive squad, SG_LabmemNo004 + kim_kkl + SG_LabmemNo008.

No migration ran, and PostgreSQL, egress-proxy, and SaaS 9Router were not
recreated. No private runtime or config was touched. Arthur's real KOOK
acceptance remains pending; M2 is not complete.

## Rollback

Protected target records, mode 0600:

- Pre-switch: `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-83c1bcc-pre-switch`
- Post-switch: `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-83c1bcc-post-switch`

To roll back this correction, restore the pre-switch `.env` and compose file,
validate Compose, then run only:

```sh
docker compose up -d --no-deps --force-recreate --no-build --wait gateway worker
```

No database downgrade is needed; migrations 0017–0020 are additive, and the
previous `local/pubg-saas:git-122cd79` image remains available on M204.
