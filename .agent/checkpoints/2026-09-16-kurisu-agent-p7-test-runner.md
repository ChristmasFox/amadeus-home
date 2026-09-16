# Kurisu P7 前置：agent-runtime 全量测试恢复

- 日期：2026-09-16（Asia/Shanghai）
- 问题：全量 agent-runtime 验证此前被记录为 `review-v3-2.test.ts` 卡住；复测发现实际失败是默认复盘模板没有输出有证据队员的逐人载具里程，导致既有断言失败。
- 修复：`apps/agent-runtime/src/review/presentation.ts` 的默认“环境与载具”段现在保留逐人驾驶/乘车里程和最高速度；未确认驾驶人的证据边界文案不变。
- 验证：`pnpm --filter @agent/agent-runtime test` = `181 passed / 0 failed / 1 skipped`；`pnpm --filter @agent/agent-runtime typecheck` = `PASS`；`git diff --check` = `PASS`。
- 运行时边界：本阶段只修改仓库源码和状态文档，没有重启 CasaOS、没有安装 Kurisu 插件、没有切换 rollout、没有发送平台消息。
- 回滚：回退本 checkpoint 对应源码提交即可；没有运行时数据写入。
