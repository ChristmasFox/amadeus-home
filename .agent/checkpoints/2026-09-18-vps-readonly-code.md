# VPS read-only capability code checkpoint

日期：2026-09-18（Asia/Shanghai）

## 已完成

- `plugins/amadeus/src/vps.ts` 只调用固定 KiwiVM `getServiceInfo`、`getLiveServiceInfo`、
  `getRawUsageStats`，并通过固定命令读取 uptime/load/memory/root filesystem 与四个 critical
  systemd unit。
- 新增 `amadeus_vps_service_info`、`amadeus_vps_live_status`、`amadeus_vps_usage`、
  `amadeus_vps_system_status`、`amadeus_vps_services` 和 `plugins/amadeus/skills/vps/SKILL.md`。
- 流量状态原子写入外部 `/data/vps-usage-state.json`，以
  `lastSuccessfulCounter`/`lastSuccessfulAt` 为最小 baseline，并保留 quota/reset 元数据以便
  API 失败时返回完整的上一份成功流量数据；失败查询返回 stale/error，不把失败当成 0。
- CasaOS compose、OpenClaw config、prepare/deploy preflight、secret mounts 和 09:30/23:00
  Asia/Shanghai VPS report cron 模板已更新。

## 验证

- `pnpm --filter @agent/amadeus-plugin typecheck`：PASS
- `pnpm --filter @agent/amadeus-plugin test`：9/9 PASS
- `pnpm build:amadeus`：PASS
- `bash -n scripts/deploy-openclaw.sh`、`python3 -m py_compile scripts/openclaw_prepare.py`：PASS
- manifest/config JSON validation、`git diff --check`：PASS

## 尚未完成

- CasaOS 外部 `kiwivm-credentials.json`、受限 VPS SSH key/known-hosts 尚未提供/安装；没有执行
  新镜像 apply，也没有把未部署代码冒充真实 KiwiVM 或 WhatsApp owner DM 证据。
- 真实自然语言工具选择、09:30/23:00 真实送达、重启后 cron/traffic state 持久化仍待 live
  验收。
