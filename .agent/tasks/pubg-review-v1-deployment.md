# PUBG Review V1 deployment follow-up

状态：DEPLOYED / VERIFIED（2026-09-06）；仅剩可选的人工 Telegram 入站复测。

## 已完成

- runtime image `local/pubg-query-engine-v3:git-2f6a63b013ff` 已通过 host BuildKit build/load 并部署到 OrbStack `ubuntu` / CasaOS；image compose rollback：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-231814`。
- runtime compose 已显式切换 `telemetry-parser-5` / `review-features-5`；env compose rollback：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-232046`。
- n8n `PUBG Data Gateway v3` ID `pubg-data-gateway-v3-20260902` 已导入、重启并验证 active；backup：`/home/node/.n8n/workflow-backups/codex-pubg-data-gateway-v3-20260902-before-20260906-231837.json`。
- LangBot `local/pubg-stats` `3.3.0` 已通过 API task `14` 安装并达到 `INSTALL_READY`；deploy backup：`.backups/langbot/20260906-231910`。
- 真实 Match ID `d8c41c10-de9f-40b4-ac88-ede0ab554a31` runtime smoke 返回 `OK`，telemetry `MISS` 后创建 v5 feature cache，返回完整 review sections。
- `scripts/doctor.sh`、`scripts/smoke-homehub-docker.sh`、runtime `/healthz`、`/homehub/health`、n8n health 均通过。

## 可选人工复测

生产 bot 当前未由 Codex 代发真实用户消息；如需验证 Telegram 入站事件链路，由用户在目标私聊/群聊发送：

```text
复盘这场比赛 d8c41c10-de9f-40b4-ac88-ede0ab554a31
```

该人工消息不影响已完成的 runtime direct query、n8n source 和 plugin installation smoke。
