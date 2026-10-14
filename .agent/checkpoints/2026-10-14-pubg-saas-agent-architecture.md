# PUBG SaaS conversational Agent source checkpoint — 2026-10-14

## Scope

Correct the public KOOK SaaS interaction architecture before M2 human
acceptance. Replace the ordinary-message classifier path with a Vercel AI SDK
`ToolLoopAgent`; keep PG, KOOK Gateway/Inbox/Outbox, the single shared PUBG
Domain, server authorization and the private Kurisu runtime unchanged.

## Source result

- Every trusted non-bot group text event reaches the Agent after ingress
  limits, regardless of topic, command syntax, bot mention or team binding.
- Ordinary chat can return directly. PUBG queries use constrained Agent tools
  over the existing `QueryPlanSchema` and `QueryPlanExecutor`; the model can
  call several tools and then summarize results. Tool calls use no model-chosen
  tenant/team/user/channel/session/recipient identifiers.
- The schema/executor expose Domain `meleeKind` filters for KICK, PUNCH and
  OTHER while preserving coverage, asOf, partial data and evidence references.
- A bounded 12-turn/6,000-character channel history (12-hour retention)
  includes speaker labels and message-reference links. Per-user query sessions
  remain isolated. KOOK mention IDs are redacted from model input, stored Agent
  history and model-facing write-tool output. Trusted mention IDs stay only in
  the server-side authorization path.
- Migrations `0015_kook_agent_conversation.sql` and
  `0016_agent_authorization_outcomes.sql` add bounded context and explicit
  authorization-denial outcomes. Safe state distinguishes model fallback,
  Domain/tool degradation, authorization denial, outbox quota exhaustion and
  outbound send failures.
- Existing deterministic `/pubg` operations and confirmation flows remain.
  The removed phrase-based write-intent parser is no longer a parallel main
  path.

## Verification

- `pnpm test:pubg-saas`: 126/126 passed using the already-running isolated
  PostgreSQL test instance.
- `pnpm test:pubg`: 68/68 passed, including shared Domain and private Kurisu
  plugin regression. No private runtime was started or changed.
- `pnpm typecheck:pubg-saas`: passed.
- `pnpm --filter @agent/pubg-saas build`: passed.
- Focused Agent/ingress, binding, query executor, authorization and quote tests
  passed during implementation.

## Current limits

- No KOOK credentials or PUBG/model provider credentials were loaded for this
  source validation. No live PUBG call or model request was sent.
- No real KOOK group message was sent. Arthur's real test-server experience
  remains the M2 acceptance gate; M2 is not complete.
- No M204 runtime was replaced and no image was built or pushed. The public
  M204 stack still runs the previously recorded `da03953` gateway/worker
  image. The default SaaS outbound budget remains 200 messages per bot/day;
  live remaining allowance and developer-account eligibility were not queried.
- No 200-team load test or unrelated scale work was run.

## Reproduction

```sh
PUBG_SAAS_TEST_DATABASE_URL='<isolated PostgreSQL test URL>' \
  pnpm test:pubg-saas
pnpm test:pubg
pnpm typecheck:pubg-saas
pnpm --filter @agent/pubg-saas build
```

The test suite applies migrations to its isolated database. Production or M204
databases must be migrated separately before any future authorized release.
