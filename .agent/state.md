# Codex State

更新时间：2026-09-06（Asia/Shanghai）

## PUBG 对局复盘 V1（DEPLOYED / VERIFIED：2026-09-06）

已基于比赛 `d8c41c10-de9f-40b4-ac88-ede0ab554a31` 的真实 Match API/Telemetry 完成并部署复盘 V1：runtime image `local/pubg-query-engine-v3:git-2f6a63b013ff` 已运行在 OrbStack `ubuntu` / CasaOS，runtime compose 已切换 `telemetry-parser-5` / `review-features-5`，n8n `PUBG Data Gateway v3` 已导入并 active，LangBot `local/pubg-stats` `3.3.0` 已由 API task `14` 安装 ready。

真实 Match ID runtime query 已返回 OK 并创建 v5 feature cache，presentation 包含战局走势、武器、队友互动/误伤、电击枪、恢复/能量、搜包、载具仓库、环境动作和趣味组合；未输出圈阶段/白圈。runtime `/healthz`、`/homehub/health`、n8n health、`scripts/doctor.sh`、`scripts/smoke-homehub-docker.sh` 均通过。部署 rollback 与证据在 `.agent/checkpoints/2026-09-06-pubg-review-v1-deployment.md`；代码 source commits 为 `fb6000a`、`2f6a63b`、`acdfc65`。

Codex 未代发真实 Telegram 用户消息；如需最后一项平台 inbound 人工确认，由用户发送：`复盘这场比赛 d8c41c10-de9f-40b4-ac88-ede0ab554a31`。

## PUBG Telegram 超长消息 hotfix（DEPLOYED / VERIFIED：2026-09-06）

已定位 2026-09-06 23:26–23:27 的 `BadRequest: Message is too long`：新复盘报告 runtime response 为 4,278 字符，LangBot plugin adapter 把多段 response 合并为一个 `reply_message_chain`。Git patch `25d4535` / `cfaaacd` 已在 patched Telegram host adapter 最终渲染后按 3,800 字符安全阈值顺序发送多个 chunk，inline keyboard/quote 只挂首段。LangBot image `local/langbot-agent:cfaaacd35b87-20260906-233604` 已在 CasaOS `ubuntu` 激活，compose rollback 为 `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260906-233608`。active source、in-container split smoke `[3600, 600]`、patch tests、runtime tests、doctor、Docker smoke 和 secret scan 通过。checkpoint：`.agent/checkpoints/2026-09-06-pubg-review-v1-telegram-long-message-fix.md`。

Codex 未代发真实 Telegram 用户消息；请用户重发复盘请求完成最终 outbound 确认。

## HomeHub V1.2 follow-up（2026-09-06）

最新 follow-up 已完成：HomeHub status 磁盘显示已用/总量/可用/百分比；Telegram 历史 `BadRequest: can't find end of precode entity` 已通过 outbound plain-text fallback 修复。新 runtime image 为 `local/pubg-query-engine-v3:git-7df513bdcd27`，LangBot patch image 为 `local/langbot-agent:7df513bdcd27-20260906-183935`，live `/status`、Docker smoke、active patch source 检查通过。checkpoint：`.agent/checkpoints/2026-09-06-homehub-v1.2-disk-telegram-followup.md`。

## HomeHub V1.2 当前阶段

2026-09-06 已完成 V1.2 source implementation：Telegram/KOOK identity correction、HomeHub Telegram
confirmation buttons/callback ownership/replay/expiry/text fallback、MacHostAgent/Executor、APFS-aware
host metrics、label-based Service Registry mapping、new grouped `/status` formatter and health semantics。
本地 runtime 125 pass / 1 skip，MacHostAgent Python tests、plugin tests、secret scan 和 diff check 通过。
2026-09-06 已完成实际部署：Mac launchd agent、runtime image `local/pubg-query-engine-v3:git-6a59a544bacf`、
patched LangBot image `local/langbot-agent:415b6ea002d1-20260906-153202` 与三个 plugin API installs 已就绪。
真实 `/status` 返回 8 healthy / 4 degraded / 1 unhealthy / 1 down / 0 unknown，并取得真实 macOS 指标；
private/group identity、button ownership/cancel、text route 和 aria2 text confirmation smoke 已通过。部署 rollback
与 compose backup 记录在 `.agent/checkpoints/2026-09-06-homehub-v1.2-deployment.md`。
源码 checkpoint 仍为 `.agent/checkpoints/2026-09-06-homehub-v1.2-implementation.md`。

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
  macOS-only UNKNOWN diagnosis smoke 已通过；LangBot patched image 为 `local/langbot-agent:415b6ea002d1-20260906-153202`。
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

