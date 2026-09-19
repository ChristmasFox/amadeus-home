# PUBG 北京时间展示修复 checkpoint

- 日期：2026-09-19（Asia/Shanghai）
- 版本：`1.1.5`
- 提交：`fdf331c`（`fix(pubg): render all times in Beijing timezone`）
- 线上镜像：`local/openclaw-amadeus:git-fdf331cbca89-20260919071937`
- 外部恢复点：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919071937`
- 目标：OrbStack `ubuntu` 内的 CasaOS OpenClaw

## 修复

- PUBG tool 保留 UTC 原始时间字段作为机器证据。
- 所有用户可见时间使用 `dataUpdatedAtLocal`、`asOfLocal`、`*Local` 和
  `dataSourceRange.fromLocal/toLocal`，时区明确为 `Asia/Shanghai`。
- D-mail 的 `数据更新时间` 按北京时间展示。
- `2026-09-17T22:00:00Z` 现在显示为北京时间 `2026-09-18 06:00`，不再误标为 22:00。

## 验证

- PUBG Domain：20/20
- Identity：10/10
- PUBG plugin：9/9
- Amadeus：11/11
- PUBG/Amadeus build、typecheck、`pnpm check:secrets`、`git diff --check`：通过
- CasaOS deploy health、preflight、媒体网络、NAS 只读、owner WhatsApp outbox smoke：通过
- live OpenClaw：`running/healthy`
- live bundle：已核实 `dataUpdatedAtLocal`、`fromLocal/toLocal`、`startedAtLocal` 和北京时间规则
- 未发送未经请求的真实群聊测试消息
