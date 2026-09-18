# Agent State

更新时间：2026-09-18（Asia/Shanghai）

当前 Goal：按 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md，将仍有价值的旧多领域能力迁移到
OpenClaw/Kurisu native Amadeus plugin 与独立服务，并退休 LangBot、n8n、旧 runtime、
旧通知 bridge 和旧 proactive producer。

当前子目标：实现跨 Telegram/WhatsApp 的 canonical Person identity、昵称候选学习和
provider-neutral external account；Identity 已完成本地源码阶段，线上未 apply。

当前状态：全局上下文拆分、旧 secret fallback 清理、Codex hook 修复、内部服务 proxy bypass、
提交/push、CasaOS apply、外部 checkpoint、真实 WhatsApp owner smoke、自然语言工具选择和旧
app/data 退休均 PASS；本轮新增部署脚本的选择性镜像构建优化，源码尚未 apply 到线上。

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
  只能作为 candidate。现有线上 image 尚未包含本轮 Identity 变更。

下一步：

1. 完成本轮 Identity 的全量 build/typecheck/test/secrets scan、checkpoint 和 Git 边界复核。
2. 若要让线上 OpenClaw 使用 Identity，按显式 RELEASE 流程 build/apply，并在真实 Telegram/
   WhatsApp 入口完成 sender binding、PUBG account/link 和重启持久化验收；当前不把旧线上
   image 的健康或工具 inspect 当作 Identity 已上线证据。
3. 迁移部署后再做不打扰成员的真实群聊体验确认，保留外部 checkpoint 和回滚路径。

约束：不恢复 LangBot/Mastra/n8n 业务链；不做灰度、shadow、双跑、兼容 fallback 或回滚
演练；不提交 secret/业务数据；不修改现有 Avalon media library；长期服务只部署在
OrbStack ubuntu CasaOS。
