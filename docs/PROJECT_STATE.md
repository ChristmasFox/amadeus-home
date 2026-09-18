# Project State

更新时间：2026-09-18（Asia/Shanghai）

## 当前目标

当前唯一产品目标是 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md：把仍有价值的旧
LangBot/n8n/通知能力迁移到 OpenClaw/Kurisu 原生 Amadeus plugin 与独立服务，保留
PUBG plugin/domain、当前 9Router 和必要聊天渠道，删除旧执行路径。

## 本轮实现

- 新增 plugins/amadeus：Product Radar、媒体 scan/preview/execute、NAS、HomeLab、
  KOOK current-channel lookup、briefing、owner notifier 和 retry worker。
- Product Radar 已去除 LangBot/Telegram/KOOK notification bridge，业务事件改写
  channel-free owner outbox。
- Codex completion/failure/cancel hook 改为写 owner outbox；OpenClaw worker 是唯一
  WhatsApp owner delivery。
- briefing 配置保留旧日报的 AI、前端、基础设施、芯片/市场、日本、官方 RSS/Atom、GitHub
  releases/API、早报/晚报和 9Router summary；不再依赖 n8n/LangBot credential。
- NAS 控制脚本移到 infra/macos/nas-control.sh，旧 LangBot plugin 源退出主链。
- CasaOS 模板、OpenClaw workspace、部署脚本和配置已切换到 Amadeus。
- OpenClaw owner agent 使用 `tools.profile="full"`；WhatsApp owner identity 仍由
  `commands.ownerAllowFrom` 和外部 owner target 注入，新增 native tools 不会再次被 PUBG-only
  allowlist 隐藏。
- 删除/退休清单已落到新部署入口：LangBot、n8n、n8n-sandbox、旧业务插件、旧通知/
  watchdog/workflow/facade 路径。

## 真实切换前 baseline

在本次 apply 前，CasaOS 仍有旧 langbot、langbot_plugin_runtime、n8n、
n8n-sandbox-api，以及独立的 Product Radar、media-organizer-adapter、changedetection、
9Router 和旧 OpenClaw。旧 LangBot Telegram bot 已禁用；KOOK token、NAS SSH key 和
WhatsApp owner target 只在切换脚本中从外部运行状态恢复，绝不打印或提交。

## 最终线上状态（2026-09-18）

- source commit `5e76709` 构建的镜像已部署：
  `local/openclaw-amadeus:git-5e767097adda-20260918080012` 和
  `local/product-radar:git-5e767097adda-20260918080012`。
- 最终 checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918080634`。
- OpenClaw/Product Radar health、media adapter network、NAS read-only smoke 和 owner
  WhatsApp outbox smoke 均 PASS；briefing cron `amadeus-briefing-morning`、
  `amadeus-briefing-evening` 已注册。
- `tools.profile=full` 且没有 `tools.allow`；WhatsApp 群组是 open、免 mention，并且没有
  群组级 tools/toolsBySender 限制。WhatsApp owner DM 仍为 allowlist，高风险工具继续按
  owner/confirmation policy 保护。
- `pubg` 和 `amadeus` 均以 `origin= bundled`、`trust= bundled` 加载；旧 LangBot/n8n
  容器、app/data 路径和 KOOK watchdog systemd timer 已退出。watchdog 可恢复副本位于
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918080449/retired-systemd`。

## 验证证据

- PUBG Domain、PUBG plugin、Amadeus plugin、Product Radar 定向测试已通过；Product Radar
  和 Amadeus typecheck 已通过。
- owner outbox 测试确认事件无 channel/recipient 字段，写入原子且幂等。
- live baseline 只加载 `pubg`，`tools.allow` 只有六个 PUBG tool；这是截图中“其他功能以后再解锁”
  的直接原因，已在 Git 模板和部署 preflight 中修复为 full profile + Amadeus plugin。
- OpenClaw Gateway send RPC 已依据锁定 2026.9.4 协议使用 to，不是 CLI 表面的 --target
  字段。
- scripts/deploy-openclaw.sh --dry-run、三次 apply 路径所需的 shell/python syntax、git
  diff --check、最终全量 build/typecheck/test/secrets scan 已通过；最终 apply 以 exit 0
  完成。
- 媒体整理继续受 organize-emby-media Skill 的备份、单项、preview-confirm、碰撞检查
  和不修改现有媒体库约束保护。

## 运行与恢复边界

canonical CasaOS target 是 OrbStack ubuntu，Compose 为
/var/lib/casaos/apps/openclaw/docker-compose.yml 和
/var/lib/casaos/apps/product-radar/docker-compose.yml；OpenClaw data 为
/DATA/AppData/openclaw。真实切换前必须生成
/DATA/AppData/openclaw/backups/amadeus-openclaw-<UTC>，并在本机为 Codex hook 生成外部
备份。旧数据库/credentials 只放 checkpoint，不构成 fallback。