## Product Radar V0.1（2026-09-07）

- 已新增独立 `apps/product-radar` generic Seller/Product Watch runtime、SQLite store、changedetection sensor port、Bunjang source adapter、LangBot plugin、Docker/CasaOS templates。
- TypeScript Product Radar tests 21/21、plugin Python tests 4/4、typecheck/build、secret scan、Compose config 和 LangBot dry-run 均通过。
- Bunjang product smoke 成功建立 snapshot baseline 且 0 notification；seller smoke 成功取得 5 条公开 listings 并建立 baseline，0 notification，未实现登录/CAPTCHA/代理绕过。
- Product Radar implementation/deployment commits are `83c3557`, `ed394e9`, `380f132`, `efbf19e`, `53d1b84`, and `d73b9fc`; runtime image `local/product-radar:git-dd80fb7a606d` is deployed in CasaOS on OrbStack `ubuntu`, changedetection is healthy, and LangBot plugin task `32` is `INSTALL_READY` with Command and EventListener components loaded. No real Telegram/KOOK test notification was sent; see `.agent/checkpoints/2026-09-07-product-radar-deployment.md`.

## Product Radar V0.2 Image Similarity Watch（2026-09-07）

- 已部署 `local/product-radar:git-298f8ee28072`，新增 similarity Watch、sharp perceptual matcher、Bunjang `의류` keyword feed、图片附件解析和 120 秒默认频率。
- 24 项 TS tests、7 项 plugin tests、Bunjang similarity smoke、真实部署 preview/create/webhook/pause/delete 均通过；测试 Watch `v02-smoke-20260907` 已清理，原有用户 Watch 未修改。
- 真实 smoke 未发送 Telegram/KOOK 测试消息；当前实现是可替换 perceptual matcher，CLIP/SigLIP、live Telegram image acceptance 和更宽候选范围列入后续任务。
- 见 `.agent/checkpoints/2026-09-07-product-radar-v0.2.md`。


## Product Radar V0.3 Phase A（DEPLOYED / VERIFIED：2026-09-08）

- 已完成 TargetProfile/vision provider boundary、Bunjang SearchPlanner、shared SearchFeed/subscription/event stream、watermark pagination、backoff/jitter、Sharp provider/cache abstraction 和 LangBot preview UX。
- 本地验证：Product Radar 38/38、LangBot plugin 7/7、Python compile、typecheck/build、diff check 已通过。
- 已完成显式 RELEASE：`local/product-radar:git-8b0b96e4c2c6` 在 OrbStack ubuntu/CasaOS 激活，LangBot plugin task `41` `INSTALL_READY`，真实 shared feed/baseline/webhook/restart/cleanup smoke 通过；不得直接改运行容器。
- 最终真实状态：Product Radar/changedetection healthy，原 Product Watch `9ec10408-e55b-43a8-821b-f3427005656e` 保持 120s，测试 Watch/Feed/sensor 均已清理。
- 代码提交链：`16d756d`（V0.3 source）、`f360e2d`（per-query feed target fix）、`8b0b96e`（TargetProfile/SearchPlan SQLite persistence）、`ce7884d`（GPT-5.6 Luna UUID correction）。


## Product Radar Bunjang Search Response Hotfix（DEPLOYED / VERIFIED：2026-09-08）

- 用户报告 Bunjang search response parser 错误；已增强非空 product-like array 探测、嵌套 response/nextCursor 兼容和 query 级 preview warning fallback。
- 已部署 `local/product-radar:git-23836b200afe`；live image-only preview 返回 54 candidates、无 warnings；Product Radar/changedetection healthy。
- 原有真实 Product Watch 与 120s interval 未改变，未新增测试 Watch 或通知。
