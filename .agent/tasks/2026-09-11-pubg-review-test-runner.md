# PUBG 复盘全量测试 runner 卡点

- 日期：2026-09-11
- 状态：RESOLVED / 2026-09-16
- 根因：默认复盘模板已经迁移到 `templateEnvironmentSection`，但既有回归仍要求旧的逐人“乘车 7.9km”文本；这会让完整 runner 以 1 个失败结束，之前的无输出现象也不能被误报为通过。
- 修复：在默认“环境与载具”段补回有证据队员的逐人驾驶/乘车里程与最高速度，继续保留未确认驾驶人的边界文案。
- 证据：`pnpm --filter @agent/agent-runtime test`：181 passed、0 failed、1 skipped；`pnpm --filter @agent/agent-runtime typecheck`：PASS；`git diff --check`：PASS。
