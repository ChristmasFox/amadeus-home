# Codex State

更新时间：2026-09-06（Asia/Shanghai）

## 当前上下文

本仓库是 LangBot / Mastra / PUBG / n8n / Telemetry / Platform Adapter / HomeLab
系统的可迁移 monorepo。迁移阶段、HomeHub V1、只读 `/whoami`、目标 runtime/plugin 部署、平台
来源修复、Admin Identity、Developer Workflow Optimization V1 和 **HomeHub V1.1 Security & Runtime
Reliability 实现与定向验证**已完成并提交为 `e0a3ed5`，并已使用 immutable image `local/pubg-query-engine-v3:git-46efb62eba0c` 部署到 OrbStack `ubuntu` / CasaOS；生产容器已验证 healthy。
用户指定的 PUBG Intent Router 时间词误判 small-scope task 已完成 targeted verification，代码与文档已以独立 commit `d12b733` 提交。
2026-09-05 的 Telegram/KOOK `Request Failed` 事故已由用户修正 9Router key，并完成 provider key、
9router API 和 Telegram 流式回复验证；用户确认 KOOK/Telegram 均恢复。

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

## Codex Global Completion Notification Bridge（已完成）

- 全局配置：`/Users/blacksidev/.codex/config.toml` root-level `notify`。
- 全局脚本：`/Users/blacksidev/.codex/bin/codex-notify.sh`；Git source：`integrations/codex/codex-notify.sh`。
- n8n workflow：`Codex Completion Notification` / `codex-completion-notification-20260906`，Webhook
  `/webhook/codex-complete`；最后导入 backup 记录在 `docs/CURRENT_TASK.md`。
- n8n Data Table 使用 `threadId:turnId` 唯一 eventKey；Admin IDs/shared secret 只存在外部文件和 n8n
  global variables，真实 credential 不入 Git。
- 2026-09-06 已验证：global Codex turn（cwd `/tmp`）双平台 sent；缺 secret/非 completion 被拦截；
  runtime duplicate suppressed；Telegram/KOOK 双向 failure isolation 均通过并恢复真实 identity config。

## 当前事实

- canonical HomeLab runtime：OrbStack machine ubuntu 内的 CasaOS；
- canonical app definition：/var/lib/casaos/apps/<app>/docker-compose.yml；
- canonical app data：/DATA/AppData/<app>；
- shared storage：/Volumes/Avalon/...；
- Git source of truth：本仓库；
- n8n credentials、LangBot env、PUBG API key、Cloudflare token：仓库外；
- 2026-09-05 事故已解决：用户已把 LangBot `9Router` provider key 同步为 9router active key，
  `/v1/models` 返回 200，Telegram 私聊/群聊流式测试成功；未重建镜像或重启容器；
- Redis：可重建缓存，不是核心恢复依赖；
- 不执行公网 push，除非用户另外明确授权。
- Codex notify bridge runtime secret files：`~/.codex/secrets/codex-notify-secret` 与
  `/DATA/AppData/n8n/secrets/codex-notify-secret`；值不入 Git、不在日志输出。
- 当前 HomeHub runtime image：`local/pubg-query-engine-v3:git-1b52d2c89f3e`，Docker socket smoke、真实 `/status` 和
  macOS-only UNKNOWN diagnosis smoke 已通过；LangBot patched image 为 `local/langbot-agent:5a051b8756c4-20260906-132959`。
- 2026-09-06 快速 bug fixes 已提交（`806ab63`、`1b52d2c`、`5a051b8`）：KD 展示统一 1 位小数且零死亡不显示∞，真实「最近20场」smoke 返回 `1.5 / 0.9 / 0.7 / 0.4` 与合计 `1.0`，NAS status V2 已部署到外部 forced command，Telegram `<think>` outbound/streaming filter 已激活并通过 live helper smoke，HomeHub host CPU/内存继续 UNKNOWN 但不再显示原始 executor 错误。macos-nas-control v0.1.3 已通过 LangBot Plugin API 安装并在 active plugin runtime 中完成真实 NAS formatter smoke；credential 仍在仓库外。随后发现 macOS APFS 根卷 `df` snapshot Used 与整盘容量不一致，已在 Git source 升级 formatter/forced-command 至 `0.1.4`，并完成 LangBot Plugin API task `19` 重新安装；active plugin runtime 真实 smoke 显示系统盘约 `424GiB / 460GiB`、`92.1%`，uptime 和电源均为中文。

