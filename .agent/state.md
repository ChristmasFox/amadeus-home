# Agent State

更新时间：2026-09-18（Asia/Shanghai）

当前 Goal：按 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md，将仍有价值的旧多领域能力迁移到
OpenClaw/Kurisu native Amadeus plugin 与独立服务，并退休 LangBot、n8n、旧 runtime、
旧通知 bridge 和旧 proactive producer。

当前子目标：实现跨 Telegram/WhatsApp 的 canonical Person identity、昵称候选学习和
provider-neutral external account；Identity reply metadata bridge、provider-native channel metadata
和 Telegram trusted username patch 已完成新的 CasaOS apply，线上真实 sender binding/账号 linking
仍待真实用户入口验收。

当前状态：全局上下文拆分、旧 secret fallback 清理、Codex hook 修复、内部服务 proxy bypass、
提交/push、CasaOS apply、外部 checkpoint、真实 WhatsApp owner smoke、自然语言工具选择和旧
app/data 退休均 PASS；本轮 Telegram trusted username patch 与 Identity preset 动态刷新已通过
选择性镜像构建重新 apply 到线上。

已落地：

- plugins/amadeus：Product Radar、Emby media safety flow、NAS、HomeLab、KOOK lookup、
  briefing、owner notifier/retry worker；
- Product Radar channel-free owner outbox 和 Codex channel-free hook；
- OpenClaw Amadeus config/template、workspace policy、固定 image Dockerfile；
- Product Radar compose 去除 LangBot/Telegram/KOOK notification keys；
- NAS source 移到 infra/macos/nas-control.sh；
- briefing config 保留旧日报的来源/主题/调度意图，但通知目标固定为 WhatsApp owner；
- scripts/deploy-openclaw.sh 和 scripts/openclaw_prepare.py 的一次性迁移/退休流程。
- 全局 workspace 只保留通用规则；PUBG 领域规则在 `plugins/pubg/skills/pubg/SKILL.md`；
  OpenClaw prepare 不再读取旧 LangBot DB，Codex hook 使用远端 owner outbox。
- owner 工具策略固定为 `tools.profile="full"`；live baseline 的 PUBG-only allowlist 根因已记录并
  在部署 preflight 中设为硬失败条件。PUBG/Amadeus 已作为 bundled/trusted plugins 加载，
  因此 Amadeus owner notifier 可正常调用 Gateway runtime。
- `packages/identity`、Amadeus `identity_*` tools/Skill 和 PUBG identity boundary 已加入源码；
  identity SQLite 与 presets 使用 `/data` 外部路径，确认写入受 owner gate，observed alias
  只能作为 candidate。线上已运行
  `local/openclaw-amadeus:git-29ad1b946051-20260918102434`，SOUL/MEMORY 与 Git 哈希一致，四张
  身份表仍为空；外部 `identity-presets.json` 可在运行后安全刷新，等待用户填写。
- Amadeus typed `before_dispatch` hook 只把 OpenClaw 可信 `replyToSender` 短时传给同一
  session 的 Identity tools，`agent_end` 清理；没有 reply metadata 时仍 fail closed。mention
  仍要求 host 提供结构化 platform ID，不解析昵称或 prompt。Pinned Telegram bundle 和外部
  WhatsApp package 现已通过 source-controlled、版本锚定补丁传递真实 mention/sender ID；Telegram
  `@username` 只有在同一会话内由 trusted sender metadata 先建立对应关系时才可解析。

下一步：

1. 在真实 Telegram/WhatsApp 私聊和群聊入口完成 sender binding、PUBG account/link、群 alias
   candidate/confirm 和重启持久化验收；不能用伪造 ID 或 provider trace 代替。
2. 记录真实 inbound/outbound 结果和数据库重启前后摘要；当前 live DB 只有 schema、四张表
   均为 0 行，安全地等待真实用户确认。
3. 继续保留 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918102434` 作为最新恢复点，
   不恢复已退休的 LangBot/n8n/旧 Runtime。

约束：不恢复 LangBot/Mastra/n8n 业务链；不做灰度、shadow、双跑、兼容 fallback 或回滚
演练；不提交 secret/业务数据；不修改现有 Avalon media library；长期服务只部署在
OrbStack ubuntu CasaOS。
