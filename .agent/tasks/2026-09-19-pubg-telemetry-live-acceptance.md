# PUBG Telemetry live acceptance follow-up

- 等待首个小时预取 cron 完成后核对 `telemetry_prefetch_runs`、`telemetry_prefetch_attempts` 和 `telemetry_features` 增量。
- 等待首个 00:00 D-mail cron，核对 owner outbox 的 `pubg-sync:<date>.sent.json`；不要用手动补跑占用正式 event key。
- 用户从真实 Telegram/WhatsApp 入口触发 PUBG 查询，确认最终自然语言回复带 `数据更新时间`，并确认 `FETCHED` 不再被表述为 Telemetry 缺失。
