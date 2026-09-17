# Kurisu Agent 开发进度报告

更新时间：2026-09-17（Asia/Shanghai）
当前生产源码提交：`f670787`（生产 Runtime image 基于 `015df8f`，包含 `38af693`、`015df8f`、`c4f2e65`）；P0–P6 已完成，P7 已部署并完成全会话自然语言切流。
范围：Kurisu 全量实现与 CasaOS 生产发布；媒体 live mount 与含媒体挂载的 R05 回滚已补齐。首次真实 Telegram 入站已完成路由验证并发现/修复 plugin runtime URL 配置缺口，当前仍等待修复后的 Telegram 与 KOOK 成功最终送达证据，未将其伪报为 PRODUCT_COMPLETE。

## 阶段状态

| 阶段 | 状态 | 已交付/证据 | 未完成或阻塞 |
| --- | --- | --- | --- |
| P0 | `HOST_FIXED_LOCAL / REAL_PARTIAL` | 宿主 ADR、能力/生产者盘点、脱敏基线、复现 JSON、fake host probe；9Router 文本/工具结果/错误/图文 provider probe 通过 | 合法 LangBot session identity 缺失，原生宿主平台入口未宣称通过；legacy listener 尚未迁移 |
| P1 | `IMPLEMENTED / VERIFIED_LOCAL` | `apps/agent-runtime/src/kurisu/`、`apps/agent-runtime/src/server.ts`、`integrations/langbot/plugins/kurisu-gateway/`、`scripts/deploy-langbot.sh`；`kurisu.v1` 契约、stable identity/session、trusted policy、tool catalog/validation、server-bound callback、SQLite WAL/migration、task/approval/media safety；runtime `18/18`、plugin `2/2`、HTTP endpoint smoke、typecheck、Python compile、secret scan、diff check | 尚未迁移旧 EventListener 或取得合法 LangBot user/support-admin session |
| P2 | `IMPLEMENTED / VERIFIED_LOCAL / L3_BLOCKED` | PUBG deterministic read adapter、HomeHub registry/diagnostic、Radar bounded HTTP adapter、principal-scoped notification diagnosis、provider-compatible `kurisu_gateway`、runtime `24/24`、plugin `4/4`、真实 9Router 三轮 provider trace、package dry-run、typecheck、Python compile、secret scan、diff check | 缺少合法 LangBot user/support-admin session；真实 native-agent WebSocket/platform 与 L2/L3 未宣称通过，历史 EventListener 尚未迁移 |
| P3 | `IMPLEMENTED / VERIFIED_LOCAL` | 持久化 message-task links、审批参数与 callback binding、写工具协调器、HomeHub/Radar/media 受控写闭环、intent/reconcile/cancel、三处 crash injection、并发/timeout/unknown；`kurisu-write-tools.test.ts` 定向通过 | 未启用生产写工具；真实平台入口/外部生产写仍留在 P7 授权范围 |
| P4 | `IMPLEMENTED / VERIFIED_LOCAL` | 单一 Codex App Server executor、server-owned project registry、worktree 隔离、start/status/list/resume/cancel、持久化 thread/turn/审批/输入状态；fake server 与真实 `codex-cli 0.153.4` 隔离仓库小修复通过，报告见 `KURISU_CODEX_P4_REAL_TRACE.json` | 真实 Codex approval 本次隔离小任务未触发；平台消息通知交由 P5，真实平台/L4 仍不宣称 |
| P5 | `IMPLEMENTED / VERIFIED_LOCAL / BRIEFING_BLOCKED` | Runtime notification Worker、Codex spool、Radar central handoff、structured write events、偏好/语气、producer 清单；Kurisu `48/48`、Radar `53/53`、plugin `4/4` | briefing 真实 scheduler/生成/投递 producer 未发现；旧 n8n sender 仅 rollback source；P7 才能切真实 owner |
| P6 | `IMPLEMENTED / LOCAL_COMPLETE / L3_BLOCKED / BRIEFING_BLOCKED` | 101 条结构化 L2 场景（60 条独立失败改写）、R01/R02、HTTP smoke、配置/备份/恢复/runbook；实现提交 `24946b9` | Kurisu `50/50`、Product Radar `53/53`、typecheck、plugin `4/4`、Python compile、secret scan、R01/R02、L2 HTTP smoke 通过；全量 agent-runtime `181 passed / 0 failed / 1 skipped`，既有 runner 卡点已修复 |
| P7 | `DEPLOYED / BOUNDARY_HARDENED / GLOBAL_NLU_ROLLOUT_DEPLOYED / MEDIA_TOOLS_SOURCE_DEPLOYED / R05_MEDIA_ROLLBACK_VERIFIED / TELEGRAM_ROUTE_FIXED / L4_PLATFORM_PENDING` | Runtime `local/pubg-query-engine-v3:git-015df8f`、生产开关、通知/Codex/写工具、Radar central owner、四个媒体 bind mount 已部署；`kurisu-gateway@0.1.1` 与 legacy plugin 更新均 `INSTALL_READY`；Kurisu 是唯一 Tool，普通自然语言统一由 LangBot Native Agent + Kurisu 处理；首次真实 Telegram 已证明入站路由，修复 `KURISU_RUNTIME_URL` 后 plugin runtime 与 Runtime 私网连通；媒体 scan、doctor、R01/R02、HTTP/Docker smoke 通过；旧 Runtime/插件切换和当前版本恢复均在媒体挂载下通过 | 修复后 R03/R04 真实 Telegram/KOOK 入站、引用/图片/按钮/审批、群聊边界和最终送达仍待证据 |

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

