# PUBG Telemetry 预取 live checkpoint

- 部署提交：`4cf3f40`
- Amadeus 版本：`1.1.0`
- live image：`local/openclaw-amadeus:git-4cf3f4011d61-20260919045321`
- 外部恢复点：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919045321`
- runtime：OpenClaw healthy；PUBG plugin loaded，8 个 native tools；Product Radar、媒体网络、NAS 只读、owner outbox smoke 通过。
- hourly cron：`amadeus-pubg-telemetry-hourly`，`5 * * * *`，`Asia/Shanghai`，allow `pubg_prefetch_telemetry`，no-deliver。
- daily cron：`amadeus-pubg-sync-daily`，`0 0 * * *`，`Asia/Shanghai`，allow `pubg_telemetry_sync_report amadeus_notify_owner`，no-deliver agent delivery + owner outbox。
- 首次 hourly 手动回放：成功，`dataUpdatedAt=2026-09-19T04:56:42.167Z`，`discoveredMatchCount=118`、`newMatchCount=0`、`fetchedCount=0`、`unavailableCount=0`、`pendingCount=0`，`deliveryStatus=not-requested`。
- live SQLite：`telemetry_prefetch_attempts`、`telemetry_prefetch_runs` 已创建；features=75、attempts=0、runs=1。
- 待验收：首个自然 00:00 owner D-mail、真实 Telegram/WhatsApp PUBG 回复中的 `数据更新时间` 和 `FETCHED` 语义。
