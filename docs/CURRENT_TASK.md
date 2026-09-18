# 当前任务

更新时间：2026-09-18（Asia/Shanghai）

执行唯一目标：完成 OpenClaw Amadeus 全能力迁移。旧 LangBot/n8n/旧插件/旧通知路径全部
退出；OpenClaw/Kurisu 是唯一 Agent runtime。PUBG plugin/domain、当前 9Router、Product
Radar、changedetection、media adapter 和必要聊天入口按边界保留。

## 当前进度

- 代码阶段：PASS。新增 native plugins/amadeus、owner outbox、briefing source/config、
  Codex hook 和 CasaOS 模板；Product Radar 已去掉旧通知依赖；OpenClaw owner 工具策略改为
  `tools.profile="full"`，不再用只包含 PUBG 的严格 allowlist。
- 本地测试阶段：PASS。Amadeus/Product Radar 定向测试、typecheck、脚本 syntax 和 diff
  whitespace 检查通过；收尾前仍需复跑全量 build/typecheck/test/secrets。
- 部署脚本阶段：PASS。scripts/deploy-openclaw.sh 已改为显式 apply 的一次性迁移入口，包含
  checkpoint、secret 恢复、镜像构建、旧 app/data 退休、briefing cron 和 owner WhatsApp
  smoke。
- 真实切换阶段：待执行。当前 live baseline 已确认 `tools.allow` 只有六个 PUBG tool 且
  Amadeus 未加载；切换前必须提交并 push reviewed Git source，然后运行：
  scripts/deploy-openclaw.sh --apply --build。
- 部署后阶段：更新本文件、PROJECT_STATE、.agent/state.md，写 dated checkpoint，检查
  Git diff/status、OpenClaw/Product Radar/owner outbox/cron/旧容器，并记录实际结果。

## 不接受的替代

不恢复 LangBot/Mastra/n8n 业务链，不做 shadow/double-run/关键词路由/兼容 fallback；
不把 Telegram/KOOK proactive notification 重新接回；不把真实平台送达用 health、mock、
provider trace 或插件 smoke 冒充。

## 恢复边界

所有旧 app/data、compose、database、OpenClaw config/secrets 和 Codex hook 都必须在
仓库外 dated checkpoint；不删除现有 Avalon media library。媒体工作只允许明确单项并遵循
备份、preview、确认和 collision 检查。
