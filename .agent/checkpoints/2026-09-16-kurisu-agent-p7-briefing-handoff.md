# Kurisu P7：Daily Digest 中央通知交接验收

- 范围：live n8n `Daily Tech & Market Digest`（`681f9db4-6666-4e58-aa6a-7ecc86316182`）从直连 LangBot 改为 Runtime notification ingress/outbox。
- 源码：`integrations/n8n/workflows/daily-tech-market-digest.workflow.json`；live workflow 导入前备份为 `/home/node/.n8n/workflow-backups/codex-681f9db4-6666-4e58-aa6a-7ecc86316182-before-20260916-232038.json`。
- 初始失败证据：n8n 手动生产执行 `6155` 完成但 `digest_runs` 为 `delivery_failed`，错误为 `notification ingress is not configured`。原因是 `/DATA/AppData/n8n/secrets/codex-notify-secret` 为 `root:root 0600`，Runtime 的 node 用户不能读取 bind mount，启动时 ingress secret 为空。
- 修复：`scripts/deploy-kurisu-production-features.sh` 把共享 secret 收紧为 `root:gid1000 0640`，并对 Runtime/Product Radar 使用 `docker compose up -d --force-recreate --no-build`；实现提交 `b2c8d04`、`2cb7634`、`30b855d` 已 push。
- 部署与回滚：最近 Runtime compose rollback 为 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260916-233013`；Radar compose rollback 为 `/var/lib/casaos/apps/product-radar/docker-compose.yml.codex-backup.20260916-233013`。没有新镜像构建。
- ingress smoke：受控 briefing event 返回 HTTP `202`，创建一个 KOOK group delivery；其最终记录为 `sent`、`attempts=1`、`last_error=null`。
- 真实生产者闭环：通过现有受鉴权 manual trigger 启动执行 `6164`/`6165`；`6165` 在 2026-09-16 15:32:59 成功，`digest_runs` 的 runKey `2026-09-16:evening:manual:kurisu-central-handoff-retry-20260916` 为 `success`/`sent`、无错误。Runtime `kurisu_events` 保存对应 briefing event，`kurisu_deliveries` 为 KOOK `sent`、1 attempt、无错误。
- 未宣称：这不证明 Telegram/KOOK 的全部入站、引用、图片、按钮/审批、Codex 生产 executor 或回滚 L4 已通过；这些仍是 `PRODUCT_COMPLETE` 的剩余门槛。