## 最近完成

- 完成代码、插件、patch、workflow、文档和历史 baseline 的归档；
- 补齐脱敏 Docker/CasaOS、Cloudflare、macOS 模板；
- 补齐 bootstrap、doctor、backup、restore 和 secret scan；
- 修复 restore.sh 语法错误并为脚本补充执行权限；
- 完成 HomeHub V1 domain/runtime/API 接线、安全媒体整理流程和回归测试；
- 已验证：pnpm install、类型检查、构建、92 项 runtime tests（91 pass、1 skip）、secret scan、脚本 smoke test 和 Compose 模板；
- 初始本地 commit：767dd36（chore: initialize agent monorepo）；
- HomeHub V1 完成 commit：`ba1d556`（feat: add HomeHub v1 runtime）；不执行公网 push。
- 已在仓库根目录 `AGENTS.md` 与用户级 `/Users/blacksidev/AGENTS.md` 记录：禁止为 goal 手动设置、指定、增加或限制预算；调用 `/goal`/`create_goal` 时省略 `token_budget`，使用 Codex 默认预算机制。
- 已完成 HomeHub `/whoami` 的平台无关 identity resolver、runtime endpoint、LangBot Command、测试和文档同步；已部署并验证。
- 已新增 `TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID` 启动配置，本机 `.env` 已填入真实值并保持 ignored；CasaOS runtime 已加载外部 env 并重启验证。
- HomeHub `/whoami` 实现提交为 `b3f2406`，Docker/package 修复提交为 `1fcefd7`、`7626cde`、`ddfee46`；已推送并部署 runtime 镜像 `local/pubg-query-engine-v3:3.3.4-admin-03b0e41`。
- 已修复 LangBot command event 的 Telegram/KOOK 平台来源和 displayName 传递，提交 `dd5785e`、`9c34a89`、`1adbc1d`；patched image 已激活，等待 Telegram `/whoami` 复测。
- 已完成 Developer Workflow Optimization V1：新增 change-scope classifier、FAST/RUNTIME/RELEASE 文档与 skill、无 Docker 本地 runtime smoke、默认 `--no-build` deploy script；Dockerfile pnpm install cache 与 final image layer 已优化。单一 HomeHub source build 从 132.25s（install 114.0s）降至 22.37s（install cache hit），optimized image smoke 通过；本阶段未部署。

## HomeHub V1.1 当前完成证据（2026-09-05）

- 共享 `AuthorizationCore` 已接入 IdentityRegistry、HomeHub Action 和 organize-emby plugin。
- Admin env 仍只从外部 `TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID` 读取，真实值不入 Git。
- `runtime-executor` 已移除 HomeHub source 中的 `orb -m` 命令；Docker/Ubuntu 使用 direct command，macOS Host 无 executor 返回 UNKNOWN。
- `HealthStatus` 已覆盖 healthy/unhealthy/down/unknown；metrics failure 返回 null；unknown 不计入 abnormal。
- `pnpm workflow:verify`、plugin dry-run、Python compile、diff check 已通过；production image 已 build/load/deploy，`/healthz` 与 `/homehub/health` healthy。
- 部署脚本的 `set -u` 空数组 bug 已修复并提交为 `46efb62`；host proxy refused 首次失败后用 `--no-proxy` 成功。


## 状态更新协议

每个阶段结束时更新 docs/CURRENT_TASK.md、docs/PROJECT_STATE.md，并在
.agent/checkpoints/ 写入带日期的记录。如果后续工作未完成，使用 .agent/tasks/
保存明确的下一步，不把聊天内容当作唯一上下文。
