# Current Task

更新时间：2026-09-06（Asia/Shanghai）

## HomeHub Docker Executor + PUBG KD 修复（DEPLOYED / VERIFIED）

- [x] 新增 `DockerApiCommandExecutor`：只通过 `/var/run/docker.sock` 使用 Docker Engine API，不依赖 Docker CLI。
- [x] Docker 容器名严格限制为 Service Registry 的 allowlist：`langbot`、`pubg-query-engine-v3`、`n8n`、`postgres`、`redis`、`emby`、`jellyfin`、`qbittorrent`、`aria2`、`glances`。
- [x] 观察仅支持受限 `ps`、脱敏 `inspect`、最多 200 行 `logs` 和 `stats`；变更仅支持 `start` / `restart`；明确拒绝 `compose`、`exec`、`run`、`rm`、prune 和任意 shell。
- [x] HomeHub Docker action 已从 Compose 改为安全的容器 `start` / `restart` API；socket/权限/daemon 失败统一保留为 `UNKNOWN`。
- [x] HostCollector 默认不再读取 HomeHub 容器 `/proc` 冒充 macOS Host；无 macOS Host Executor 时返回 `UNKNOWN` 和明确原因。
- [x] 新增 `GET /status` 与 `/homehub/status` 实时状态端点，新增只读 `scripts/smoke-homehub-docker.sh`。
- [x] 修复 PUBG KD：n8n 归一化记录补齐 `deaths` / `deathSemantics`，runtime 对旧记录缺失字段使用 placement proxy；零死亡 KD 不再向用户渲染 `∞`，而显示为未定义 `—`。
- [x] 定向 TypeScript、完整 runtime tests、secret scan 和 diff check 已通过。
- [x] 使用 `scripts/deploy-homehub-docker-socket.sh --apply` 修改 canonical CasaOS compose 并重建 runtime。
- [x] 使用 `scripts/smoke-homehub-docker.sh` 在实际 `pubg-query-engine-v3` 容器内验证 socket、Docker client 和 `/status`。

生产部署顺序：先提交干净 source，再执行 `./scripts/deploy-agent-runtime.sh --apply --build --no-proxy`，随后执行
`./scripts/deploy-homehub-docker-socket.sh --apply`（该脚本只做显式 `--no-build` compose recreate），最后保留
compose rollback backup、health 和 Docker smoke 证据。

部署证据（2026-09-06）：immutable image `local/pubg-query-engine-v3:git-1a8a825812b6`；
canonical compose rollback backup `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-105507`；
container 以 `node` + supplementary group `104` 运行，`/var/run/docker.sock` 为只读 bind mount，
`test -S /var/run/docker.sock` 通过，受限 client 列出 7 个 allowlisted containers，`GET /status` 返回
13 个 registered services，其中 8 healthy、3 down（实际不存在的 postgres/redis/glances）、1 unhealthy（Jellyfin
最近日志错误）、1 unknown（macOS cloudflared）；没有出现全量 UNKNOWN。Host CPU/内存明确返回
`UNKNOWN — macOS executor unavailable; HomeHub container metrics are not host metrics`。
PUBG workflow 生产同步：已用 `scripts/deploy-n8n-workflow.sh --apply` 导入并重新激活
`PUBG Sync Matches v3` 与 `PUBG 今日战绩`；n8n 外部 rollback backups 分别为
`/home/node/.n8n/workflow-backups/codex-pubg-sync-matches-v3-20260902-before-20260906-105911.json`
和 `/home/node/.n8n/workflow-backups/codex-pubg-daily-stats-20260830-before-20260906-110037.json`。
真实 runtime `最近20场战绩` smoke 返回 20 场、玩家 KD `1.47 / 0.91 / 0.74 / 0.38`，合计 KD `0.96`，
response 与结构化 payload 均不含 `∞` 或 `Infinity`。

## 2026-09-06 快速 Bug 修复（DEPLOYED / VERIFIED）

