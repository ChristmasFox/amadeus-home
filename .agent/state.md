# Codex State

更新时间：2026-09-05（Asia/Shanghai）

## 当前上下文

本仓库是 LangBot / Mastra / PUBG / n8n / Telemetry / Platform Adapter / HomeLab
系统的可迁移 monorepo。迁移阶段、HomeHub V1 代码阶段、只读 `/whoami` 代码阶段和目标
runtime/plugin 部署已完成，当前保留真实 Telegram/KOOK 入站烟测任务。

## 新会话入口

必须先读取：

    README.md
    docs/ARCHITECTURE.md
    docs/PROJECT_STATE.md
    docs/CURRENT_TASK.md
    .agent/state.md

随后执行：

    git status --short --branch
    git log -5 --oneline --decorate

## 当前事实

- canonical HomeLab runtime：OrbStack machine ubuntu 内的 CasaOS；
- canonical app definition：/var/lib/casaos/apps/<app>/docker-compose.yml；
- canonical app data：/DATA/AppData/<app>；
- shared storage：/Volumes/Avalon/...；
- Git source of truth：本仓库；
- n8n credentials、LangBot env、PUBG API key、Cloudflare token：仓库外；
- Redis：可重建缓存，不是核心恢复依赖；
- 不执行公网 push，除非用户另外明确授权。

## 最近完成

- 完成代码、插件、patch、workflow、文档和历史 baseline 的归档；
- 补齐脱敏 Docker/CasaOS、Cloudflare、macOS 模板；
- 补齐 bootstrap、doctor、backup、restore 和 secret scan；
- 修复 restore.sh 语法错误并为脚本补充执行权限；
- 完成 HomeHub V1 domain/runtime/API 接线、安全媒体整理流程和回归测试；
- 已验证：pnpm install、类型检查、构建、92 项 runtime tests（91 pass、1 skip）、secret scan、脚本 smoke test 和 Compose 模板；
- 初始本地 commit：767dd36（chore: initialize agent monorepo）；
- HomeHub V1 完成 commit：`ba1d556`（feat: add HomeHub v1 runtime）；不执行公网 push。
- 已在 `AGENTS.md` 记录 `/goal` 不手动设置固定 `token_budget` 的仓库协作规则。
- 已完成 HomeHub `/whoami` 的平台无关 identity resolver、runtime endpoint、LangBot Command、测试和文档同步；已部署并验证。
- HomeHub `/whoami` 实现提交为 `b3f2406`，Docker/package 修复提交为 `1fcefd7`、`7626cde`、`ddfee46`；已推送并部署 runtime 镜像 `local/pubg-query-engine-v3:3.3.3-whoami-ddfee46`。

## 状态更新协议

每个阶段结束时更新 docs/CURRENT_TASK.md、docs/PROJECT_STATE.md，并在
.agent/checkpoints/ 写入带日期的记录。如果后续工作未完成，使用 .agent/tasks/
保存明确的下一步，不把聊天内容当作唯一上下文。
