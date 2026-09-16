# Kurisu P5 通知生产者交接清单

日期：2026-09-16（Asia/Shanghai）
范围：本机仓库实现与本地 fake/定向验证；没有切换 CasaOS、LangBot、n8n 或真实平台 sender。

## 交接原则

Runtime 的 `kurisu_events` / `kurisu_deliveries` 是统一通知账本。跨应用数据库不做假事务：生产者先保留自己的本地 outbox，再把结构化事件交给 Runtime；Runtime 按 `eventKey` 和 `(eventId, channel, recipient)` 去重，平台目标只能由 Runtime 外部配置决定。

## 生产者状态

| Producer | 当前源代码边界 | 交接状态 | 证据/解除条件 |
| --- | --- | --- | --- |
| Codex legacy hook | `integrations/codex/codex-notify.sh` | `IMPLEMENTED_LOCAL`：默认进入 Runtime；网络失败安全写本地 spool，`drain-codex-notification-spool.sh` 显式 `--apply` 转交 | `scripts/smoke-codex-notify.sh`；未知结果不推断任务成功。P7 才能安装/切换全局配置 |
| Product Radar | `apps/product-radar/src/core/notification/dispatcher.ts` + `notification_outbox` + `KurisuNotificationChannel` | `IMPLEMENTED_OPT_IN`：`PRODUCT_RADAR_NOTIFICATION_OWNER=central` 时只保留一个 central producer；旧 local pending row 可由 central channel 接管；默认仍是 local | `apps/product-radar/tests/notification-handoff.test.ts`；启用前须由 P7 备份数据库、停旧 sender 并核对 Runtime targets |
| PUBG / n8n | `integrations/n8n/workflows/pubg-*.workflow.json` | `PENDING_OWNER_REVIEW`：现有数据同步/日报 workflow 仍是业务事实源，本阶段没有擅自改发送时刻或把 n8n 双写到 Runtime | P7 前需逐个 workflow 核实 event owner、发送节点和交接队列；不以 HTTP 200 代替 delivery evidence |
| Codex legacy n8n sender | `integrations/n8n/workflows/codex-completion-notification.workflow.json` | `ROLLBACK_ONLY_SOURCE`：保留可回滚 JSON；当前 Codex source 默认不再指向它。新旧 sender 不可同时激活 | P7 切换时先停旧 webhook/发送节点，保留外部 backup，再验证 Runtime outbox |
| HomeHub | `apps/agent-runtime/src/runtime/homehub-runtime.ts` 与 Kurisu structured backends | `OPEN_PRODUCER`：已有诊断/动作边界，没有在仓库发现可核验的独立主动通知 producer；Runtime 已提供 failure/unknown 事件入口 | 找到真实 producer 与事件触发点后补 adapter、fake/recovery tests；不能用手工注入冒充生产证明 |
| briefing / 简报 | 仓库与当前 source inventory 未发现独立可核验 producer | `BLOCKED_UNSUPPORTED`：不生成空日报、不伪造调度/生成/投递成功 | 需要真实 scheduler、生成执行记录和投递记录后，分别接入 event owner；缺失时回答来源不可达/无记录 |

## 双发保护

- Codex hook 不再直接调用 Telegram/KOOK；Runtime worker 是平台发送的唯一 owner。
- Radar central owner 使用本地 `notification_outbox` 做跨 SQLite 转交；Runtime event key 会合并切换期间的重复交接，旧 local row 不再直接调用 LangBot。
- legacy n8n JSON 只作为 rollback source，不能与 Runtime sender 同时启用。P7 的切换记录必须包含旧队列处理、Worker lease、外部 backup 和恢复验证。
