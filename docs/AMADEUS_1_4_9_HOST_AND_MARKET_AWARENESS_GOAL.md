# Amadeus 1.4.9 — Host & Market Awareness

## Status

- Target version: `1.4.9`
- Base branch: `main`
- Planning base SHA: `744379e039238548d5bdeaff400f6054a8e24daa`
- Workstation authority: `Amadeus-M204`
- Old Mac: rollback-only; no new feature work

## Mission

1. Restore deterministic macOS host observability on `Amadeus-M204` so Kurisu can inspect the real macOS host rather than only the OrbStack guest.
2. Replace the existing Yahoo Finance market source with Longbridge OpenAPI using OAuth 2 as the sole market-data authority.
3. Upgrade market tools so OpenClaw can answer natural-language public market questions in DM/group contexts without keyword-routing logic.
4. Redesign market opening/closing notifications for strong visual direction, deterministic numeric formatting, and exchange-session-aware delivery.
5. Keep OpenClaw as the only Agent runtime. Longbridge and MacHostAgent are deterministic capabilities, not planners or second agents.

## Architectural invariants

```text
OpenClaw / Kurisu = reasoning, intent, planning, wording
Longbridge        = market numeric truth
Market domain     = deterministic normalization/calculation
Presentation      = deterministic formatting
MacHostAgent      = deterministic read-only macOS telemetry
```

Do not add Mastra/LangGraph/n8n routing. Do not add keyword-driven intent dispatch. Entity aliases are allowed only for deterministic symbol normalization after OpenClaw has already selected the market capability.

## Hard boundaries

- `MARKET_PROVIDER=longbridge`
- `MARKET_PROVIDER_COUNT=1`
- `MARKET_FALLBACK_PROVIDER=none`
- Remove Yahoo market transport/parser/config/tests that are only Yahoo-specific.
- Never silently fall back to another market provider.
- Do not register any Longbridge trading/account tools in 1.4.9.
- No order placement, modification, cancellation, positions, balances, account history, or private portfolio data.
- Public group chats may access public market data only.
- Host telemetry is owner/private capability unless an existing explicit authorization contract says otherwise.
- No arbitrary shell-exec endpoint in MacHostAgent.
- No broad sudo capability for OpenClaw.

## Current code to evolve, not duplicate

The repository already has `plugins/amadeus/src/market.ts`, `amadeus_market_indices`, market notification integration, deterministic previous-close/change calculations, and market tests. Evolve these paths instead of creating a parallel notification system.

Current market implementation uses Yahoo Finance Chart API and `MARKET_DATA_BASE_URL`; 1.4.9 must remove that provider-specific dependency and preserve the useful domain semantics and event idempotency.

## Phase 1 — Longbridge OAuth 2 runtime

Use Longbridge OpenAPI OAuth 2 as the sole market authentication mode.

Requirements:

- Initial authorization is an operator action on M204, not an interactive OpenClaw startup step.
- Persist OAuth state outside Git.
- Container/service restarts must reuse persisted authorization without browser interaction while the refresh state remains valid.
- Expose deterministic auth states such as `ready`, `reauth_required`, and `unavailable`.
- OAuth tokens, refresh material, client secrets, authorization codes, and account identifiers must never appear in logs, checkpoints, presentations, Git, or test fixtures.
- Define disaster-recovery behavior explicitly: either protected OAuth state is backed up safely, or reauthorization is the documented restore path. Do not pretend unsupported token portability exists.

The implementation may use an official Longbridge Node SDK or a small dedicated local adapter, but credentials and refresh lifecycle must remain outside the LLM-visible surface.

## Phase 2 — Longbridge-only market domain

Refactor the market module into clear deterministic responsibilities, for example:

```text
plugins/amadeus/src/market/
├── auth.ts
├── client.ts
├── symbols.ts
├── normalize.ts
├── service.ts
├── presentation.ts
└── types.ts
```

Exact filenames may differ if the existing repository structure suggests a cleaner fit.

Required domain operations:

- quote/current market observation
- index overview
- intraday/day range
- market status/session
- trading days/sessions
- market temperature when supported by Longbridge
- industry ranking/movers when supported by Longbridge
- index constituents when required by a user query

All calculations used in answers or notifications must be deterministic:

- previous-close change
- change percent
- intraday range/position
- direction
- numeric precision
- session state

The LLM must not calculate market percentages from raw numbers when a domain calculation can provide them.

When Longbridge is unavailable, return a truthful structured failure such as `longbridge_unavailable` or `longbridge_oauth_reauthorization_required`. Do not query Yahoo or another hidden fallback.

## Phase 3 — Symbol/entity normalization

Support at least:

```text
Nasdaq Composite  -> .IXIC.US
Nasdaq-100        -> .NDX.US
S&P 500           -> .SPX.US
Dow Jones         -> .DJI.US
```

