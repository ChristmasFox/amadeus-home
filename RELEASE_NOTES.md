# Amadeus 1.1.0

PUBG Telemetry 现在按小时自动同步：每轮先刷新所有配置玩家的最新对局，只请求新 Match API 详情，再以有限并发获取新对局或到期重试对局的 Telemetry 并写入持久化缓存。
缓存语义已拆开：`HIT` 是缓存命中，`FETCHED + cacheStatus=MISS + availability=AVAILABLE` 是缓存未命中但请求成功并已落盘，`UNAVAILABLE` 才是数据不可用；所有 PUBG 工具结果都携带 `dataUpdatedAt`。
每天 00:00 生成上一自然日的 PUBG 自动同步结果，并通过唯一 owner outbox 发送 `Amadeus • D-mail` 通知；通知保留真实计数、数据更新时间、重试状态，并以 `El Psy Kongroo.` 收束。
