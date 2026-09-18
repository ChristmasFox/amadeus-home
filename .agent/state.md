# Agent State

更新时间：2026-09-18（Asia/Shanghai）

当前 Goal：按 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md，将仍有价值的旧多领域能力迁移到
OpenClaw/Kurisu native Amadeus plugin 与独立服务，并退休 LangBot、n8n、旧 runtime、
旧通知 bridge 和旧 proactive producer。

当前状态：本地实现和预检 PASS；CasaOS 一次性 apply、外部 checkpoint、真实 WhatsApp
owner smoke、旧 app/data 退休、提交/push 仍是本轮收尾动作。

已落地：

- plugins/amadeus：Product Radar、Emby media safety flow、NAS、HomeLab、KOOK lookup、
  briefing、owner notifier/retry worker；
- Product Radar channel-free owner outbox 和 Codex channel-free hook；
- OpenClaw Amadeus config/template、workspace policy、固定 image Dockerfile；
- Product Radar compose 去除 LangBot/Telegram/KOOK notification keys；
- NAS source 移到 infra/macos/nas-control.sh；
- briefing config 保留旧日报的来源/主题/调度意图，但通知目标固定为 WhatsApp owner；
- scripts/deploy-openclaw.sh 和 scripts/openclaw_prepare.py 的一次性迁移/退休流程。
- owner 工具策略固定为 `tools.profile="full"`；live baseline 的 PUBG-only allowlist 根因已记录并
  在部署 preflight 中设为硬失败条件。

下一步：

1. 提交本轮 reviewed source，push。
2. 执行 scripts/deploy-openclaw.sh --apply --build。
3. 验证 OpenClaw full tool profile、两个 plugin、Product Radar、media adapter、NAS read-only SSH、
   briefing cron、owner outbox sent marker、Codex hook 和旧容器/路径不存在。
4. 更新 docs/CURRENT_TASK.md、docs/PROJECT_STATE.md、此文件和 .agent/checkpoints/。
5. 再做 final git diff --check/status、secrets scan，并报告实际 checkpoint/镜像/服务结果。

约束：不恢复 LangBot/Mastra/n8n 业务链；不做灰度、shadow、双跑、兼容 fallback 或回滚
演练；不提交 secret/业务数据；不修改现有 Avalon media library；长期服务只部署在
OrbStack ubuntu CasaOS。