Also support explicit normal equity symbols such as `AAPL.US`, `NVDA.US`, `AMD.US`, and `TSLA.US`.

Chinese aliases may normalize entities after tool selection, for example `纳指` or `标普`, but this must not become message keyword routing. OpenClaw decides that a market lookup is needed; the domain resolves the requested instrument.

## Phase 4 — OpenClaw market capabilities

Preserve backwards compatibility for the existing scheduled market workflow where practical, while adding higher-level public-market tools.

Target capability surface:

```text
amadeus_market_overview
amadeus_market_quote
amadeus_market_intraday
amadeus_market_session
amadeus_market_movers
```

The exact number of tools may be reduced if one structured tool can express the same semantics without becoming an unbounded generic API proxy.

The tools should make natural follow-ups possible through conversation context:

```text
“今天纳斯达克怎么样？”
“那纳指100呢？”
“标普呢？”
“AMD今天如何？”
“美股现在开盘了吗？”
“今天什么行业涨得最好？”
```

Do not expose Longbridge's raw API surface directly to OpenClaw.

## Phase 5 — Market Presentation V2

Replace raw unformatted numbers in market notifications with a deterministic presentation contract.

Required formatters:

- price/index value with grouping and controlled decimals
- signed absolute change
- signed percentage
- compact volume/turnover where relevant
- direction glyph

Direction contract:

```text
▲ positive
▼ negative
— effectively flat
```

Examples:

```text
26936.03728 -> 26,936.04
308.2382    -> +308.24
-308.2382   -> -308.24
1.131428%   -> +1.13%
-1.131428%  -> -1.13%
2837481234  -> 2.84B
```

Do not use notification severity to encode market direction. A falling market is not an application error and a rising market is not an application success.

Target readable layout:

```text
🌙 美股收盘 · 09/24

NASDAQ
26,936.04
▼ -308.24  (-1.13%)

S&P 500
7,706.03
▼ -58.61  (-0.75%)

DOW
51,511.59
▼ -352.10  (-0.68%)
```

Use the repository's existing presentation/notification pipeline; do not create a parallel renderer.

## Phase 6 — Opening/closing push V2

Keep stable event identity/idempotency semantics.

Opening push should prioritize:

- index value
- change from prior close
- direction
- optional market temperature

Closing push may additionally include:

- day range
- industry leaders/laggards when available
- concise deterministic summary facts

All push data must come from Longbridge.

## Phase 7 — Session-aware market scheduling

Longbridge trading-day/session/status data becomes the authority for whether a market event is valid.

Correctly handle:

- weekends
- US exchange holidays
- DST changes
- early closes
- special sessions

Do not treat fixed Beijing clock times as market truth.

Reuse the current scheduler/trigger mechanism if it can be made session-aware. Replace the scheduler only if the existing mechanism cannot represent early-close or exchange-calendar behavior cleanly.

The scheduler should trigger checks; the market domain decides whether an opening/closing event is valid and the stable event key prevents duplicates.

## Phase 8 — Restore M204 MacHostAgent

Restore a host-native read-only telemetry capability on macOS `Amadeus-M204`.

The agent runs on macOS, not inside OrbStack, because it must report the real host.

Target observations:

- CPU utilization and load
- memory usage / memory pressure
- uptime
- internal disk state
- Avalon capacity/state
- network summary
- top CPU/memory processes
- macOS power state
- selected host service health
- Apple Silicon CPU/GPU/ANE/package power and temperature when safely obtainable

Prefer deterministic bounded collectors using macOS-native interfaces (`sysctl`, `vm_stat`, `ps`, `diskutil`, `pmset`, and a bounded `powermetrics` helper where permitted).

Power/temperature collection may degrade independently. Lack of `powermetrics` privilege must not mark the whole host agent unhealthy.

Security requirements:

- authenticated local/LAN access according to the existing HomeLab trust model
- no generic `/exec`
- no arbitrary command parameters
- no arbitrary sudo from OpenClaw
- least-privilege helper for privileged telemetry if required
- bounded output and timeouts

The service must be launchd-managed and survive M204 reboot.

## Phase 9 — OpenClaw host tools

Expose bounded host telemetry tools, for example:

```text
amadeus_macos_host_status
amadeus_macos_host_processes
```

Do not expose the collector implementation details or shell execution.

Expected user experiences:

```text
“M204 现在 CPU 多少？”
“现在功耗多少？”
“Avalon 还有多少空间？”
“谁最占 CPU？”
```

Facts must come from MacHostAgent; OpenClaw only narrates them.

## Phase 10 — Authorization boundary

Verify these policy outcomes:

```text
Group public market quote/overview       ALLOW
Owner DM public market data              ALLOW
Group private Longbridge account data    ABSENT
Owner private Longbridge account data    ABSENT in 1.4.9
Trading actions                          ABSENT
Owner M204 host telemetry                ALLOW
Untrusted group host telemetry           DENY unless explicitly authorized
```

