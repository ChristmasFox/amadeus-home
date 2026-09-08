# Product Radar language intent planner checkpoint — 2026-09-08

## Problem

Product Radar previously depended too heavily on exact phrase matching for list/stop/confirm actions. The user correctly noted that it should have a language parsing layer like the PUBG planner.

## Fix

- Added `components/intent_planner.py`.
- Deterministic fast path handles known controls without an LLM call.
- Ambiguous inbound messages use one JSON-only LLM intent extraction call with actions: `list`, `confirm`, `cancel`, `stop`, `watch`, `none`.
- Vision/profile and intent remain create/modify boundaries only; SearchFeed polling never calls the LLM.
- Existing regex parsing remains as fallback for URL/image Watch construction.

## Verification

- Natural-language unit cases: `我都在盯哪些东西？` → list; `刚才那件不要了` → stop.
- LangBot plugin tests: 9/9 passed.
- LangBot plugin task `71`: `INSTALL_READY`.
- Existing Product Radar API has 3 Watches and is reachable from plugin runtime; no Watch was deleted or paused by this change.

## Commits

- `cd5062b` — add Product Radar language intent planner.
