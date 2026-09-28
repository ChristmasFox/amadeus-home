# MacHost Telemetry V1 实施记录

日期：2026-09-28  
范围：`docs/MAC_HOST_TELEMETRY_PLAN.md`

## 已实现

- `infra/macos/machostagent.py` 是 M204 macOS 宿主机遥测唯一来源。5 秒采集 native CPU/load、Memory Pressure、Swap、内存压缩/ wired、网络计数；15 秒读取 powermetrics 快照；30 秒做固定服务探针；60 秒读取 Macintosh HD 与 Avalon。
- 本地 SQLite 建立 `host_samples`、`storage_samples`、`service_samples`、`anomaly_events`、`minute_rollups`、`hourly_rollups`、`daily_rollups`。原始遥测保留 7 天，分钟聚合保留 90 天；聚合使用确定性 avg/p95/max/maxAt。
- 异常规则确定性执行：持续 CPU、Memory Pressure、Swap 增长、容量阈值、Avalon 未挂载、连续服务失败；事件带 cooldown，Amadeus lifecycle bridge 复用现有 owner outbox/delivery 与 sent marker。
- `/v1/status` 默认查询本地当天 00:00 至当前，返回 current、avg、p95、max、maxAt、持续时间、异常及 Swap 趋势；`/v1/history` 和 `/v1/anomalies` 提供历史与事件边界。
- API 用户可见容量统一为易读 GB/TB/MB；SQLite 内部保留精确 byte。Avalon 使用 mount 状态与 Volume UUID 识别。
- 删除 Glances compose、61208 frp/Caddy 映射和 Amadeus Glances 配置；HomeLab 改为 MacHostAgent + 固定服务探针，OpenWrt 使用独立 `OPENWRT_BASE_URL`。
- 新增 `amadeus-mac-host-morning`（09:30）和 `amadeus-mac-host-evening`（23:00）Asia/Shanghai cron，稳定 key 为 `mac-host-report:<date>:morning|evening`，只走既有 WhatsApp owner outbox/delivery。

## 验证证据

- `python3 -m unittest infra/macos/test_machostagent.py`：10 tests passed。
- `pnpm --filter @agent/amadeus-plugin typecheck`：passed。
- `pnpm --filter @agent/amadeus-plugin test`：37 tests passed。
- `bash -n scripts/deploy-openclaw.sh scripts/host-profile.sh infra/macos/install-machostagent.sh`：passed。
- M204 LaunchAgent `com.amadeus.machostagent` 已切换到仓库实现并运行；`/health`、`/v1/status`、`/v1/history`、`/v1/anomalies` 已用真实 token 查询。真实快照确认物理内存 `24.00 GB`、Memory Pressure、Swap `5.14 GB`、powermetrics SoC estimate、Avalon `7.28 TB / 981.67 GB free / mounted`，无 OrbStack guest memory fallback。

待最终 runtime acceptance：通过 candidate OpenClaw 部署执行 HomeLab 查询、晨间/晚间 owner outbox 投递及异常 dedupe/cooldown 证据；未完成前不宣称 Goal 完成。
