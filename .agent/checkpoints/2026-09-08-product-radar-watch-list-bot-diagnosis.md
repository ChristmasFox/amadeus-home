# Product Radar existing Watch list / bot diagnosis checkpoint — 2026-09-08

## Symptom

User sent `我在盯着什么` and received an empty-monitor response while Product Radar database still contained active Watches.

## Root cause

`is_list_request` recognized `我现在盯着什么` but not `我在盯着什么`. The Product Radar listener therefore did not reliably enter its list path. Similarity target rendering also omitted SearchPlan query labels.

## Evidence

- `GET /api/watches` returned 3 Watches: one Product Watch and two active Similarity Watches.
- `langbot_plugin_runtime` resolves `product-radar` and receives HTTP 200 from `/api/watches`.
- LangBot and plugin runtime containers are running; recent Telegram outbound success entries exist.
- The “empty” result was not caused by an empty Product Radar database.

## Fix/release

- Added list phrases: `我在盯着什么`, `当前监控`, `有哪些监控`, and broader `盯着什么` matching.
- List renderer now displays Similarity SearchPlan/query values.
- LangBot Product Radar plugin task `67`: `INSTALL_READY`; rollback directory `.backups/langbot/20260908-184911`.
- Source commit: `f1cbf2d`.

## Current user-visible commands

```text
我在盯着什么
我现在盯着什么
当前监控
/watches
```
