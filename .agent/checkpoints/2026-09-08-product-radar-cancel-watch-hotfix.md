# Product Radar active Watch cancellation hotfix checkpoint — 2026-09-08

## Problem

`取消监控` only searched pending confirmation tokens. After a Watch was already confirmed, it returned “没有待取消的监控确认” and left the active Similarity Watch polling.

## Fix

- Pending proposal + `取消监控`: cancel proposal as before.
- Active Watch + `取消监控`: use the active stop path, PATCH `enabled=false`, and pause the shared SearchFeed sensor.
- After plugin reload, if in-memory conversation context is unavailable and there is exactly one enabled Similarity Watch, it is selected safely; the unrelated Product Watch is not selected.

## Release

- LangBot plugin task `58`: `INSTALL_READY`.
- Rollback directory: `.backups/langbot/20260908-161036`.
- Source commits: `8867b55` and `9a832c1`.
- Product Radar runtime remained healthy and no existing real Product Watch was modified during the fix.

## User behavior

- Before confirmation: `取消监控` cancels the pending proposal.
- After confirmation: `取消监控` stops the active Similarity Watch; the Watch remains as paused history, but no further polling or notification occurs.
