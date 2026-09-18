# Project State

更新时间：2026-09-18（Asia/Shanghai）

## 当前目标

当前唯一产品目标是 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md：把仍有价值的旧
LangBot/n8n/通知能力迁移到 OpenClaw/Kurisu 原生 Amadeus plugin 与独立服务，保留
PUBG plugin/domain、当前 9Router 和必要聊天渠道，删除旧执行路径。

## 跨渠道 Identity 实现（2026-09-18，已部署，真实入口验收待完成）

- `packages/identity` 提供 SQLite `persons`、`channel_identities`、`aliases` 和
  `external_accounts`，支持预设导入、跨 Telegram/WhatsApp trusted sender/mention/reply
  绑定、群级 alias 优先级、observed candidate 和 owner-confirmed 升级；不保存完整聊天历史。
- `plugins/amadeus` 新增七个 `identity_*` native tools 及 `skills/identity`。confirmed 绑定、
  alias 和 external account 的写入受 owner/Arthur gate；工具参数是结构化数据，不解析命令或
  关键词。生产身份数据库和预设路径在 `/data` 外部持久化，未把个人 ID/JID 写入仓库。
- `plugins/pubg` 只在 plugin 边界把 Person 的 `provider=pubg` account 转换为配置团队中的
  player id，或通过官方 resolve 得到 account id，再传给 `packages/pubg-domain`；Domain 不
  感知渠道身份。缺少可信 binding/account 时 fail closed，不回退默认队伍。
- 定向 identity、Amadeus、PUBG adapter/boundary 测试和受影响 build/typecheck 已通过；新
  OpenClaw image 已 apply 到 CasaOS，运行时 inspect 显示七个 Identity tools 和 `identity`
  Skill 均 loaded/eligible。只读 Gateway smoke 已实际调用 `identity_resolve` 并 fail closed；
  线上 SQLite 已创建但四张身份表均为 0 行。
- 线上切换 checkpoint 为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918091819`；
  真实 Telegram/WhatsApp inbound sender metadata、owner binding、provider account/link、
  alias confirmation 和重启后有数据持久化仍待用户入口验收。

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
- 全局 `workspace/AGENTS.md` 只保留架构、工具真实性、会话、owner 通知和副作用安全原则；
  PUBG 身份、selector、Telemetry、比较和证据规则全部位于 `plugins/pubg/skills/pubg/SKILL.md`。
  `SOUL.md` 只描述 Kurisu 的通用行为，不把全局上下文锁成 PUBG-only。
- `openclaw_prepare.py` 只验证 OpenClaw 当前 secret 文件，不读取旧 LangBot DB 或旧凭据；
  Codex hook 会把事件写入远端 OpenClaw owner outbox。
- OpenClaw owner agent 使用 `tools.profile="full"`；WhatsApp owner identity 仍由
  `commands.ownerAllowFrom` 和外部 owner target 注入，新增 native tools 不会再次被 PUBG-only
  allowlist 隐藏。
- 删除/退休清单已落到新部署入口：LangBot、n8n、n8n-sandbox、旧业务插件、旧通知/
  watchdog/workflow/facade 路径。

## 部署构建优化（2026-09-18，已用于本次 Identity 发布）

- `scripts/deploy-openclaw.sh --apply --build-auto` 从 CasaOS 当前容器 image tag 读取 source
  commit：只要 `plugins/pubg`、`plugins/amadeus`、`packages/pubg-domain` 或 OpenClaw
  Dockerfile 变化才构建 OpenClaw；只有 `apps/product-radar` 变化才构建 Product Radar。
- `--apply --no-build` 复用现有 immutable images，但发现业务 source 超出 image commit 时
  fail closed；`--build-openclaw`/`--build-radar` 支持单镜像发布，`--build` 仍是全量入口。
- 选择性发布使用受影响 package 的 build/typecheck/test；本次 `--build-auto` 只重建了
  OpenClaw，复用了未受影响的 Product Radar image。

## 真实切换前 baseline

在本次 apply 前，CasaOS 仍有旧 langbot、langbot_plugin_runtime、n8n、
n8n-sandbox-api，以及独立的 Product Radar、media-organizer-adapter、changedetection、
9Router 和旧 OpenClaw。旧 LangBot Telegram bot 已禁用；KOOK token、NAS SSH key 和
WhatsApp owner target 只在切换脚本中从外部运行状态恢复，绝不打印或提交。

## 前一阶段线上状态（2026-09-18，Identity 发布前）

- 部署配置 Git commit 为 `42ef93a`；当前运行镜像由 `5fd139d` 构建：
  `local/openclaw-amadeus:git-5fd139d3e58d-20260918081806` 和
  `local/product-radar:git-5fd139d3e58d-20260918081806`。
- 最终 checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918082357`。
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
- 本次上下文拆分、部署脚本和 Codex hook 修复的本地 build/typecheck/test/secrets scan 已通过；
  Identity 变更随后由 `05471a8` image 发布，见上方 Identity 线上状态。
- 自然语言 Product Radar 只读 smoke 成功选择 `amadeus_product_radar` 并返回 1 个监控项；
  Codex hook smoke 的远端 sent marker 已确认，outbox event 无 channel/recipient/to 字段。
- OpenClaw 内部 service names 已加入 `NO_PROXY`，修复代理环境下 Amadeus 工具访问 Product
  Radar 的 fetch failure。
- 媒体整理继续受 organize-emby-media Skill 的备份、单项、preview-confirm、碰撞检查
  和不修改现有媒体库约束保护。

## 运行与恢复边界

canonical CasaOS target 是 OrbStack ubuntu，Compose 为
/var/lib/casaos/apps/openclaw/docker-compose.yml 和
/var/lib/casaos/apps/product-radar/docker-compose.yml；OpenClaw data 为
/DATA/AppData/openclaw。真实切换前必须生成
/DATA/AppData/openclaw/backups/amadeus-openclaw-<UTC>，并在本机为 Codex hook 生成外部
备份。旧数据库/credentials 只放 checkpoint，不构成 fallback。
