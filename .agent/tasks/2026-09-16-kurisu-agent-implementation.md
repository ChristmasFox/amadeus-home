# Kurisu 统一 Agent 实施任务

状态：P0_COMPLETE_LOCAL / P1_COMPLETE_LOCAL / P2_COMPLETE_LOCAL / P3_COMPLETE_LOCAL / P4_COMPLETE_LOCAL / P5_COMPLETE_LOCAL_WITH_BRIEFING_BLOCKER / P6_COMPLETE_LOCAL_WITH_L3_AND_BRIEFING_BLOCKERS。用户要求先提交实施计划，随后由本机 Codex Goal 完成 P0–P6；P7 仍未授权。

入口：`docs/KURISU_CODEX_GOAL.md`。
规格：`docs/KURISU_AGENT_IMPLEMENTATION_PLAN.md`。
验收：`docs/KURISU_AGENT_ACCEPTANCE.md`。

P0 已完成：Path A 固定为 LangBot 4.10.8 原生 `local-agent` + 9Router；已创建 ADR、能力/生产者盘点、脱敏 baseline、复现记录和 fake host probe。真实 provider 层 tool/JSON/图文/失败传播通过；由于缺少合法 LangBot user/support-admin session token，真实 native-agent WebSocket/platform entry 保持 BLOCKED，不把 API key 当作用户身份。

后续顺序：P1 契约与结构化工具、P2 只读主 Agent 闭环、P3 持久化任务及安全写、P4 Codex executor、P5 统一通知/偏好/记忆/表达、P6 集成验收与 Release 准备均已完成本地实现与对应证据；P7 单独授权后部署。

P1 已完成：结构化 inbound/tool/result/context 契约、stable identity/session、trusted server-side policy、ToolRegistry、callback binding/replay protection、SQLite WAL/migration、task intent/reconcile/cancel、审批参数绑定、媒体路径 allowlist，agent-runtime `/kurisu/*` 边界，以及只含 Tool component 的 LangBot `kurisu-gateway` 插件。P2 已接入 PUBG deterministic runtime、HomeHub/Radar 只读适配、principal-scoped notification diagnosis 和 provider-compatible 单一外部工具名；真实 provider 三轮连续工具轨迹见 `docs/reports/KURISU_AGENT_P2_PROVIDER_TRACE.json`。P3/P4 已完成 durable write/approval/reconcile/cancel、Codex App Server executor、Git project registry/worktree isolation 和真实临时仓库验证，具体命令/边界见阶段 checkpoint。P5 证据：Runtime notification worker、Codex hook/spool、Product Radar central handoff、structured write event、偏好/语气测试和 producer 清单已提交到当前工作区；P6 证据：101 条场景、R01/R02、HTTP smoke、配置/备份/恢复/runbook 见 `docs/reports/KURISU_AGENT_P6_ACCEPTANCE.json`、`KURISU_AGENT_P6_R01.json` 和 `KURISU_AGENT_P6_RELEASE_DRY_RUN.md`。未完成项：真实 briefing producer（`BLOCKED_UNSUPPORTED`）、旧 PUBG/Product Radar EventListener 的 session rollout/single-consumer 迁移、合法 LangBot native session L2/L3、全量既有 `review-v3-2.test.ts` runner 挂起；生产配置、平台消息、插件安装和部署均保持未触碰。

P6 验收结果：实现提交 `24946b9`；101 条结构化 L2 变体中 60 条是独立失败改写，A16 dummy battery 只在测试注册；Kurisu `50/50`、Product Radar `53/53`、typecheck、plugin `4/4`、Python compile、R01 `9/9`、R02、HTTP smoke、secret scan、diff check 通过。全量 agent-runtime 复测在既有 review runner 后无新增输出，有界终止并记录为 `KNOWN_HANG / NOT_FULL_PASS`。真实 LangBot native-agent platform L2/L3 仍因合法 session 缺失 blocked；P7 不在本任务授权内。
