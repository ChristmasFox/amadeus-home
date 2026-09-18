# Agent State

更新时间：2026-09-18（Asia/Shanghai）

当前 Goal：按 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md，将仍有价值的旧多领域能力迁移到
OpenClaw/Kurisu native Amadeus plugin 与独立服务，并退休 LangBot、n8n、旧 runtime、
旧通知 bridge 和旧 proactive producer。

当前状态：上一版实现、提交/push、CasaOS 一次性 apply、外部 checkpoint、真实 WhatsApp owner
smoke 和旧 app/data 退休均 PASS；本次已完成全局上下文拆分、旧 secret fallback 清理和 Codex
hook 修复，正在提交后重建镜像并做最终 live 复核。

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

下一步：

1. 提交本次上下文与部署修复，重建并 apply OpenClaw image。
2. 做 Codex outbox、自然语言工具选择、Git、secrets scan、OpenClaw/Product Radar/WhatsApp
   的最终复核，并写入新的部署 checkpoint。
3. 用户可在 WhatsApp 群内发一条普通能力消息，做不打扰成员的体验确认。

约束：不恢复 LangBot/Mastra/n8n 业务链；不做灰度、shadow、双跑、兼容 fallback 或回滚
演练；不提交 secret/业务数据；不修改现有 Avalon media library；长期服务只部署在
OrbStack ubuntu CasaOS。
