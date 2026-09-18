# 当前任务

更新时间：2026-09-18（Asia/Shanghai）

执行唯一目标：完成 OpenClaw Amadeus 全能力迁移。旧 LangBot/n8n/旧插件/旧通知路径全部
退出；OpenClaw/Kurisu 是唯一 Agent runtime。PUBG plugin/domain、当前 9Router、Product
Radar、changedetection、media adapter 和必要聊天入口按边界保留。

## 当前进度

- 代码阶段：PASS。新增 native plugins/amadeus、owner outbox、briefing source/config、
  Codex hook 和 CasaOS 模板；Product Radar 已去掉旧通知依赖；OpenClaw owner 工具策略改为
  `tools.profile="full"`，不再用只包含 PUBG 的严格 allowlist。
- 本地测试阶段：PASS。全量 build、typecheck、测试和 secrets scan 在最终 apply 前复跑通过：
  PUBG domain 9、PUBG plugin 5、Amadeus 1、Product Radar 51。
- 部署脚本阶段：PASS。scripts/deploy-openclaw.sh 已改为显式 apply 的一次性迁移入口，包含
  checkpoint、secret 恢复、镜像构建、旧 app/data 退休、briefing cron 和 owner WhatsApp
  smoke。
- 真实切换阶段：PASS。最终镜像已在 OrbStack Ubuntu CasaOS 运行；OpenClaw、Product Radar、
  media adapter、NAS 只读 smoke、briefing cron 和 owner WhatsApp outbox 均通过。
- 部署后阶段：PASS。最终 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918080634`；旧 LangBot/n8n
  容器、app/data 路径和 KOOK watchdog timer 已退休，当前 Git 状态待本次文档 checkpoint
  提交后复核。

## PUBG-only 根因修复验收

- live `tools.profile=full`，没有 `tools.allow` 严格白名单；WhatsApp 群组为 `open`、
  `requireMention=false`，群组没有 `tools`/`toolsBySender` 限制，因此成员继承完整 OpenClaw
  工具能力，而不是只继承 PUBG。
- `pubg` 6 个工具和 `amadeus` 7 个工具均显示 `origin= bundled`、`trust= bundled`、
  `status=loaded`；这也修复了 Amadeus owner notifier 被非信任插件拒绝的问题。
- WhatsApp secondary account 为 linked/healthy，真实 owner outbox smoke 已生成 sent marker。
  未向群聊发送未经请求的测试消息；群聊能力边界已由 live config 和 plugin/tool inspect 验证，
  可由用户在群内发一条普通能力消息做最终体验确认。

## 不接受的替代

不恢复 LangBot/Mastra/n8n 业务链，不做 shadow/double-run/关键词路由/兼容 fallback；
不把 Telegram/KOOK proactive notification 重新接回；不把真实平台送达用 health、mock、
provider trace 或插件 smoke 冒充。

## 恢复边界

所有旧 app/data、compose、database、OpenClaw config/secrets 和 Codex hook 都必须在
仓库外 dated checkpoint；不删除现有 Avalon media library。媒体工作只允许明确单项并遵循
备份、preview、确认和 collision 检查。
