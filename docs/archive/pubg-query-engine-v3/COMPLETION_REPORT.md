# PUBG V3.2 COMPLETION REPORT

更新时间：2026-09-03（Asia/Shanghai）

准确性修订的当前状态和真实 Match 前后对照见 `V3.2_ACCURACY_PATCH_REPORT.md`；本文保留 V3.2 初版交付记录。

## Architecture

V3.2 is an additive Match Review Subgraph. Existing V3 QuerySubgraph, V3.1 Platform Adapter, Match Store and ResultSet remain in place. The TypeScript Telemetry Worker owns heavy parsing; Mastra owns workflow orchestration; n8n owns external data orchestration, retry and integration.

## Shared PUBG Prelude

```text
Platform Adapter → NormalizedBotMessage → Identity → Context
→ Planner → Schema Validator → Time/Selector Resolver → Operation Router
```

Identity, sender isolation, time parsing, `default_team`, Match Repository access and platform identity are shared. There is no duplicate Prelude in ReviewSubgraph.

## Operation Routing

- `report`, `detail`, `rank`, `strongest`, `weakest`, `compare`, `trend`, `list` → existing QuerySubgraph。
- Explicit review intent or an active review follow-up → `operation=review_match` → ReviewSubgraph。
- Ordinary `今日战绩`、`昨天谁最强` do not download Telemetry。

## QuerySubgraph Regression

V3 historical query behavior remains deterministic and passed source/live checks for today, yesterday, last week, strongest/weakest, KD/damage/assist ranking, last 20, compare, trend and ResultSet follow-up.

## ReviewSubgraph

The review flow resolves a period into ASC-ordered Match candidates, returns `MATCH_NOT_FOUND` for zero, shows a Picker for multiple, and calls `TelemetryWorker.ensure()` only after one Match is uniquely identified. Telemetry failures return `REVIEW_PARTIAL` with the base Match summary.

## Match Selector

Supported selectors: `latest`, `earliest`, `ordinal`, `ordinal_from_end`, `filtered`, `ranked`, `active_match`, `previous` and `next`. `复盘刚才那把` maps to `latest(recent=true)`; ordinals remain stable across the ResultSet.

## Telegram Match Picker

Picker output contains time, map, placement, four-player summary fields and team kills/assists/damage. It does not include Telemetry details. Inline buttons use `pubg:m:<short-token>` and never expose the full PUBG Match ID. Selection Store enforces platform, chat and expiry binding. The plugin ACKs Telegram callback immediately, then resumes asynchronously.

## Telemetry Pipeline

```text
unique matchId → feature cache HIT/MISS → PUBG Match asset
→ gzip decode → normalized events → feature extraction
→ compact derived Feature Store → Review Facts → Analysis → Presentation
```

PUBG API Authorization uses the configured Bearer credential for the Match API only; signed telemetry asset URLs do not receive the API key.

## Review Facts

`MatchReviewFacts` contains `match`, `squad`, `players`, `combat`, `fights`, `weapons`, `vehicles`, `heavyWeapons`, `specialEvents` and `evidence`. FACT, DERIVED, ANALYSIS and FUN layers are distinct. Raw Telemetry never enters an LLM context. Persistent records retain derived facts/evidence references and discard the normalized event stream after extraction.

## Fight Detection

Damage, knock, kill and revive events are grouped into deterministic `Fight` windows with start/end, participants, damage, knocks, kills, revives, result, importance score, key players and evidence IDs. Default presentation selects the three most important fights.

## Key Operations

Each player receives zero to three evidence-backed operations where supported: `ENTRY`, `MULTI_KNOCK`, `CLUTCH`, `TRADE`, `SUPPORT`, `REVIVE`, `DAMAGE`, `VEHICLE` and `HEAVY_WEAPON`. Reserved risk/flank/mistake types are never asserted without reliable evidence. Commentary is derived from operations rather than raw kill totals.

## Vehicle Intelligence

