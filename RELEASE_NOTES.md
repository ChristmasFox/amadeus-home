# Amadeus 1.4.4

收口 Operation Skuld 的存储与运行时边界：

- 为 Immich 外置媒体迁移增加 8TB volume identity、sentinel、device/free-space fail-closed
  preflight；copy-first、checksum equivalence、fresh PostgreSQL backup、cutover 后健康检查，
  旧源保留并由独立 reclaim gate 控制。
- 将 Immich、9Router、changedetection 和 media adapter 纳入迁移 manifest、service inventory、
  metadata-only secret inventory 与加密 secret bundle export/import rehearsal。
- 为主运行时、Product Radar、9Router、Immich 和 changedetection 固定 Docker stdout/stderr
  rotation；清理仅覆盖受保护规则允许的 dangling image/build cache，未知日志和数据保持报告。
- 增加 storage health、外置盘失联/恢复和实际释放空间的 Worldline owner notification producer，
  并修复 readiness 的动态版本校验。

验证：`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm check:secrets`、architecture、
storage-runtime、migration-readiness、notification tests 和脚本语法检查通过。