## P3/P4 验收索引

- P3 checkpoint：`.agent/checkpoints/2026-09-16-kurisu-agent-p3.md`
- P4 checkpoint：`.agent/checkpoints/2026-09-16-kurisu-agent-p4.md`
- P4 real Codex trace：[`KURISU_CODEX_P4_REAL_TRACE.json`](KURISU_CODEX_P4_REAL_TRACE.json)
- P4 real verification script：[`scripts/verify-kurisu-codex.mjs`](../../scripts/verify-kurisu-codex.mjs)

## P5 验收索引

- Producer handoff：[`KURISU_AGENT_P5_PRODUCERS.md`](KURISU_AGENT_P5_PRODUCERS.md)
- Runtime notifications：[`apps/agent-runtime/src/kurisu/notifications.ts`](../../apps/agent-runtime/src/kurisu/notifications.ts)、[`apps/agent-runtime/tests/kurisu-notifications.test.ts`](../../apps/agent-runtime/tests/kurisu-notifications.test.ts)
- Codex local handoff：[`integrations/codex/codex-notify.sh`](../../integrations/codex/codex-notify.sh)、[`scripts/drain-codex-notification-spool.sh`](../../scripts/drain-codex-notification-spool.sh)、[`scripts/smoke-codex-notify.sh`](../../scripts/smoke-codex-notify.sh)
- Radar handoff：[`apps/product-radar/src/integrations/notifications/kurisu.ts`](../../apps/product-radar/src/integrations/notifications/kurisu.ts)、[`apps/product-radar/tests/notification-handoff.test.ts`](../../apps/product-radar/tests/notification-handoff.test.ts)
- P5 checkpoint：`.agent/checkpoints/2026-09-16-kurisu-agent-p5.md`

## P5 实际验证

- `pnpm --filter @agent/agent-runtime exec tsx --test tests/kurisu-*.test.ts`：`48/48 PASS`（不包含已知卡住的既有 `review-v3-2.test.ts`）。
- `pnpm --filter @agent/product-radar test`：`53/53 PASS`；`pnpm --filter @agent/product-radar typecheck`：PASS。
- `PYTHONPATH=. python3 -m unittest discover -s integrations/langbot/plugins/kurisu-gateway/tests`：`4/4 PASS`。
- `pnpm --filter @agent/agent-runtime typecheck`：PASS；`bash scripts/smoke-codex-notify.sh`：PASS；`bash scripts/deploy-langbot.sh --dry-run --plugin kurisu-gateway`：PASS；`pnpm check:secrets`、`git diff --check`：PASS。
- 未执行生产配置切换、CasaOS/LangBot/n8n 重启、插件安装、真实 Telegram/KOOK 消息；这些属于 P7。

## P6 验收索引与实际验证

