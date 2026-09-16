# Kurisu P7：SQLite 持久化权限保证

- 日期：2026-09-16（Asia/Shanghai）
- 问题：live state 已经手工收紧为 `0600`，但 `KurisuStore` 源码没有持续保证新建主库和 WAL/SHM sidecar 的权限。
- 修复：`KurisuStore` 在磁盘库建库后、事务提交后，对主库、`-wal`、`-shm` 执行 `chmod 0600`；不存在的 SQLite sidecar 忽略，后续创建会在下一次提交收紧。
- 验证：`kurisu-storage-tasks.test.ts` `6/6 PASS`；agent-runtime typecheck、secret scan、diff check 通过。
- 发布边界：本 checkpoint 记录源码阶段；需要随下一次 immutable image 发布，重建 Runtime 后核验权限仍为 `0600`。当前插件/rollout/真实平台消息不变。
