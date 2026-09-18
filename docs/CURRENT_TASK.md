# 当前任务

更新时间：2026-09-18（Asia/Shanghai）

执行唯一目标：完成 OpenClaw Amadeus 全能力迁移。旧 LangBot/n8n/旧插件/旧通知路径全部
退出；OpenClaw/Kurisu 是唯一 Agent runtime。PUBG plugin/domain、当前 9Router、Product
Radar、changedetection、media adapter 和必要聊天入口按边界保留。

## 跨渠道 Identity 子目标（2026-09-18）

当前实现状态：`DEPLOYED_LIVE_REAL_INPUT_PENDING`。新增 platform-neutral
`packages/identity` SQLite 库和 Amadeus native Identity tools：
`identity_resolve`、`identity_get_person`、`identity_bind_channel`、
`identity_add_alias`、`identity_link_account`、`identity_list_candidates`、
`identity_confirm_candidate`，以及 `skills/identity`。预设从仓库外
`identityPresetsFile` 导入；Telegram/WhatsApp sender/account/conversation metadata 只从
OpenClaw trusted context 读取，生产 ID/JID 不进入 Git。

2026-09-18 follow-up 已补上 OpenClaw typed `before_dispatch` → tool context 的短时 reply
metadata bridge，并在 `agent_end` 清理；只保留可信 channel-native sender id，按 session 隔离，
不保存消息正文或显示名。Pinned OpenClaw 2026.9.4 的 Telegram bundle 和外部持久化 WhatsApp
channel package 现在也通过 source-controlled、版本锚定补丁，把 Telegram `text_mention` 的
真实 user ID、同一会话内已由 trusted sender metadata 观察到的 `@username` 对应 ID、WhatsApp
`mentionedJid` 和稳定 sender JID 送入同一 `toolBindings.identity.mentions`/sender context；不从
prompt、昵称、手机号文本或未观察到的用户名推断，过期/冲突用户名 fail closed。该 follow-up 已随
`c33684a` 构建并 apply；线上镜像为
`local/openclaw-amadeus:git-c33684a77a7a-20260918101625`，runtime inspect 已确认
`before_dispatch` 和 `agent_end` 两个 typed hook 在线。

PUBG plugin 已在边界消费 canonical Person 的 `provider=pubg` account；没有 binding、没有
PUBG account、alias 仍是 observed candidate 或解析歧义时，返回明确 identity error，不再把
群成员的“我”静默解析成默认队伍。`team=true` 是显式队伍请求。源码、配置、Skill、本地测试和
trusted channel metadata 的 CasaOS build/apply 均已完成；线上运行
`local/openclaw-amadeus:git-c33684a77a7a-20260918101625`。最近真实 WhatsApp 群入站已调用
`identity_resolve(self)` 并返回 `unbound / trusted_channel_identity_is_not_bound`，随后没有调用
PUBG tool；线上真实
Telegram/WhatsApp sender binding、PUBG account/link、群 alias confirm 和重启持久化尚未由真实
用户入口完成。

## 当前进度

- 代码阶段：PASS。新增 native plugins/amadeus、owner outbox、briefing source/config、
  Codex hook 和 CasaOS 模板；Product Radar 已去掉旧通知依赖；OpenClaw owner 工具策略改为
  `tools.profile="full"`，不再用只包含 PUBG 的严格 allowlist。全局 workspace 已收敛为
  架构、工具真实性、通知和安全原则；PUBG 领域规则全部下沉到 `plugins/pubg` skill，SOUL
  不再固化 PUBG 能力清单。
- 本地测试阶段：PASS。全量 build、typecheck、测试和 secrets scan 在最终 apply 前复跑通过：
  Identity 6、PUBG domain 9、PUBG plugin 6、Amadeus 6、Product Radar 51。
- 部署脚本阶段：PASS。scripts/deploy-openclaw.sh 已改为显式 apply 的一次性迁移入口，包含
  checkpoint、当前 OpenClaw secret 校验、镜像构建、旧 app/data 退休、briefing cron 和 owner
  WhatsApp smoke；不再从旧 LangBot DB 或旧路径做运行时 fallback。Codex hook 已修复为实际
  使用远端 owner outbox，且不再因缺少 `os` 导入而静默丢弃事件。
- 真实切换阶段：PASS。最终镜像已在 OrbStack Ubuntu CasaOS 运行；OpenClaw、Product Radar、
  media adapter、NAS 只读 smoke、briefing cron 和 owner WhatsApp outbox 均通过。
- 部署后阶段：PASS。基础迁移 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918082357`；Telegram username/trusted
  channel metadata 的最新 checkpoint 为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918101625`；旧 LangBot/n8n
  容器、app/data 路径和 KOOK watchdog timer 已退休。全局上下文、Codex hook、内部服务
  proxy bypass 和自然语言工具选择均已完成 live 复核。
- 部署构建优化阶段：PASS。`scripts/deploy-openclaw.sh` 新增
  `--build-auto`、`--build-openclaw`、`--build-radar` 和 `--no-build`；按 live image 的
  Git commit 选择性构建，并对未构建镜像做 stale check。该流程已用于本次 Identity reply
  bridge，线上镜像和恢复点见上述 Identity 状态及
  `.agent/checkpoints/2026-09-18-openclaw-identity-reply-bridge-deployed.md`。

## PUBG-only 根因修复验收

- live `tools.profile=full`，没有 `tools.allow` 严格白名单；WhatsApp 群组为 `open`、
  `requireMention=false`，群组没有 `tools`/`toolsBySender` 限制，因此成员继承完整 OpenClaw
  工具能力，而不是只继承 PUBG。
- `pubg` 6 个工具和 `amadeus` 7 个工具均显示 `origin= bundled`、`trust= bundled`、
  `status=loaded`；这也修复了 Amadeus owner notifier 被非信任插件拒绝的问题。
- WhatsApp secondary account 为 linked/healthy，真实 owner outbox smoke 已生成 sent marker。
  未向群聊发送未经请求的测试消息；群聊能力边界已由 live config 和 plugin/tool inspect 验证，
  可由用户在群内发一条普通能力消息做最终体验确认。

## 迁移后能力选择验收

- OpenClaw 自然语言只读请求成功选择 `amadeus_product_radar`，返回当前 1 个监控项；
  `successfulToolNames` 只有 `amadeus_product_radar`，tool failures 为 0，未发送通知或修改配置。
- Codex hook smoke 已写入远端 outbox 并生成 sent marker；事件没有 channel/recipient/to 字段，
  仍由 OpenClaw owner worker 负责 WhatsApp 送达。
- OpenClaw 内部服务名已加入 `NO_PROXY`，Product Radar 原生工具不会再误走宿主代理；
  `tools.profile=full`、WhatsApp group `open`、免 mention 且无群组工具限制仍保持。

## 不接受的替代

不恢复 LangBot/Mastra/n8n 业务链，不做 shadow/double-run/关键词路由/兼容 fallback；
不把 Telegram/KOOK proactive notification 重新接回；不把真实平台送达用 health、mock、
provider trace 或插件 smoke 冒充。

## 恢复边界

所有旧 app/data、compose、database、OpenClaw config/secrets 和 Codex hook 都必须在
仓库外 dated checkpoint；不删除现有 Avalon media library。媒体工作只允许明确单项并遵循
备份、preview、确认和 collision 检查。
