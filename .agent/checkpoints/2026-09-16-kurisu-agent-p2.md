# Kurisu Agent P2 checkpoint

日期：2026-09-16（Asia/Shanghai）  
状态：IMPLEMENTED / VERIFIED_LOCAL / L3_BLOCKED  
基线：`58b33d5`（P1）

## 本阶段交付

- `apps/agent-runtime/src/kurisu/read-only.ts`：将现有 `PubgMastraRuntime` 作为内部 deterministic subworkflow，接入结构化 PUBG query/list/review；接入 HomeHub registry/status/diagnose/audit；接入 Product Radar bounded HTTP GET；实体解析在零/多候选时只返回 `needs_input`。
- `apps/agent-runtime/src/runtime/workflow.ts`：增加内部 `structuredOnly` 标记，使已校验的 canonical query 不再被原始文本 planner 覆盖；公共文本入口未开放该字段。
- `apps/agent-runtime/src/runtime/homehub-runtime.ts`：增加结构化服务枚举与受限诊断 facade；`apps/agent-runtime/src/kurisu/storage.ts`：增加 principal-owned notification event/delivery 诊断读取。
- `integrations/langbot/plugins/kurisu-gateway/components/tools/kurisu_gateway.yaml`：由于 provider 拒绝带点号的函数名，外部只暴露合法 `kurisu_gateway`；内部 `toolName` 仍由 enum、runtime schema 和 registry 约束。Python adapter 生成 retry-stable boundary call ID，不接受模型自填 trusted metadata。
- 真实 provider 轨迹：`docs/reports/KURISU_AGENT_P2_PROVIDER_TRACE.json`。当前 `arthur-combo` 在隔离 synthetic Radar tool results 下连续三轮 HTTP 200，顺序为 list → status（消费第一步返回的 watchId）→ final。

## 验证证据

- `pnpm workflow:plan`：RUNTIME；Docker build forbidden；LangBot plugin workflow required。
- `pnpm --filter @agent/agent-runtime typecheck`：通过。
- Kurisu runtime targeted tests：`24/24` 通过；新增覆盖 PUBG canonical adapter/source unavailable、HomeHub service selection/audit scope、Radar success/429/invalid JSON/timeout、entity ambiguity、principal-scoped notification diagnosis。
- `python3 -m unittest discover -s integrations/langbot/plugins/kurisu-gateway/tests`：`4/4` 通过；`python3 -m py_compile` 通过。
- `scripts/deploy-langbot.sh --plugin kurisu-gateway --dry-run --skip-runtime-check`：package dry-run 通过，未安装/重启/写 CasaOS。
- 真实 provider 首次使用 dotted internal names 时返回 schema 503；修复外部 alias 后重跑，HTTP 200 三轮连续工具轨迹通过。provider key、bot token、真实消息和私有 prompt 未写入报告。
- `pnpm check:secrets`、`git diff --check`：通过。

## 边界与回滚

- 未执行 LangBot API install、Pipeline 修改、CasaOS compose、Docker build、生产数据库写入或真实 Telegram/KOOK 消息。
- 真实 LangBot native-agent WebSocket/platform entry 仍因缺少合法 user/support-admin session token 为 `BLOCKED`；本 checkpoint 的 provider/fake 轨迹不宣称 L3，历史 EventListener 仍未迁移。
- 如需回退 P2，恢复到 P1 commit `58b33d5`；P2 未触碰外部 runtime 状态。

## 下一阶段

P3 在现有 durable store 上接入安全写工具、任务 worker、审批/授权和恢复/取消闭环；所有外部动作继续只用 fake/隔离执行器验证，除非另行授权。
