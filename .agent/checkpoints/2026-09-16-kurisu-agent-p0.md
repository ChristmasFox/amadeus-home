# Kurisu P0 checkpoint

日期：2026-09-16（Asia/Shanghai）  
阶段：`P0_HOST_FIXED_LOCAL / REAL_PARTIAL`  
Git：`main`，审阅提交 `042d5c3`；本 checkpoint 之后的工作区变更为本阶段待提交内容。

## 本阶段变更

- 固定 Path A：LangBot 4.10.8 原生 `local-agent` + 现有 9Router/`arthur-combo` 为唯一自然语言主 Agent；Mastra 仅保留 PUBG deterministic subworkflow。
- 新增 `apps/agent-runtime/src/kurisu/host-probe.ts` 与定向测试，验证 typed tool、tool result correlation、依赖调用和 bounded failure。
- 新增宿主 ADR、能力/生产者盘点、脱敏 baseline、复现记录和阶段进度报告。
- 更新 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md`、`.agent/state.md` 与实施任务状态。

## 已验证

- LangBot 只读 API：1 Pipeline、2 enabled platform bots、6 installed plugins；Pipeline 为 `local-agent`、全量工具、`max-round=10000`，主模型记录为 `arthur-combo`/9Router，具备 vision/func_call/reasoning。
- 当前 9Router provider：文本 tool call、合法 JSON 参数、tool result continuation、structured error result、1x1 PNG data URI tool call 均 HTTP 200；provider key 未输出、未写入 Git。
- `pnpm --filter @agent/agent-runtime typecheck`：通过。
- `pnpm --filter @agent/agent-runtime exec tsx --test tests/kurisu-host-probe.test.ts`：2/2 通过。
- `git diff --check`：通过（提交前需再次执行）。
- 生产容器、LangBot Pipeline、Watch、n8n 和真实平台消息：未修改。

## 风险与阻塞

- LangBot dashboard WebSocket 需要 user/support-admin token；现有管理 API key 不具备会话身份，故没有伪造 session 或发送真实消息。native-agent platform entry 要在后续取得合法隔离测试身份后再做 L2/L3。
- 当前共享 Pipeline 仍含旧 EventListener；P1 必须做迁移 rollout 和 single-consumer 证明。
- 仓库没有发现独立 briefing producer；P5/P6 需保留 gap。

## 下一步

实现 P1：定义 Kurisu contract/envelope/trusted context/tool registry，加入结构化 Gateway 与 legacy listener migration boundary；先跑 `pnpm workflow:plan`，不做 Docker build/deploy。
