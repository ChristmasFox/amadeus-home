# PUBG Intent Router 时间词误判

日期：2026-09-05
状态：IMPLEMENTED / TARGETED VERIFIED / COMMITTED
前置：HomeHub V1.1 已提交 `e0a3ed5`，V1.1 测试、secret scan、checkpoint 和 commit 已完成。

## 目标

修复时间词被误判为 PUBG Intent 的问题：

- TimeRange 只能作为参数，不能单独触发 PUBG；
- 先判断 Domain/Intent，再解析 TimeRange；
- 只有明确 PUBG 语义，或 `activeDomain=pubg` 的有效追问，才进入 PUBG；
- 不使用堆积 negative keywords 的方式修复。

## 必须回归

- `昨天战绩` → PUBG；
- PUBG 上下文后的 `前天呢？` → PUBG；
- `昨天超的是CL30, tRCD 36, tRP 36, tRAS 80` → NOT PUBG；
- `昨天 Emby 挂了吗` → HomeHub / NOT PUBG。

## 验证边界

只运行 targeted tests 和 affected typecheck；不执行 Docker build、Release、Compose 或部署。
已更新 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md`、`.agent/state.md`，并写入日期 checkpoint；代码与文档已以独立 Git commit `d12b733` 结束。
