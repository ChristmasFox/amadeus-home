# PUBG SaaS Kurisu alignment — 2026-10-15

## Outcome

Commits `e355b2ef673662b60757b69966c73768e89830e5`,
`6a9171fe10ff5948b421bf6c6cf973704e82f0cd`,
`f47783d5869071224486d0c26b580eb7ebb835de`, and
`66e1006b04b8726f50a80a15c3b0024d049228f0` are on `origin/main`.
M204 runs ARM64 image
`local/pubg-saas:git-66e1006b04b8726f50a80a15c3b0024d049228f0`
(image ID `sha256:c2274bf0f79343632cf128e80491579b2f9441232b741583e23b3f8a16423054`).
Only Gateway and Worker were recreated. PostgreSQL, egress-proxy, SaaS 9Router,
nyannyan, private OpenClaw, private 9Router, and Kurisu were not changed.

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
All authenticated official PUBG API requests use the public admission gate.
The overall Agent deadline remains 300 seconds; completed tool results are
summarized if the loop times out. Internal IDs, private data, and diagnostics
remain excluded from model-visible facts.

## Limit audit

No public-only query-result or facts cap remains. Domain-owned limits and rules
are shared with Kurisu: match discovery default 500; match search page size up
to 50 and latest-match request up to 100; review search freshness; coverage and
cache behavior; telemetry fetch default and concurrency; and `Asia/Shanghai`
06:00 business-day selection. No custom step or per-step token limit is on the
Agent path. The legacy planner class retains limits for its isolated tests and
benchmark only; Gateway does not construct or call it.

The following public-runtime differences remain:

- Public persistence and execution use PostgreSQL, an independent KOOK Gateway,
  and a Worker; Kurisu uses its own SQLite and OpenClaw plugin. This is the
  required runtime and tenant-isolation boundary.
- The public server validates each tool call against trusted KOOK event,
  tenant, channel, member, and roster state, and sanitizes internal IDs and
  debug/private fields before model use. This is required multi-tenant
  authorization and privacy; it does not change Domain facts.
- Teams are capped at 8 players and all writes require server-side permission
  checks. Arthur explicitly required both.
- Public PUBG API traffic is gated at 10 requests/minute across the SaaS
  service. Arthur previously required a limit while sharing the PUBG API key
  with Kurisu; the separate processes do not have a cross-runtime shared
  limiter, so this gate limits SaaS traffic but does not reserve Kurisu's share.
- KOOK outbound sends have a 200-message per-bot daily budget, resetting at
  noon Asia/Shanghai. This follows KOOK's published unverified-developer bot
  eligibility ceiling; KOOK response headers also govern actual send limits.
- Ingress defaults are 10 requests/user/minute, 60/channel/minute,
  120/tenant/minute, and 300/bot/minute, with 1,000 pending total and 20 per
  user. These implement Arthur's earlier group/user throttle and cost-control
  requirement and protect the public queue from loops or overload.
- Conversation context uses at most the most recent 12 messages and 6,000
  characters, stores an individual conversation message at up to 1,600
  characters, and retains group/DM conversation text for 12 hours. Arthur
  required finite recent channel context; bounded retention and no shared
  Kurisu memory are privacy requirements.
- KOOK inbound message validation caps content at 8,192 characters and
  outbound payloads at 8,000 characters. These are KOOK transport boundaries.
- The independent public Worker schedules up to 2 teams per worker cycle and
  syncs every 300,000 ms; the cadence matches Kurisu's configured five-minute
  freshness. Team concurrency is Worker scheduling, with no equivalent
  background multi-tenant scheduler in the private plugin.
- Public ingress/outbox and authorization use expiring leases, deduplication,
  retry attempts, and query-session TTLs to prevent stale writes and duplicate
  delivery in a multi-process service. Those are PostgreSQL queue/security
  mechanics, not PUBG time or reporting semantics.
- The public Agent exposes a generic `pubg_query` and `team_info` tool surface;
  Kurisu registers several native PUBG tools. Both route to the same Domain
  operations and retain their own model prompt/reply style. The surface
  difference is the KOOK adapter boundary, not a second Domain implementation.

## Validation

- `pnpm test:pubg-saas`: 150/150 passed, zero skipped, against the reused
  isolated PostgreSQL test instance.
- `pnpm test:pubg`: 71/71 passed, zero skipped.
- PUBG/SaaS typechecks and builds, `pnpm check:architecture`,
  `pnpm check:secrets`, and `git diff --check` passed.
- ARM64 build succeeded locally on the target VM; no image was pushed.

## M204 rollout evidence

Only Gateway and Worker were replaced. The final container IDs are recorded
in `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-66e1006-post-switch.txt`.
Worker and Gateway have zero restarts; Worker is healthy and Compose reported
Gateway healthy. The KOOK session cursor is `last_sn=72`, updated at
`2026-10-15T03:27:14.890493Z`. Gateway and Worker had zero error/fatal-level
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

- Pre-switch: `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-66e1006-pre-switch.txt`
- Post-switch: `/var/tmp/pubg-saas-m2-clean/checkpoints/20261015-pubg-saas-66e1006-post-switch.txt`

To roll back, restore
`PUBG_SAAS_IMAGE=local/pubg-saas:git-f47783d5869071224486d0c26b580eb7ebb835de`
in the protected target `.env`, validate Compose, then run only:

```sh
docker compose up -d --no-deps --force-recreate --no-build --wait gateway worker
```

No database downgrade is needed.
