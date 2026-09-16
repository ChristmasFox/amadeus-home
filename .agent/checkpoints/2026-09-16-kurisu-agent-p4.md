# Kurisu Agent P4 checkpoint

日期：2026-09-16（Asia/Shanghai）
状态：IMPLEMENTED / VERIFIED_LOCAL / L3_BLOCKED
基线：P3 implementation workspace（P2 `8c12728`）

## 本阶段交付

- `apps/agent-runtime/src/kurisu/codex.ts` 固定一种 `codex app-server --stdio` executor，使用实际安装的 `codex-cli 0.153.4` 协议；包含 JSONL JSON-RPC client、事件/通知、server request、审批/用户输入等待、失败/中断和同 thread resume。
- `CodexProjectRegistry` 只接受服务端配置的绝对 Git root；默认创建 executor-owned detached worktree，拒绝 dirty root、任意 cwd、越界 worktree、不同 common Git dir 和覆盖已有源工作区。
- `kurisu_jobs` 持久化 `jobId/projectId/workspaceRef/threadId/turnId/goal/constraints/status/evidence`；`codex-tools.ts` 注册 start/status/list/resume/cancel，生产默认不配置 project registry，不会自行 spawn Codex。
- `scripts/verify-kurisu-codex.mjs` 在临时 Git repo/worktree 运行真实 Codex 小任务，仅向 `README.md` 添加 `KURISU_P4_REAL_OK` 并执行 `git diff --check`；脱敏结果保存于 `docs/reports/KURISU_CODEX_P4_REAL_TRACE.json`。

## 验证证据

- `pnpm --filter @agent/agent-runtime exec tsx --test tests/kurisu-codex.test.ts tests/kurisu-service.test.ts tests/kurisu-storage-tasks.test.ts`：定向通过（12/12）。
- `pnpm --filter @agent/agent-runtime typecheck`：通过。
- `pnpm --filter @agent/agent-runtime exec node --import tsx/esm ../../scripts/verify-kurisu-codex.mjs`：真实隔离任务通过；source repository clean、changed files 仅 `README.md`、marker 和 `git diff --check` 均验证。
- `pnpm check:secrets`、`git diff --check`：通过。

## 边界与回滚

- 真实隔离任务没有触发 approval request；等待 approval/user-input 由 deterministic fake App Server 测试覆盖，不能把本次 real run 写成真实审批通过。
- 未使用 agent-monorepo、生产项目、CasaOS、LangBot/n8n、真实平台消息或 Telegram/KOOK sender。
- 全量测试在既有 `review-v3-2.test.ts` 子进程持续高 CPU、无新增输出后中断，未记为全量通过；P6 需分批复测并保留已知风险。

## 下一阶段

P5 接入可靠 notification events/deliveries worker、渠道独立重试、producer handoff、偏好/有限记忆和 Kurisu 语气；Codex executor 只写标准事件，不直接发送平台消息。
