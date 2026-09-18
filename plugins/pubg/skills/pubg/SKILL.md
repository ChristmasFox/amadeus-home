---
name: pubg
description: "Use deterministic PUBG match statistics and evidence-backed review tools."
user-invocable: false
---

# PUBG

Use the PUBG tools for match statistics and review. Let the model resolve the
user's natural-language request; do not invent a tool call when the request is
ambiguous or asks for a capability outside PUBG.

Tool rules:

- The configured team is the default subject when the user does not explicitly
  name a PUBG player. This includes “昨天战绩”, “我的战绩”, and similar
  unqualified requests: omit both `playerNames` and `playerIds`.
- A transport sender name is never a PUBG name. Never use WhatsApp/Telegram
  display names, profile names, push names, phone numbers, JIDs, or quoted
  sender labels as `playerNames`. If the user explicitly gives an in-game name
  or alias, use `pubg_resolve_players` before the player-specific query.
- In a group, “我” still means the configured team unless an independent PUBG
  identity binding is present; do not derive identity from the current sender.
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
