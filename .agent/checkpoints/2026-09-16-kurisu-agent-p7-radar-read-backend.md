# Kurisu P7：Product Radar 只读后端灰度修复

- 日期：2026-09-16（Asia/Shanghai）
- 发现方式：管理员 Telegram 私聊的真实请求由 LangBot 选择 `kurisu.radar.list`，但 Runtime execution 记录为 `CAPABILITY_UNAVAILABLE`，原因是 `KURISU_RADAR_URL` 未配置；未修改任何 Watch。
- 根因：`apps/agent-runtime/src/server.ts` 仅在 `KURISU_RADAR_URL` 非空时注册 Radar backend；`apps/agent-runtime/deploy/docker-compose.yml` 原先遗漏了该环境变量。
- 修复：Git commit `5d25b99` 增加 `KURISU_RADAR_URL: http://product-radar:5315`；同项写入 CasaOS `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`，使用既有 image `local/pubg-query-engine-v3:git-3e00275d8e70` 执行 `docker compose up -d --no-build`。
- 回滚：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260916-221135`。
- 验证：Runtime 容器内访问 `http://product-radar:5315/api/watches` 返回 HTTP `200`；带 gateway secret 的 live `kurisu.radar.list` 返回 `status=ok`；Runtime healthy。
- 未完成：首次 Telegram 请求发生在修复前，仍需同一私聊重发只读请求，验证 LangBot 最终渲染回复；不得向群聊发消息，不启用写工具/通知/Codex，也不切换其他 session。
