# Decisions

更新时间：2026-09-18（Asia/Shanghai）

## OpenClaw 是唯一 Agent 宿主

采用 OpenClaw 2026.9.4 原生 plugin 机制，当前 9Router route 保持不变。OpenClaw 负责
自然语言、会话和最终回复；plugin 只注册结构化工具，不恢复旧 Runtime、LangBot/n8n
orchestrator、关键词路由或第二个 Agent。

## Domain 与平台解耦

PUBG Domain 位于 `packages/pubg-domain`，只接收结构化输入并输出确定性事实、coverage、
版本和 evidenceRefs。Telegram、KOOK、WhatsApp 和 OpenClaw SDK 停留在 plugin/config 边界。

## 能力迁移与退休

Product Radar、媒体整理、NAS、HomeLab、VPS、KOOK 群成员和 Codex 通知进入
`plugins/amadeus`；Product Radar 保持独立服务。旧 LangBot plugin、n8n workflow、旧
通知 sender、watchdog 和 Runtime 已删除，不保留双实现或 fallback。

## Owner 通知

事件生产者只写 channel-free、幂等的 outbox event。OpenClaw worker 只向 WhatsApp owner DM
投递；Telegram/KOOK 可以保留聊天入口，但不再作为 proactive notification channel。发送
失败保留 pending 文件并重试，不能把入队当作已送达。

## 一次性切换

迁移脚本默认 dry-run；`--apply --build-auto` 按 live immutable image 的 Git commit 只
构建受影响的 OpenClaw/Product Radar 镜像，`--apply --no-build` 复用未过期镜像；只有
`--apply --build` 才强制全量双镜像构建和完整验证。所有 apply 仍会备份、启动/更新
OpenClaw 与 Product Radar、注册 VPS 报告 cron，并以真实 owner WhatsApp smoke 作为交付
验收。所有旧数据先进入仓库外 checkpoint；不做 shadow、双写、灰度或回滚演练。

## Secrets 与部署

生产 secret、owner identity、队伍配置、API key 和数据库只存在 OrbStack `ubuntu` 的外部
路径。CasaOS compose 位于 `/var/lib/casaos/apps`，服务使用 `docker compose up -d
--no-build`；需要构建时先由 host BuildKit 生成固定 image，再显式 apply。