Do not rely only on prompt wording; ensure sensitive/trading capabilities are not registered.

## Phase 11 — Tests and release gate

Add/retain tests for:

- Longbridge response normalization
- OAuth `ready` / `reauth_required` / unavailable states
- secret/token redaction
- non-interactive restart after authorization
- deterministic previous-close change and percent
- index and equity symbol normalization
- price/change/percent/volume formatting
- direction glyphs
- market closed/holiday/DST/early-close behavior
- event-key idempotency
- no Yahoo market runtime/config dependency
- no trading/account tools registered
- public group market access boundary
- MacHostAgent schema and authentication
- Avalon host telemetry
- degraded power telemetry mode
- absence of arbitrary exec
- launchd persistence artifacts

Use targeted validation during implementation and one full release gate at the release boundary.

Required final repository validation should include the project's normal build/typecheck/test/doctor/release checks.

## Phase 12 — M204 live acceptance

After repository implementation is committed and pushed:

1. Set `VERSION=1.4.9`.
2. Deploy on M204 only.
3. Complete Longbridge OAuth authorization as an explicit operator action.
4. Verify restart persistence without reauthorization.
5. Verify live quotes for the four index families and at least one US equity.
6. Preview opening and closing notifications without generating duplicate live events.
7. Verify a real market-status/session response.
8. Verify MacHostAgent values against macOS locally.
9. Restart relevant services and confirm recovery.
10. Record compact sanitized evidence.

Live acceptance prompts should include:

```text
今天纳斯达克怎么样？
那纳指100呢？
标普呢？
AMD今天如何？
美股现在开盘了吗？
今天什么行业涨得最好？

M204现在CPU多少？
现在功耗多少？
Avalon还有多少空间？
谁最占CPU？
```

Acceptance must prove that OpenClaw selects tools through normal reasoning/context, not a new hardcoded keyword router.

## Migration/removal work

Remove the old Yahoo-specific market path once Longbridge tests are in place:

- Yahoo Finance Chart API transport
- `MARKET_DATA_BASE_URL`
- `readChart()` and Yahoo parser logic
- Yahoo-specific fixtures/tests that no longer express provider-neutral domain behavior
- curl dependency used only by Yahoo market fetching, if no other code needs it

Preserve useful domain semantics, notification event IDs, and regression coverage.

## Non-goals for 1.4.9

- Brokerage trading
- Portfolio/position/balance queries
- Order management
- Investment recommendations
- Multiple market providers or automatic fallback
- News aggregation/reason attribution
- Replacing OpenClaw as the Agent runtime
- Reworking the 1.4.8 migration/cutover architecture
- Bringing the old Mac back as a development authority

## Required final evidence

```text
VERSION=1.4.9
BASE_SHA=744379e039238548d5bdeaff400f6054a8e24daa
WORKSTATION_AUTHORITY=Amadeus-M204
OLD_MAC_NEW_WORK=disabled

MARKET_PROVIDER=longbridge
MARKET_PROVIDER_COUNT=1
MARKET_FALLBACK_PROVIDER=none
LONGBRIDGE_AUTH_MODE=oauth2
LONGBRIDGE_AUTH=verified
YAHOO_MARKET_CODE=removed
MARKET_NUMERIC_TRUTH=longbridge

MARKET_PUBLIC_GROUP_SCOPE=verified
MARKET_ACCOUNT_CAPABILITY=absent
MARKET_TRADING_CAPABILITY=absent

MARKET_PRESENTATION_V2=verified
MARKET_OPEN_PUSH_V2=verified
MARKET_CLOSE_PUSH_V2=verified
MARKET_SESSION_AWARE=verified
MARKET_EVENT_IDEMPOTENCY=verified

MAC_HOST_AGENT=healthy
MAC_HOST_AGENT_HOST=Amadeus-M204
MAC_HOST_AGENT_MODE=read-only
MAC_HOST_ARBITRARY_EXEC=absent
MAC_HOST_POWER_TELEMETRY=supported|degraded
```

## Definition of Done

1. Longbridge OAuth 2 is the sole market-data authority and survives normal restarts.
2. Yahoo market code/config/runtime dependency is removed.
3. Kurisu can answer natural-language public market questions through bounded market tools.
4. Opening/closing notifications are visually readable and deterministically formatted.
5. Market-event validity is exchange-session aware rather than fixed-clock truth.
6. Public groups can query public market data without gaining account/trading capabilities.
7. M204 host observability is restored through a read-only native MacHostAgent.
8. Host telemetry never grants OpenClaw arbitrary macOS command execution.
9. All tests and final release gates pass on the M204 workstation authority.
10. Sanitized evidence is committed, with no OAuth/token/private market-account material exposed.