- [x] PUBG 所有用户可见 KD（TypeScript runtime、legacy V2 Python、legacy n8n）统一按四舍五入保留 1 位小数；内部排序仍使用未格式化数值。
- [x] 零死亡 KD 继续显示 `—`，不会渲染 `∞` / `Infinity`。
- [x] macOS NAS `nas.status` 升级为 V2 结构化 payload：主机、macOS 版本/build、型号、CPU 核心、load、uptime、登录用户、内存、系统盘/Avalon、网络、网关、电源、cloudflared 和高占用进程；磁盘单位修复为 macOS human-readable 输出。
- [x] NAS formatter 增加移动端卡片样式、90% 磁盘告警和旧 payload 兼容；manifest 升级至 `0.1.3`。
- [x] 新增 `scripts/deploy-nas-control.sh`，默认 dry-run；`--apply` 会创建 `.codex-backup.<timestamp>`、安装外部 forced-command 并执行真实 `nas.status` smoke。
- [x] Telegram outbound boundary 和 streaming chunk 增加 `<think>` / `</think>` 过滤；完整、未闭合和 think-only 内容均不会泄漏到 Telegram。
- [x] HomeHub status 将 host CPU/内存继续明确保持 UNKNOWN（不冒充 Docker 容器指标），但改为中文原因说明；服务级 macOS/Docker executor UNKNOWN 也不再显示原始英文报错。
- [x] 定向 TypeScript、完整 runtime（118 pass / 1 skip）、legacy Python（31 pass）、NAS/Telegram patch tests、shell/Python syntax、LangBot patch dry-run、secret scan 已通过。
- [x] runtime image `local/pubg-query-engine-v3:git-1b52d2c89f3e` 已部署；compose rollback backup 为 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-132837`；真实 HomeHub `/status` smoke 通过（7 healthy、2 unhealthy、3 down、1 unknown），Docker socket 与 allowlist client 正常。实际 `/v3/query`「最近20场战绩」返回 KD `1.5 / 0.9 / 0.7 / 0.4`、合计 `1.0`，无 `∞`/`Infinity`。
- [x] n8n `PUBG 今日战绩` 已重新导入/激活，live export 确认 KD formatter 使用 `toFixed(1)`；外部 rollback backup 为 `/home/node/.n8n/workflow-backups/codex-pubg-daily-stats-20260830-before-20260906-132906.json`。
- [x] LangBot patched image `local/langbot-agent:5a051b8756c4-20260906-132959` 已激活，compose rollback backup 为 `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260906-133002`；live Telegram source 已确认 outbound/Markdown/streaming think filter 存在，patch chain 编译通过，active virtualenv helper smoke 通过。
- [x] macOS external forced-command 已安装并通过真实 `nas.status` smoke；旧文件 rollback backup 为 `/Users/blacksidev/.local/bin/nas-control.codex-backup.20260906-132920`；当前 payload 已改为 APFS 实际占用计算（系统盘约 `424GiB / 460GiB`、使用率约 `92.1%`），并输出中文运行时间和电源状态。
- [x] NAS formatter 修复 `df` 在 macOS APFS 根快照上把快照 Used 当成整盘 Used 的问题；运行时间和 `pmset` 电源文本改为中文卡片。
- [ ] 上述 NAS formatter 源码已升级至 manifest `0.1.4`，需在提交后通过 LangBot Plugin API 重新安装激活。
- [x] `macos-nas-control` v0.1.3 已通过 LangBot Plugin API 安装并初始化（task `15`）；使用仓库外 key file，未输出或提交 credential。已在 active `langbot_plugin_runtime` 内调用真实 macOS `nas.status`，V2 移动端 formatter smoke 通过。

## Codex Global Completion Notification Bridge（DEPLOYED / VERIFIED）

- [x] 全局 hook 已安装到 `/Users/blacksidev/.codex/bin/codex-notify.sh`，配置位置为
  `/Users/blacksidev/.codex/config.toml` root-level `notify`；不依赖 agent-monorepo 或当前 cwd。
- [x] Git source 为 `integrations/codex/codex-notify.sh`；安装脚本复制 source，不在全局 config 写入 secret。
- [x] 当前 Codex legacy notify argv payload（`type=agent-turn-complete`、`thread-id`、`turn-id`、`cwd`、
  `last-assistant-message`）已归一化为 webhook 所需的 event/threadId/turnId/cwd/projectName/
  lastAssistantMessage/timestamp。
- [x] script 使用 curl 2 秒连接/5 秒总 timeout，过滤非 completion event，日志不含 payload/secret，网络失败返回 0。
- [x] n8n workflow `Codex Completion Notification` 已激活，source 为
  `integrations/n8n/workflows/codex-completion-notification.workflow.json`，生产 ID
  `codex-completion-notification-20260906`，Webhook `/webhook/codex-complete`。
- [x] n8n shared secret 与固定 admin identities 通过外部文件同步到 global variables；真实值未入 Git。
- [x] idempotency Data Table `codex-completion-idempotency-20260906` 已创建，`eventKey` 唯一索引为
  `threadId:turnId`；重复事件在发送前返回 `duplicate: true`。
- [x] Telegram/KOOK 均复用 LangBot `/send_message` outbound sender，固定 `target_type: person`；目标
  只来自 `TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID`（Arthur Admin identity），不使用 payload/chat/channel。
- [x] 两个 sender 均 `continueOnFail: true`，结果分别记录 `telegram: sent|failed`、`kook: sent|failed`。
- [x] global Codex turn smoke（cwd `/tmp`）已进入 n8n，Telegram 与 KOOK 均 `sent`；runtime smoke 已验证
  缺失 secret 拒绝、项目名从 cwd 安全解析、双平台发送和重复抑制。
- [x] 受控 failure-isolation smoke 已验证 Telegram failed 时 KOOK sent、KOOK failed 时 Telegram sent；测试后
  两个平台 admin variables 与 shared secret 均从原外部配置恢复并核对。
- [x] static workflow smoke、notify script smoke、runtime webhook smoke、secret scan、JSON/shell 校验通过。

n8n workflow 最后一次生产导入的外部 rollback backup 为
`/home/node/.n8n/workflow-backups/codex-codex-completion-notification-20260906-before-20260906-114742.json`。
shared secret 外部文件为 `~/.codex/secrets/codex-notify-secret` 与
`/DATA/AppData/n8n/secrets/codex-notify-secret`，不在仓库内。

## 当前阶段

**PUBG Intent Router 时间词误判 — 已完成并提交。**

本阶段已完成生产发布。HomeHub V1.1 已以 `e0a3ed5` 提交；PUBG Intent Router 时间词修复已以独立 commit `d12b733` 提交；部署脚本修复已以 `46efb62` 提交。生产 runtime 已在 OrbStack `ubuntu` / CasaOS 激活 immutable image，未执行无关服务重启。


## HomeHub V1.1 Production Deployment（2026-09-05）

状态：**PUSHED / BUILT / DEPLOYED / HEALTHY**。

- [x] `main` 已 push 到 `origin/main`，包含 V1.1、安全修复、PUBG Router 修复和部署脚本修复。
- [x] 首次 RELEASE 构建在 final dependency deploy 阶段因 host 的 `127.0.0.1:7897` proxy refused 失败；未更新 CasaOS compose，旧生产容器仍保持 healthy。
- [x] 修复 `scripts/deploy-agent-runtime.sh` 的 `set -u` 空数组展开问题，提交 `46efb62` 并再次 push。
- [x] 使用 `./scripts/deploy-agent-runtime.sh --apply --build --no-proxy` 完成 host BuildKit 构建、image transfer 和 CasaOS `docker compose up -d --no-build`。
- [x] immutable image：`local/pubg-query-engine-v3:git-46efb62eba0c`。
- [x] canonical compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`；当前 compose image 与运行容器均为 `local/pubg-query-engine-v3:git-46efb62eba0c`。
- [x] rollback compose backup：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-012427`。
- [x] 生产容器 `pubg-query-engine-v3` 状态为 `Up (healthy)`，`/healthz` 返回 200，`/homehub/health` 返回 `status=healthy`。
- [x] 未修改 `/DATA/AppData`、媒体库或 secrets；部署仅替换 runtime image 并保留 compose 回滚副本。

回滚：在 Ubuntu root shell 中将 compose image 恢复为 backup 中的旧 image，然后执行
`cd /var/lib/casaos/apps/pubg-query-engine-v3 && docker compose up -d --no-build`，再验证两个 health endpoint。

## Telegram / KOOK `Request Failed` 诊断（2026-09-05）

- [x] 只读检查 OrbStack `ubuntu` / CasaOS 中的 `langbot`、`langbot_plugin_runtime`、
  `9router` 和 `pubg-query-engine-v3`；LangBot 与插件 runtime 正常运行，runtime 为 healthy。
- [x] 确认 2026-09-05 23:13:57、23:14:31、23:14:47 的 KOOK 失败，以及
  23:14:55、23:41:47、23:41:50 的 Telegram 失败，均落在同一条 `arthur-combo` 模型请求链路。
- [x] 根因已交叉验证：LangBot `9Router` provider 保存的 API key 长度为 3，
  `9router` 数据库当前 active API key 长度为 35；使用 LangBot 当前 key 请求 `/v1/models`
  返回 HTTP 401 `API key required for remote API access`，使用 9router active key 返回 HTTP 200。
- [x] 排除 Telegram/KOOK 传输层为主因：两平台的 `/whoami` 和部分后续消息仍成功出站，
  `scripts/doctor.sh` 通过（0 failure、0 warning）。
- [x] 记录次要运行时告警：9router 的 Kiro OAuth refresh token 返回 `invalid_grant`，
  Codex Luna 曾出现短时 account lock；它们不是本次 401 的直接根因。
- [x] 用户已将 9router active API key 重新绑定到 LangBot `9Router` provider；只读复核确认
  provider key 与 9router active key 完全一致，使用该 key 请求 `/v1/models` 返回 HTTP 200。
- [x] 修复后 Telegram 私聊和群聊测试均成功完成模型流式响应（各 2 chunks），最近日志没有
  新增该 HTTP 401；用户确认 KOOK 与 Telegram 均已恢复。
- [x] 不需要重建镜像或重启容器；LangBot 通过管理 API 保存 provider 更新后立即恢复。
- [ ] 9router 的 Kiro `invalid_grant` 和 Codex Luna account lock 仍是独立的上游告警，后续
  如需稳定 fallback 再单独处理；不影响本次 key 修复结论。

## Developer Workflow Optimization V1（2026-09-05）

- [x] 落地 `FAST` / `RUNTIME` / 显式 `RELEASE` 规则与 `scripts/developer-workflow.sh` 自动 scope 分类。
- [x] docs、tests、`.agent` 默认 FAST；`apps/agent-runtime/src/**` 与
  `packages/homehub-domain/src/**` 默认 RUNTIME，且不触发 Docker build。
- [x] Dockerfile、`.dockerignore`、package manifest、`pnpm-lock.yaml` 标记
  `RELEASE_BUILD_REQUIRED`；LangBot plugin/patch 与 env-only 分别路由到专用 no-build workflow。
- [x] `apps/agent-runtime/Dockerfile` 已把 manifests/lockfile 与 `pnpm install` 放到 source copy 前，
  并用 BuildKit `/pnpm/store` cache mount；final stage 改用 `COPY --chown`，避免 `chown -R` 大层重写。
- [x] 新增非 Docker `scripts/smoke-agent-runtime.sh`，验证 `/healthz` 与 `/homehub/health`。
- [x] 新增 `scripts/deploy-agent-runtime.sh`：默认 dry-run，任何 apply 都使用
  `docker compose up -d --no-build`；仅 `--apply --build` 允许 host BuildKit 构建、commit-tag image
  transfer、健康检查与 compose rollback backup。
- [x] 已完成 workflow 分类测试、RUNTIME 定向 typecheck/tests/local smoke、optimized image container smoke；
  BuildKit benchmark 证明单一 HomeHub TS 改动仍命中 `pnpm install` cache。
- [x] 关键时间记录：原 Dockerfile 的 source-change build 132.25s（install 114.0s）→ 新 Dockerfile
  22.37s（install `CACHED`），降低 83.1%；image size 降低 24.0%。
- [x] 详细规则、环境边界和 benchmark 写入 `docs/DEVELOPER_WORKFLOW.md`。

## Codex 配置变更（2026-09-05）

- [x] 已在仓库根目录 `AGENTS.md` 与用户级 `/Users/blacksidev/AGENTS.md` 写入强制规则：禁止为 goal 手动设置、指定、增加或限制预算；调用 `/goal`/`create_goal` 时省略 `token_budget`，使用 Codex 默认预算机制。
- [x] 完成只读 `/whoami` 命令：Telegram/KOOK 私聊和群聊/频道均通过统一平台契约处理。

## `/whoami` 平台来源修复（2026-09-05）

用户实测发现 Telegram `/whoami` 曾错误显示 `platform: kook`。根因是 LangBot 的
`PersonCommandSent`/`GroupCommandSent` 命令事件原本没有携带平台字段，旧兼容默认值把
Telegram session 当成了 KOOK。

- [x] build-time patch 为 LangBot command event 增加平台字段，并按实际 source adapter 判定 `telegram`/`kook`。
- [x] EventListener 接管 command event 后再执行 `/whoami`，继续使用真实 `sender_id`，不使用昵称判断。
- [x] patched LangBot image `local/langbot-agent:1adbc1d-whoami-display-20260905` 已激活，plugin 3.2.4 已重新安装并 ready。
- [x] runtime 与 LangBot 容器健康检查通过。
- [ ] 等待真实 Telegram 用户再次发送 `/whoami` 完成最终入站回归确认。

## HomeHub `/whoami` 完成清单

- [x] 通过 `NormalizedBotMessage.user.platformUserId` 使用平台真实唯一用户 ID。
- [x] 通过 `IdentityRegistry` 只按平台和稳定用户 ID解析 `internalUser`/`role`；未绑定返回 `unbound`。
- [x] 通过独立的只读 runtime path 和 `PresentationModel` 返回结构化身份信息，不读取或写入 Context，不调用数据层、Action 或危险工具。
- [x] LangBot V3 增加 `/whoami` Command，复用 Telegram/KOOK session Adapter 和 `/v3/whoami` endpoint。
- [x] 增加 Telegram 私聊/群聊、KOOK 私聊/频道、同昵称不同 userId 和无状态修改测试。
- [x] 推送 `main` 到 `origin`，在 Ubuntu/CasaOS 激活 runtime 镜像并安装 LangBot V3 plugin 3.2.4。
- [x] 通过 runtime `/healthz`、`/v3/whoami`、`scripts/doctor.sh` 完成部署后验证；保留 compose 回滚副本。
- [ ] 使用真实 Telegram/KOOK 用户事件执行最终入站烟测。

## Admin Identity 配置（2026-09-05）

- [x] 新增 `TELEGRAM_ADMIN_USER_ID`、`KOOK_ADMIN_USER_ID` 环境配置项，未将真实 ID 写入源码。
- [x] 系统启动时将已配置的平台 ID 映射为 `internalUser: arthur`、`role: ADMIN`。
- [x] 已将真实值写入本机忽略文件 `.env`，该文件未进入 Git。
- [x] 已将这两个环境变量通过外部 env 文件应用到 CasaOS container，并完成 runtime 重启。

## HomeHub V1.1 Security & Runtime Reliability（2026-09-05）

状态：**IMPLEMENTED / TARGETED VERIFIED / DEPLOYED**。

- [x] 新增平台无关 `AuthorizationCore`：`PlatformIdentity → InternalIdentity → Role → Authorization`；未配置映射默认 `PUBLIC`，副作用 Action 默认 DENY。
- [x] Telegram / KOOK 统一使用 `NormalizedBotMessage.user.platformUserId`，不读取 nickname、displayName、username 或 chat name；管理员映射只来自 `TELEGRAM_ADMIN_USER_ID` / `KOOK_ADMIN_USER_ID`，内部用户为 `arthur`。
- [x] 所有 HomeHub restart/start/stop/organize media 经过授权、风险判断、确认、执行和验证；`pendingAction` 精确绑定 platform、chatId、platformUserId、actionId；外国用户确认会被拒绝并审计。
- [x] Service Registry 为 13 个服务声明 `runtime` / `executor`，区分 Docker、LangBot Component、Ubuntu Process 和 macOS Host Service；`cloudflared` 没有 macOS Host Executor 时返回 UNKNOWN。
- [x] Host / Docker 检查改为当前运行边界的 direct executor，不再调用 `orb -m ubuntu`；executor 或 observation failure 不再转换为 DOWN。
- [x] Health 状态区分 HEALTHY、UNHEALTHY、DOWN、UNKNOWN；未知状态不进入 abnormal service 数量；CPU/Memory/Disk 不可读时返回 null，渲染为“未知”。
- [x] organize-emby plugin 在 Preview / Execute 前调用共享 `/homehub/authorize`，Authorization transport failure fail closed；插件 Preview key 同时保存 platform、chat、platform user 和 action ID。
- [x] 运行 `pnpm workflow:verify`：affected typecheck、HomeHub security/V1 定向测试、`/healthz` + `/homehub/health` local smoke 全部通过。
- [x] 运行 `scripts/deploy-langbot.sh --plugin organize-emby --dry-run --skip-runtime-check`：plugin package / secret scan 通过；未安装 plugin、未 build image、未修改 CasaOS。
- [x] 运行 Python `py_compile/compileall`、`git diff --check`。
- [x] V1.1 implementation commit：`e0a3ed5`（feat: harden homehub authorization and runtime health）。

HomeHub V1 已完成 Git source-of-truth 中的 domain、runtime facade、HTTP 接线、服务诊断、
确认式操作、审计、上下文和安全媒体整理预览/执行流程。`/whoami` runtime 已部署到
OrbStack ubuntu/CasaOS，真实 Telegram/KOOK 入站烟测仍作为后续人工任务保留。

Meta WhatsApp Cloud API 的商业版能力是接入稳定性与合规的必要前提。
当前开源版限制与平台变更频率较高，暂不继续投入实现和部署。

## 后续 small-scope task：PUBG Intent Router 时间词误判（2026-09-05）

状态：**IMPLEMENTED / TARGETED VERIFIED / COMMITTED**。

- [x] TimeRange 只能作为参数，不能单独触发 PUBG。
- [x] 先判断 Domain/Intent，再解析 TimeRange；使用正向 PUBG intent 与结构化 follow-up，不堆 negative keywords。
- [x] 明确 PUBG 语义或 activeDomain=pubg 的有效追问才进入 PUBG；长技术句不会因日期前缀继承 PUBG context。
- [x] 回归：`昨天战绩` → PUBG；PUBG 上下文后的 `前天呢？` → PUBG；`昨天超的是CL30, tRCD 36, tRP 36, tRAS 80` → NOT PUBG；`昨天 Emby 挂了吗` → HomeHub / NOT PUBG。
- [x] 仅运行 affected typecheck + targeted router/query tests、`git diff --check` 和 secret scan；未执行 Docker build / Release。
- [x] 独立代码/文档 commit：`d12b733`。

## HomeHub V1 完成清单

- [x] 新增 `packages/homehub-domain`，包含 schema、服务注册、主机采集、诊断、操作授权、上下文和审计。
- [x] 在 `apps/agent-runtime` 接入 HomeHub runtime、HTTP endpoint 和 PUBG/HomeHub 路由分流。
- [x] 对高风险服务保留确认门槛，操作结果执行后验证并写入审计日志。
- [x] 接入媒体整理的明确目标、预览、确认、备份、允许目录约束和目标冲突拒绝流程。
- [x] 增加 HomeHub 与媒体整理回归测试，并修复默认请求字段、查询分类和高风险授权顺序问题。
- [x] 完成 typecheck、build、runtime tests、legacy-v2 tests、secret scan 和 diff 检查。

## 完成清单

- [x] **Monorepo Migration Phase**
  - [x] 建立 pnpm workspace monorepo 结构
  - [x] 归档 Mastra/PUBG、Telemetry、Platform Adapter、WhatsApp 和 V2 domain
  - [x] 归档 LangBot 自定义插件、patch、资源和兼容说明
  - [x] 归档 n8n workflow JSON 与 credential placeholder
  - [x] 提供 CasaOS/Docker、Cloudflare、macOS 脱敏模板
  - [x] 建立 bootstrap.sh、doctor.sh、backup.sh、restore.sh
  - [x] 建立 check-secrets.sh、.gitignore、.env.example
  - [x] 建立 README、架构、状态、决策、清单和 checkpoint
  - [x] GitHub 远程配置并验证推送

- [x] **Codex Engineering Specifications Phase**
  - [x] 完善 AGENTS.md 为全局工程规则
  - [x] 创建 4 个可迁移的 Codex Skills（agent-checkpoint、langbot-development、n8n-workflow-development、release-and-migration）
  - [x] 新增 docs/PROJECT_MAP.md 说明目录职责
  - [x] 新增 scripts/deploy-langbot.sh 实现 Git-first 部署流程
  - [x] 更新 README.md 反映 GitHub 配置和部署说明
  - [x] 创建工程规范完成 checkpoint（.agent/checkpoints/2026-09-05-codex-engineering-specs.md）

- [x] **WhatsApp 接入暂停 Phase**
  - [x] 在 docs/DECISIONS.md 记录暂缓原因和恢复条件
  - [x] 在 docs/PROJECT_STATE.md 更新 WhatsApp 接入状态
  - [x] 确认 WhatsApp 代码不影响 KOOK / Telegram runtime
  - [x] 确认无默认启用配置，代码仅作为静态导出
  - [x] 保留 Cloudflare Tunnel 配置用于未来 Webhook / HomeLab API
  - [x] 保留已完成的 Adapter/实验代码作为 future integration reference

## 暂缓原因

Meta WhatsApp Cloud API 的商业版能力（如 webhook 批量验证、会话模板、高并发消息队列）是接入稳定性与合规的必要前提。当前开源版限制与平台变更频率较高，暂不继续投入实现和部署。

详见 docs/DECISIONS.md 的"2026-09-05：WhatsApp 接入暂缓"章节。

## 保留的代码和配置

- apps/whatsapp-adapter：Meta Cloud API 的 webhook 验签、入站消息归一化、文本拆分和发送器边界 facade
- apps/agent-runtime/src/platform/whatsapp：完整实现的 WhatsApp platform adapter、renderer、webhook、sender 和 graph-api
- integrations/langbot/patches/whatsapp.yaml：LangBot 侧的自定义平台资源
- infra/cloudflare：Cloudflare Tunnel 配置模板（保留用于未来 Webhook / HomeLab API）

## 确保不影响其他平台

- WhatsApp 相关代码仅作为静态导出，不影响 KOOK / Telegram runtime 路由
- Platform capabilities 定义保持静态配置，不引入运行时依赖
- Runtime 镜像中的 whatsapp 标签仅表示构建时包含相关代码，不会自动启用

## 验证结果

- [x] **Monorepo 基础验证**
  - [x] pnpm install 生成根 pnpm-lock.yaml
  - [x] pnpm typecheck、pnpm build
  - [x] pnpm test：83 个 runtime tests（82 pass，1 个外部 fixture 缺失而 skip）
  - [x] pnpm test:legacy-v2：30 个 Python tests 通过
  - [x] pnpm check:secrets
  - [x] Shell/Python 语法、脚本 dry-run/help smoke test
  - [x] 所有脱敏 Compose 模板通过 docker compose config

- [x] **工程规范验证**
  - [x] pnpm check:secrets（通过）
  - [x] git diff --check（通过）
  - [x] 4 个 Skills 符合 skill-creator 规范
  - [x] deploy-langbot.sh 语法验证（bash -n）
  - [x] Git 仓库干净并成功推送到 origin/main

- [x] **WhatsApp 暂缓验证**
  - [x] 确认 WhatsApp 代码仅作为静态导出
  - [x] 确认无默认启用配置
  - [x] 确认不影响 KOOK / Telegram runtime
  - [x] Cloudflare Tunnel 配置保留

## 会话启动协议

新会话先读取：

    README.md
    docs/ARCHITECTURE.md
    docs/PROJECT_STATE.md
    docs/CURRENT_TASK.md
    docs/PROJECT_MAP.md
    .agent/state.md

然后执行：

    git status --short --branch
    git log -5 --oneline --decorate

按需读取 skills/*/SKILL.md 了解特定工作流程。

