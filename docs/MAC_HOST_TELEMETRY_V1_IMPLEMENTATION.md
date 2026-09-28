# MacHost Telemetry V1 实施记录

日期：2026-09-28  
范围：`docs/MAC_HOST_TELEMETRY_PLAN.md`

## 已实现

- `infra/macos/machostagent.py` 是 M204 macOS 宿主机遥测唯一来源。5 秒采集 native CPU/load、Memory Pressure、Swap、内存压缩/ wired、网络计数；15 秒读取 powermetrics 快照；30 秒做固定服务探针；60 秒读取 Macintosh HD 与 Avalon。
- 本地 SQLite 建立 `host_samples`、`storage_samples`、`service_samples`、`anomaly_events`、`minute_rollups`、`hourly_rollups`、`daily_rollups`。原始遥测保留 7 天，分钟聚合保留 90 天；聚合使用确定性 avg/p95/max/maxAt。
- 异常规则确定性执行：持续 CPU、Memory Pressure、Swap 增长、容量阈值、Avalon 未挂载、连续服务失败；事件带 cooldown，Amadeus lifecycle bridge 复用现有 owner outbox/delivery 与 sent marker。
- `/v1/status` 默认查询本地当天 00:00 至当前，返回 current、avg、p95、max、maxAt、持续时间、异常及 Swap 趋势；`/v1/history` 和 `/v1/anomalies` 提供历史与事件边界。
- API 用户可见容量统一为易读 GB/TB/MB；SQLite 内部保留精确 byte。Avalon 使用 mount 状态与 Volume UUID 识别。`powermetrics` 只输出带 scope/accuracy 的 SoC 估算（例如约 103 mW），整机墙上输入功耗明确为未知；HomeLab 文本按手机宽度分组并压缩服务行。
- 删除 Glances compose、61208 frp/Caddy 映射和 Amadeus Glances 配置；HomeLab 改为 MacHostAgent + 固定服务探针，OpenWrt 使用独立 `OPENWRT_BASE_URL`。
- 新增 `amadeus-mac-host-morning`（09:30）和 `amadeus-mac-host-evening`（23:00）Asia/Shanghai cron，稳定 key 为 `mac-host-report:<date>:morning|evening`，只走既有 WhatsApp owner outbox/delivery。

## 验证证据

- `python3 -m unittest infra/macos/test_machostagent.py`：10 tests passed。
- `pnpm --filter @agent/amadeus-plugin typecheck`：passed。
- `pnpm --filter @agent/amadeus-plugin test`：38 tests passed，包含群聊只读查询与通知边界。
- `pnpm test:architecture`、`pnpm check:secrets`、受影响 package build：passed。
- `bash -n scripts/deploy-openclaw.sh scripts/host-profile.sh infra/macos/install-machostagent.sh`：passed。
- M204 LaunchAgent `com.amadeus.machostagent` 已切换到仓库实现并运行；`/health`、`/v1/status`、`/v1/history`、`/v1/anomalies` 已用真实 token 查询。最新真实快照确认物理内存 `24.00 GB`、Memory Pressure `normal`、Swap `6.09 GB`、约 `102 mW` SoC estimate（不是整机输入功耗）、Avalon `7.28 TB / 981.67 GB free / mounted`，无 OrbStack guest memory fallback；`/v1/anomalies` 已使用公开 camelCase 字段驱动桥接。
- HomeLab 查询允许 Owner 或群聊上下文的只读请求；`notifyOwner` 与早晚报告仍要求 direct owner/cron，并固定写入既有 WhatsApp owner outbox。
- 候选镜像 `local/openclaw-amadeus:git-ef4c9ff39b7d-20260928083101` 健康，恢复点为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928083101`；真实晚报 cron `amadeus-mac-host-evening` 手动运行成功，摘要按手机宽度分组，功耗显示为 `mW（SoC 估算）` 并单列整机输入功耗未知，OpenWrt 只出现一次且标明独立 endpoint。最新 manual outbox key 为 `mac-host-report:manual:2026-09-28T08:37:44.486Z`。
- 异常桥真实写入并复用现有 OwnerNotifier：`mac-host-anomaly:storage_warning:avalon`、`mac-host-anomaly:service_unhealthy:ssh`、`mac-host-anomaly:swap_growth` 各有一个 `.sent.json`；经过轮询后没有重复 marker。
- 运行态已移除旧 Glances：容器、镜像、`/var/lib/casaos/apps/glances` 和 61208 配置均不存在；旧 compose 仅保存在 `/DATA/AppData/openclaw/backups/amadeus-glances-retired-20260928081939/docker-compose.yml` 恢复点中。

以上证据覆盖 M204 查询、历史聚合、候选 HomeLab 报告、owner outbox 投递、异常 dedupe/cooldown 和运行态退休清理。
