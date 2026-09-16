# Kurisu Agent P3 checkpoint

日期：2026-09-16（Asia/Shanghai）
状态：IMPLEMENTED / VERIFIED_LOCAL / L3_BLOCKED
基线：`8c12728`（P2）

## 本阶段交付

- `apps/agent-runtime/src/kurisu/storage.ts` 增加 message-task links、持久化审批参数、server-bound callback、任务/Job 查询和终态安全转换；SQLite WAL/迁移继续由 runtime 所有。
- `write-tools.ts` 接入 HomeHub action、Radar mutate/create、媒体 move 和 task cancel。写请求先保存 intent/idempotency，再由 `TaskEngine` 执行、reconcile、取消或进入 unknown；生产 `KURISU_ENABLE_WRITE_TOOLS` 默认关闭。
- 审批只接受服务端生成的 callback，绑定 principal/session/run/action/arguments hash/expiry，一次消费；公开上下文不能通过确认按钮提升为写权限。
- `kurisu-write-tools.test.ts` 覆盖 C07–C14、T03–T12 相关行为，以及外部请求前、结果落库前、答复前三处 crash injection、并发、timeout、unknown、Radar adapter 和媒体路径防覆盖。

## 验证证据

- `pnpm --filter @agent/agent-runtime typecheck`：通过。
- P3 定向 runtime 测试：`kurisu-write-tools.test.ts` 与相关 storage/service 测试通过；测试使用 fake 下游和临时目录，未执行生产写。
- `pnpm check:secrets`、`git diff --check`：通过。

## 边界与回滚

- 未执行 HomeHub/Radar/媒体真实写、CasaOS compose、Docker build、LangBot install/restart 或 Telegram/KOOK 消息。
- 真实 LangBot native-agent 平台入口继续因缺少合法 user/support-admin session token 为 `BLOCKED`；fake/facade 证据不代替 L3/L4。
- 如需回退 P3，可恢复到本阶段提交前的 P2 commit `8c12728`；P3 未写外部运行时状态。

## 下一阶段

P4 将在本地 macOS 通过官方 `codex app-server --stdio` 接入单一 executor；真实任务只允许临时隔离 Git repo/worktree。
