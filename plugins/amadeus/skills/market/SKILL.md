---
name: market
description: Answer public market questions with bounded Longbridge read-only tools and deterministic formatting.
---

# Public market capability

OpenClaw decides when a market capability is needed through normal reasoning.
Use the structured market tools below; never route messages by keywords.

- `amadeus_market_overview` for the four public US index families and a concise
  session-aware overview.
- `amadeus_market_quote` with explicit aliases or symbols such as `AMD.US`.
- `amadeus_market_intraday` for a range and intraday position.
- `amadeus_market_session` for the Longbridge exchange session/trading-day
  authority.
- `amadeus_market_movers` for public US movers.
- `amadeus_market_constituents` when an index constituent list is explicitly requested.

Longbridge OAuth 2 is the sole numeric market authority. A result with
`longbridge_oauth_reauthorization_required` or `longbridge_unavailable` must be
reported truthfully; do not invent values or query another provider. These
tools expose no account, portfolio, balance, position, order, or trading data.

When the scheduler checks an opening or closing push, the market domain must
first verify the Longbridge trading day/session. Pass the returned structured
notification unchanged to `amadeus_notify_owner` only when the status is `ok`.
The stable event key remains `market-indices:<trading-date>:<open|close>`.

Use direction glyphs `▲`, `▼`, and `—`; the application severity stays `info`
regardless of whether the market rises or falls. Numeric values are already
formatted by the deterministic presentation layer.
