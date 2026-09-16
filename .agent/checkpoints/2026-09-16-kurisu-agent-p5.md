# Kurisu Agent P5 checkpoint

日期：2026-09-16（Asia/Shanghai）
状态：`P5_IMPLEMENTED / VERIFIED_LOCAL / BRIEFING_BLOCKED / L3_BLOCKED`
基线提交：`c498ba8`（P3/P4）
本 checkpoint 对应工作区待提交的 P5 差异；无生产配置或外部状态变更。

## 已完成

- Runtime `kurisu_events` 与 `kurisu_deliveries` 继续分离拥有唯一键；delivery 增加 `platformMessageId`、lease owner/expiry、due scan、atomic claim、retry/requeue 和 principal-owned lookup。
- `NotificationWorker` 先落事件和 pending delivery，再发送；Telegram/KOOK/Codex channel 独立发送、退避、失败耗尽、unknown 和恢复；成功渠道不因另一个渠道失败而重发。
- 通知偏好以 `principal:<platformUserId>` 持久化，保留 user provenance、source/resultType/channel/timezone/until，可查询、修改、遗忘；模型不能提供 principal、recipient、role 等可信字段。
- Codex App Server job 状态和 structured HomeHub/Radar/media write 结果可进入统一事件账本，并保留 `taskId/runId`；legacy Codex completion 没有关联 task 时只渲染“本轮结束，结果待核实”。
- Codex hook 默认发 Runtime central ingress；HTTP/curl 不可用时将脱敏归一化 payload 写入 0700 spool，补发脚本默认 dry-run，成功项移入 `processed/`。
- Product Radar 增加显式 `PRODUCT_RADAR_NOTIFICATION_OWNER=central`；其原有 SQLite `notification_outbox`/heartbeat queue 作为跨库 handoff，central owner 不读取或转发平台 recipient，旧 pending 可交给 central channel；默认配置不变。
- 新增单一 Kurisu tone config；严重告警直接陈述，通知 renderer 不把未知/legacy completion 写成任务或部署成功。

## 验收证据

- Kurisu 定向：`pnpm --filter @agent/agent-runtime exec tsx --test tests/kurisu-*.test.ts` → `48/48 PASS`。
- Product Radar：`pnpm --filter @agent/product-radar test` → `53/53 PASS`；central handoff regression included。
- LangBot Kurisu plugin：`PYTHONPATH=. python3 -m unittest discover -s integrations/langbot/plugins/kurisu-gateway/tests` → `4/4 PASS`。
- Package typechecks、`bash scripts/smoke-codex-notify.sh`、`bash scripts/deploy-langbot.sh --dry-run --plugin kurisu-gateway`、`pnpm check:secrets`、`git diff --check` → PASS。
- Producer inventory：`docs/reports/KURISU_AGENT_P5_PRODUCERS.md`。Codex/Radar/HomeHub structured write 有本地 source/test；briefing 没有独立可核验 producer，严格记录 `BLOCKED_UNSUPPORTED`。

## 未完成与解除条件

- 当前 LangBot user/support-admin session token 不在任务授权范围，native-agent WebSocket/platform L2/L3 仍 blocked；历史 PUBG/Product Radar EventListener 的 session rollout/single-consumer 迁移留待合法平台验收窗口。
- briefing 需要真实 scheduler、生成执行、事件及投递记录；在发现前不新增空日报或手工“成功”事件。
- P6 仍需完整集成验收、100 个实际场景变体（含 20 条 failure-derived）、R01/R02、backup/restore、release dry-run 和 runbook。P7 才能切真实通知 owner、安装插件或发送平台 smoke。
- 已知既有 `review-v3-2.test.ts` 全量 runner 会异常长时间占用 CPU；本阶段按 Kurisu 分批和 Product Radar 全量验证，不将该既有挂起记为全量通过。

## 回滚

本阶段尚未部署。若后续需要撤回源代码，使用 Git 提交边界恢复到基线 `c498ba8`，不得触碰运行容器或数据库。P7 切换时必须先备份 Runtime/Product Radar DB、暂停 central worker、处理 lease，并关闭 legacy n8n/local sender 后再改变 owner；保留事件、unknown 状态和旧队列，不删除 Watch 或审计。
