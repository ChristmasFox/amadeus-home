# Kurisu Agent 开发进度报告

更新时间：2026-09-16（Asia/Shanghai）  
当前提交：`baa2097`（P2；基线 `58b33d5`）
范围：本机仓库开发 Goal；P7 生产部署与真实平台验收不在授权内。

## 阶段状态

| 阶段 | 状态 | 已交付/证据 | 未完成或阻塞 |
| --- | --- | --- | --- |
| P0 | `HOST_FIXED_LOCAL / REAL_PARTIAL` | 宿主 ADR、能力/生产者盘点、脱敏基线、复现 JSON、fake host probe；9Router 文本/工具结果/错误/图文 provider probe 通过 | 合法 LangBot session identity 缺失，原生宿主平台入口未宣称通过；legacy listener 尚未迁移 |
| P1 | `IMPLEMENTED / VERIFIED_LOCAL` | `apps/agent-runtime/src/kurisu/`、`apps/agent-runtime/src/server.ts`、`integrations/langbot/plugins/kurisu-gateway/`、`scripts/deploy-langbot.sh`；`kurisu.v1` 契约、stable identity/session、trusted policy、tool catalog/validation、server-bound callback、SQLite WAL/migration、task/approval/media safety；runtime `18/18`、plugin `2/2`、HTTP endpoint smoke、typecheck、Python compile、secret scan、diff check | 尚未迁移旧 EventListener 或取得合法 LangBot user/support-admin session |
| P2 | `IMPLEMENTED / VERIFIED_LOCAL / L3_BLOCKED` | PUBG deterministic read adapter、HomeHub registry/diagnostic、Radar bounded HTTP adapter、principal-scoped notification diagnosis、provider-compatible `kurisu_gateway`、runtime `24/24`、plugin `4/4`、真实 9Router 三轮 provider trace、package dry-run、typecheck、Python compile、secret scan、diff check | 缺少合法 LangBot user/support-admin session；真实 native-agent WebSocket/platform 与 L2/L3 未宣称通过，历史 EventListener 尚未迁移 |
| P3 | `NOT_STARTED` | — | SQLite 任务/审批/ledger/reconcile/cancel 待实现 |
| P4 | `NOT_STARTED` | — | 唯一 Codex App Server executor 与隔离任务实测待实现 |
| P5 | `NOT_STARTED` | — | event/delivery worker、producer handoff、偏好/风格待实现 |
| P6 | `NOT_STARTED` | — | 100 场景、20 failure-derived、R01、release dry-run、backup/restore 待实现 |
| P7 | `NOT_AUTHORIZED` | — | 需单独 Goal 明确授权后才可部署/真实平台验收 |

## P0 结论

Path A 已按实测门槛固定为唯一主 Agent 宿主：LangBot 原生 `local-agent` + 当前 9Router；Mastra 仅保留 PUBG deterministic subworkflow。当前 provider 能力已得到真实 HTTP 证据，fake host 契约已得到 L1 测试证据。

这不等于线上 Kurisu 已可用：当前生产 Pipeline 仍有历史 listener，且本 Goal 没有合法 LangBot 用户/支持管理员 session token，因此没有执行真实 native-agent WebSocket 会话、生产 Pipeline 修改或 Telegram/KOOK 消息。该缺口已记录到 [`KURISU_AGENT_HOST.md`](../decisions/KURISU_AGENT_HOST.md) 和 `.agent/tasks/2026-09-16-kurisu-agent-implementation.md`。

## P0 验收索引

- Host decision：[`docs/decisions/KURISU_AGENT_HOST.md`](../decisions/KURISU_AGENT_HOST.md)
- Capability/producer inventory：[`KURISU_AGENT_CAPABILITY_INVENTORY.md`](KURISU_AGENT_CAPABILITY_INVENTORY.md)
- Sanitized baseline/reproductions：[`KURISU_AGENT_P0_BASELINE.json`](KURISU_AGENT_P0_BASELINE.json)
- Deterministic probe：[`apps/agent-runtime/src/kurisu/host-probe.ts`](../../apps/agent-runtime/src/kurisu/host-probe.ts)
- P0 checkpoint：`.agent/checkpoints/2026-09-16-kurisu-agent-p0.md`

## P2 验收索引

- Provider trace：[`KURISU_AGENT_P2_PROVIDER_TRACE.json`](KURISU_AGENT_P2_PROVIDER_TRACE.json)
- P2 checkpoint：`.agent/checkpoints/2026-09-16-kurisu-agent-p2.md`

## 证据规则

每个后续 case 必须记录 `caseId/revision/layer/modelRoute/configFingerprint/inputFixture/expectedInvariants/actualToolCalls/result/evidenceRefs`，并区分 `PASS`、`BLOCKED`、`OPEN` 与 `NOT_APPLICABLE`。任何容器 running、HTTP 200、`getMe` 或 turn ended 都不能单独作为终端交付成功证据。
