# Decisions

更新时间：2026-09-17（Asia/Shanghai）

## OpenClaw 是唯一 PUBG Agent 宿主

采用 OpenClaw 2026.9.4 原生 plugin 机制，当前 9Router route nine_router/arthur-combo
保持不变。OpenClaw 负责自然语言、会话和最终回复；PUBG plugin 不做二次规划、不调用
LLM，也不套旧 HTTP gateway。

## Domain 与平台解耦

PUBG Domain 位于 packages/pubg-domain，只接收结构化输入并输出确定性事实、coverage、
版本和 evidenceRefs。Telegram 身份、OpenClaw SDK 和外部文件读取停留在 plugin/config 边界。

## 一次性迁移

旧比赛/Telemetry 数据在切换前导入 OpenClaw SQLite。导入器 dry-run 默认、apply 显式、
按 matchId 和 feature key 幂等。迁移前保留一次仓库外 checkpoint；不做 shadow、双写、灰度
或旧架构回滚演练。

## 非 PUBG 服务独立保留

Product Radar、LangBot、n8n 只按各自业务运行，不成为 PUBG 启动依赖。依赖已退休通知端点
的 Product Radar owner、日报和旧 Codex producer 停用；不删除这些服务的无关业务数据。

## Secrets 与部署

生产 secret、Telegram owner、队伍配置、API key 和数据库只存在 OrbStack ubuntu 的
外部路径。CasaOS compose 位于 /var/lib/casaos/apps，服务使用 docker compose up -d
--no-build；需构建时先由 host BuildKit 生成固定 image，再显式 apply。
