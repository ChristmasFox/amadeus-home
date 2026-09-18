---
name: pubg
description: "Use deterministic PUBG match statistics and evidence-backed review tools."
user-invocable: false
---

# PUBG

Use the PUBG tools for match statistics and review. Let the model resolve the
user's natural-language request; do not invent a tool call when the request is
ambiguous or asks for a capability outside PUBG. These rules are scoped to
PUBG requests and must not limit Kurisu's other native capabilities.

Tool rules:

- Never invent match IDs, players, metrics, telemetry facts, coverage, or
  timestamps. Use the native tools as the only source of PUBG facts.
- Resolve a person before a person-specific PUBG query. For “我”, call
  `identity_resolve` with `reference=self`; for a nickname or mention, resolve
  the group-scoped/global alias or trusted mention first. Pass the returned
  canonical `personId` as `personIds` to the PUBG tool, or pass an explicit
  PUBG account returned by the identity/PUBG tools.
- Never treat the configured team as an implicit subject for a sender. If
  `identity_resolve` returns `unbound`, `ambiguous`, or `candidate`, stop and
  explain that identity must be bound or confirmed. `team=true` is the only
  explicit request for the configured team.
- A transport sender name is never a PUBG name. Never use WhatsApp/Telegram
  display names, profile names, push names, phone numbers, JIDs, or quoted
  sender labels as `playerNames`. If the user explicitly gives an in-game name
  or alias, use `pubg_resolve_players` before the player-specific query.
- In a group or DM, “我” always means the current trusted channel sender. Do
  not derive a Person or PUBG account from a display name, phone number, JID,
  quoted label, or nickname alone.
- Use `pubg_search_matches` to find a concrete match before requesting a
  Telemetry review. Pass the returned `matchId` to `pubg_get_review_facts`.
- Use `pubg_query_stats` for bounded aggregates. Prefer an explicit selector:
  `time_range` uses the half-open interval `[from,to)` and IANA timezone
  `Asia/Shanghai` unless the user specifies another timezone; `last_n_matches`
  is bounded to at most 100 matches per call.
- For a clock split repeated across multiple calendar days, make each day's
  before/after windows explicit half-open intervals and keep them separate;
  never use `groupBy: day` over a widened range that contains both sides of the
  clock boundary, because that double-counts full days and cannot prove a
  before/after comparison.
- Use `pubg_compare_stats` only with two explicit segments. A comparison ratio
  is `null` when its denominator is zero or unknown; never turn it into zero or
  infinity.
- Treat `null` as unknown. Never convert unknown deaths, assists, ratios, or
  coverage gaps into zero or a confident conclusion. Preserve the requested
  business-day boundary when resolving a date or clock-based selector.
- Use `pubg_get_match` for the selected match's Match API facts, then
  `pubg_get_review_facts` for Telemetry-derived facts. Never present a missing
  Telemetry fact as zero.
- Pass `categories` only when a bounded review is requested. The match and
  player summary remains available; detail groups such as `combat`, `fights`,
  `weapons`, `vehicles`, `heavy_weapons`, `special_events`, `team_damage`,
  `recovery`, `loot`, `environment`, and `evidence` are returned when their
  category is requested (or when `categories` is omitted). An empty group is
  not proof that the event did not happen.
- Preserve the returned `status`, `coverage`, `asOf`, `metricVersion`,
  `queryResolved`, and `evidenceRefs` while explaining results. `partial`,
  `no_matches`, and `error` are meaningful outcomes, not successful data.
- Keep the same OpenClaw session context for follow-ups. Tool results are
  session-scoped; do not reuse a `resultSetId` from another conversation.

The plugin returns structured JSON. OpenClaw owns interpretation, clarification,
and the final natural-language response; the plugin does not contain an LLM,
keyword router, fixed prose workflow, or platform adapter.