The model supports ride/drive distance, max speed, vehicle damage, destroyed vehicles, and reliable driver/passenger flags. Vehicle lines are rendered only when evidence exists; generic position events do not create fake vehicle activity.

## Heavy Weapon Intelligence

`HeavyWeaponStats` is generic across weapons and records pickup/drop, shots, hits, player/vehicle damage, knocks, kills and destroyed vehicles. V3.2 covers Panzerfaust/rocket launcher behavior without a single-weapon hack.

## Special Events

Implemented events include `ROCKET_UNUSED`, `ROCKET_HIT`, `ROCKET_VEHICLE_DESTROY`, `ROCKET_MULTI_KILL`, `ROCKET_VEHICLE_MULTI_KILL`, `MULTI_KNOCK`, `CLUTCH`, `REVIVE_CHAIN`, `VEHICLE_LONG_DRIVE`, `VEHICLE_DESTROY` and `VEHICLE_KILL`. A multi-kill requires explicit attack/vehicle/kill correlation; time proximity alone is rejected.

## Review Presentation

`MatchReviewResult` is structured and is converted through `ReviewPresentation` Sections before platform rendering. Reserved Section keys include `overview`, `players`, `key_operations`, `key_fights`, `turning_points`, `weapons`, `vehicles`, `heavy_weapons`, `fun` and `conclusion`. Telegram/KOOK renderers split at section boundaries and do not use wide Markdown tables.

## Active Match Context

After a successful review, Context records `activeMatchId`, `activeMatchOrdinal`, `activeReviewResultSetId` and `sourceMatchResultSetId`. Follow-ups such as `这把谁最C`, player focus, `火箭筒呢`, `开车呢`, `最后团呢`, `上一把` and `下一把` inherit this structured reference.

## Tests

- TypeScript typecheck: PASS。
- TypeScript build: PASS。
- TypeScript suite: `63/63 PASS`。
- Python plugin adapter suite: `6/6 PASS`。
- Feature Store compaction: `45,596,728` → current `2,499,450` bytes; backup and old versioned records retained。

## V3 Regression

PASS for the required historical QuerySubgraph cases and the invariant that ordinary queries never enter ReviewSubgraph or download Telemetry.

## V3.1 Regression

PASS for normalized Telegram/KOOK contracts, sender isolation, Platform Renderer, Tool/Command wiring and callback fixture behavior. Runtime remains deployed in Ubuntu CasaOS.

## KOOK Regression

KOOK API `user/me`, `gateway/index`, WebSocket HELLO and reconnect behavior pass. Existing Query route and plugin artifacts are present. A real non-Bot KOOK inbound/client smoke event is still required for end-to-end sign-off.

## Known Limitations

- Real non-Bot Telegram/KOOK inbound messages and desktop/mobile rendering have not been observed in this run; Bot self-messages cannot substitute for them.
- V3.2 does not implement complete loot/healing analytics, full position analytics, 2D/3D replay or unsupported telemetry fields.
- Mastra official Storage adapter is not configured; controlled JSON stores are used.

## Rollback

Engine backup: `/DATA/AppData/pubg-query-engine-v3/backups/v3.1-before-v3.2-20260903`。

Feature backup: `/DATA/AppData/pubg-query-engine-v3/backups/features-before-compaction-20260903.json`。

LangBot backup: `/DATA/AppData/langbot/backups/pubg-v3.2-before-20260903`。

Restore the CasaOS image/plugin references and recreate only the affected Ubuntu app. Preserve Match Store, `pubg_cache`, Context, ResultSet and all backups. Detailed commands are in `V3.2_ROLLBACK.md`。

## Goal Status

V3.2 初版的真实非 Bot Telegram/KOOK 入站与客户端显示仍是外部烟测限制；本次准确性补丁的自动化、确定性运行时和真实 Match 验证已完成，详见 `V3.2_ACCURACY_PATCH_REPORT.md`。
