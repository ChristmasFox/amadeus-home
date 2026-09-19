# PUBG Telemetry 预取源代码 checkpoint

- 日期：2026-09-19（Asia/Shanghai）
- 目标：修复 Telemetry `MISS` 语义，增加每小时增量预取/重试账本、PUBG 数据更新时间字段和每日 D-mail 汇总。
- 版本：`1.1.0`；唯一版本源为根目录 `VERSION`，`RELEASE_NOTES.md` 已同步。
- 业务日：交互查询继续使用 `06:00`；每日 00:00 汇总上一自然日 `00:00–24:00`。
- 新工具：`pubg_prefetch_telemetry`、`pubg_telemetry_sync_report`。
- Telemetry 状态：`HIT`=缓存读取；`FETCHED/cacheStatus=MISS/availability=AVAILABLE`=成功请求并写缓存；`UNAVAILABLE`=当前不可用。
- 预取默认：每小时玩家发现 1 次、最多处理 20 场、并发 2；失败写入 SQLite retry ledger。
- 自动通知：`Amadeus • D-mail`，稳定 `pubg-sync:<date>` event key，正文末尾 `El Psy Kongroo.`。
- 已通过：`pnpm test:pubg`、`pnpm typecheck:pubg`、`pnpm build:pubg`、`pnpm check:secrets`、`bash -n scripts/deploy-openclaw.sh`、`git diff --check`、版本检查。
- 待执行：提交后运行 `scripts/deploy-openclaw.sh --apply --build-auto`，验证 live image、8 个 PUBG tools、两个 PUBG cron、SQLite 新表和健康/owner outbox smoke。
- 回滚：部署脚本会在 CasaOS 切换前写入外部 `/DATA/AppData/openclaw/backups/<checkpoint>`，不把运行数据或 secret 写入 Git。