## 后续工作规则

任何后续部署或运行时变更必须：

1. 遵循 AGENTS.md 中定义的全局工程规则；
2. 使用相应的 Codex Skills（如 langbot-development、n8n-workflow-development）；
3. 确认目标是 OrbStack ubuntu 内的 CasaOS；
4. 只从外部 secret store 恢复 credential；
5. 更新本文件、docs/PROJECT_STATE.md 和一个新的 checkpoint；
6. 跑与改动匹配的测试以及 pnpm check:secrets。

## 恢复条件

1. 获得 WhatsApp Business API 商业版授权
2. 明确所需的消息模板、会话状态和 webhook 验签能力
3. 完成与现有 runtime 的集成测试和性能基准

## 恢复操作

1. 重新评估 Meta Cloud API 最新能力与合规要求
2. 更新 docs/CURRENT_TASK.md 状态
3. 启用 apps/agent-runtime/src/platform/whatsapp 相关代码
4. 配置 Cloudflare Tunnel 和 LangBot webhook 集成

## 下一个潜在任务

当前代码阶段没有未完成的本地实现；后续仅需按 `.agent/tasks/homehub-runtime-smoke.md` 在目标
Ubuntu/CasaOS 环境执行人工烟测。WhatsApp 接入已按需求暂缓。可以支持：
- Codex 新会话从 Git 恢复上下文
- Mac mini 迁移使用已建立的恢复流程
- LangBot 和 n8n 变更遵循文档化的工作流程
- 使用 deploy-langbot.sh 进行安全的插件/patch 部署
- 在满足恢复条件后重新启动 WhatsApp 接入工作

如需开始新阶段，请更新此文件中的"当前阶段"和"完成清单"。
