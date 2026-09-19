---
name: pubg
description: "Use deterministic PUBG match statistics and evidence-backed review tools."
user-invocable: false
---

# PUBG

Use the PUBG tools for match statistics and review. OpenClaw resolves the
user's natural-language request, but the identity-first dispatch contract below
is mandatory. Do not answer a person-specific PUBG request before completing
that tool sequence. These rules are scoped to PUBG requests and must not limit
Kurisu's other native capabilities.

## Mandatory identity-first dispatch

Any PUBG request that names a person by a human nickname, alias, or mention is
person-specific, including short messages such as “胶昨天战绩”, “猴昨天战绩”,
“帮我看八戒最后一把”, or “胶呢” when the surrounding context makes PUBG the
subject. For each such request:

1. Call `identity_resolve` with `reference=alias` and the exact nickname text
   (or use `reference=mention` / `reference=reply_sender` for a trusted native
   mention or reply).
2. If the result is `status=resolved`, immediately call the relevant PUBG tool
   with `personIds=[result.person.personId]`.
3. Only report an identity/account problem when the tools return
   `unbound`, `ambiguous`, `candidate`, `not_found`, or
   `identity_pubg_account_unbound`. A previous assistant reply claiming that a
   nickname is unconfirmed is not evidence; resolve it again with the current
   tools.

First-person PUBG requests such as “我昨天战绩”“我的战绩” or “本人最后一把”
must call `identity_resolve` with `reference=self` first and then pass the
returned canonical `personId` as `personIds`. They must never be converted to
`team=true`; `team=true` is reserved for an explicit whole-team/squad request.

Never ask the user for a PUBG ID or say that the account is unconfirmed before
the identity lookup. Preloaded nickname/account mappings are already confirmed
for this deployment; use the resolved `personId` directly. `pubg_resolve_players` is not a substitute for
`identity_resolve`: `playerNames` is for an explicit PUBG in-game name, while a
chat nickname must first become a canonical `personId`.

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
- “最近一局”“最后一局”“最新比赛”以及“复盘最近一局”每次都必须重新调用
  `pubg_search_matches`，固定使用 `sort: "desc"`、`recentN: 1`、`refresh: true`。
  即使当前会话里已经有旧的 `matchId` 或旧结果，也不能跳过这次搜索；先用搜索返回的
  最新 `matchId`，再调用 `pubg_get_review_facts`。底层会刷新比赛列表，只请求新比赛的
  详情，并在没有新增比赛时复用缓存。只有用户明确说“这把/刚才查到的那一把”时，才可
  沿用当前会话的具体 `matchId`。
- Use `pubg_query_stats` for bounded aggregates. Prefer an explicit selector:
  `time_range` uses the half-open interval `[from,to)` and IANA timezone
  `Asia/Shanghai` unless the user specifies another timezone. PUBG's canonical
  business day runs from `06:00` through the next `06:00`; preserve that
  boundary when resolving date-based selectors. `last_n_matches` is bounded to
  at most 100 matches per call.
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
- Every user-facing PUBG answer must include `数据更新时间：<dataUpdatedAt>` from the
  latest relevant tool result. `dataUpdatedAt` is the tool's authoritative snapshot
  timestamp; do not replace it with the current chat time or an invented match time.
- Telemetry status is explicit: `HIT` means the feature cache was read,
  `FETCHED` + `cacheStatus=MISS` + `availability=AVAILABLE` means the cache was
  missed but the official Telemetry was fetched successfully and written to cache,
  and `UNAVAILABLE` means the data could not be obtained. Never describe a successful
  `FETCHED` result as missing Telemetry.
- `pubg_prefetch_telemetry` is a bounded team-wide scheduled operation. It refreshes
  player match lists hourly, fetches only new Match API records, and prefetches only
  missing Telemetry; its retry state is persistent. `pubg_telemetry_sync_report`
  summarizes the previous natural calendar day and returns the exact notification
  payload for `amadeus_notify_owner`; preserve its counts and timestamp.
- Keep the same OpenClaw session context for follow-ups. Tool results are
  session-scoped; do not reuse a `resultSetId` from another conversation.

The plugin returns structured JSON. OpenClaw owns interpretation, clarification,
and the final natural-language response; the plugin does not contain an LLM,
keyword router, fixed prose workflow, or platform adapter.