- 脱敏场景报告：[`KURISU_AGENT_P6_ACCEPTANCE.json`](KURISU_AGENT_P6_ACCEPTANCE.json)；101 条记录均含 `caseId/revision/layer/modelRoute/configFingerprint/inputFixture/expectedInvariants/actualToolCalls/result/evidenceRefs`，另含执行时间、耗时和失败原因；60 条标记为独立失败改写回归，表达只存在于测试夹具，不进入 prompt 或关键词表。
- R01 反偏离报告：[`KURISU_AGENT_P6_R01.json`](KURISU_AGENT_P6_R01.json)；9 项检查通过，覆盖关键词先路由、单一 LangBot Tool、第二 Agent、通用 shell、空实现伪完成、server 前门和 A16 dummy registration。
- Release dry-run：[`KURISU_AGENT_P6_RELEASE_DRY_RUN.md`](KURISU_AGENT_P6_RELEASE_DRY_RUN.md)；脚本为 [`scripts/verify-kurisu-release-dry-run.sh`](../../scripts/verify-kurisu-release-dry-run.sh)，R02 明确 `MUTATION=none`。
- L2 server 前门：[`scripts/smoke-kurisu-http.sh`](../../scripts/smoke-kurisu-http.sh) 通过 `/healthz`、`/kurisu/status`、`/kurisu/tools`、`/kurisu/tool-call`；结构化 Gateway ingress 另由 `kurisu-acceptance.test.ts` 的 L2 fixture 覆盖。
- 配置与恢复：[`apps/agent-runtime/kurisu.env.example`](../../apps/agent-runtime/kurisu.env.example)、[`scripts/backup-kurisu-state.sh`](../../scripts/backup-kurisu-state.sh)、[`scripts/restore-kurisu-state.sh`](../../scripts/restore-kurisu-state.sh)、[`docs/runbooks/KURISU_AGENT_ROLLBACK.md`](../runbooks/KURISU_AGENT_ROLLBACK.md)。默认只读预览；不触碰生产 state。

## P6 实际命令与结果

- `pnpm --filter @agent/agent-runtime exec tsx --test tests/kurisu-*.test.ts`（在 package cwd 展开为 9 个 Kurisu 文件）：`50/50 PASS`。
- `pnpm --filter @agent/product-radar test`：`53/53 PASS`；`pnpm --filter @agent/product-radar typecheck`：PASS。
- `pnpm --filter @agent/agent-runtime typecheck`：PASS；`PYTHONPATH=. python3 -m unittest discover -s integrations/langbot/plugins/kurisu-gateway/tests`：`4/4 PASS`；Python compile：PASS。
- `node scripts/verify-kurisu-r01.mjs`：`R01_PASS`；`scripts/smoke-kurisu-http.sh`：PASS；`scripts/verify-kurisu-release-dry-run.sh`：`R02_PASS`；`scripts/backup-kurisu-state.sh --dry-run` 与安全临时归档的 `scripts/restore-kurisu-state.sh --dry-run`：PASS。
- `pnpm check:secrets`、`git diff --check`：PASS。
- `pnpm --filter @agent/agent-runtime test` 全量复测已通过：`181 passed / 0 failed / 1 skipped`。此前 `review-v3-2.test.ts` 的卡点来自默认复盘模板缺少逐人载具里程，现已补回并保留回归断言。
- 真实当前 LangBot native-agent WebSocket/platform L3 仍为 `BLOCKED`：没有合法 user/support-admin session token；P2 9Router provider trace 继续作为 provider evidence，不能替代该层。

## 证据规则

每个后续 case 必须记录 `caseId/revision/layer/modelRoute/configFingerprint/inputFixture/expectedInvariants/actualToolCalls/result/evidenceRefs`，并区分 `PASS`、`BLOCKED`、`OPEN` 与 `NOT_APPLICABLE`。任何容器 running、HTTP 200、`getMe` 或 turn ended 都不能单独作为终端交付成功证据。

本次全量 `tests/**/*.test.ts` 已完成，结果为 `181 passed / 0 failed / 1 skipped`；剩余 1 项为真实 V3.2 fixture 的显式 skip，不影响测试进程退出。
