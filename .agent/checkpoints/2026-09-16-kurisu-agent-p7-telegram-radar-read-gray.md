# Kurisu P7：Telegram Product Radar 只读灰度验收

- 日期：2026-09-16（Asia/Shanghai）
- 范围：唯一管理员 Telegram 私聊；只读 `kurisu.radar.list`，未创建、修改、暂停或删除任何 Product Radar Watch。
- 真实入口：LangBot 收到管理员私聊请求并选择 Kurisu Tool；修复前的同类请求保留 `CAPABILITY_UNAVAILABLE` 作为配置缺口证据，不计为通过。
- 修复后结果：同一私聊重发请求后，Kurisu SQLite 最新 execution 为 `tool=kurisu.radar.list`、`status=ok`、已完成；LangBot Telegram `send_message` 与最终 `edit_message_text` 均成功。
- 运行边界：`local/kurisu-gateway@0.1.0` 已安装；plugin runtime 使用外部 gateway secret；Runtime 仅绑定 `127.0.0.1`，并通过 `http://product-radar:5315` 使用同一 Docker 私网读取 Radar。
- 回滚：Runtime Compose `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260916-221135`；LangBot plugin runtime Compose `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260916-213512`；插件包备份位于仓库 `.backups/langbot/20260916-220029/`。
- 未完成：不将该一条只读私聊灰度扩大为全量平台验收。旧 EventListener single-consumer 迁移、briefing producer、写工具/通知/Codex 灰度、其他 session rollout 及端到端回滚演练仍待单独授权与证据。
