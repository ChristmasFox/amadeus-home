# Project State

更新时间：2026-09-06（Asia/Shanghai）

## HomeHub Docker Executor + PUBG KD 修复：DEPLOYED / VERIFIED

HomeHub source 已新增受限 `DockerApiCommandExecutor`，通过只读 Docker socket 使用 Docker Engine API，
严格限制 Service Registry 中的容器名和 `ps` / `inspect` / bounded `logs` / `stats` 观察；变更只允许
`start` / `restart`，不再调用 Docker Compose，也不会提供 `exec`、`run`、`rm` 或任意 shell passthrough。
Docker socket 不可用、权限失败或 daemon 不可达时保持 `UNKNOWN`，不会误判为 `DOWN`。

runtime compose 模板已声明 `/var/run/docker.sock:/var/run/docker.sock:ro` 和 `DOCKER_SOCKET_GID`，
HostCollector 默认不读取容器自身 `/proc` 作为 macOS Host 指标；无 macOS Host Executor 时 CPU、内存和
主机状态为 UNKNOWN，并返回 `macOS executor unavailable` 原因。新增 `GET /status` 可输出真实 Docker
service inventory。生产 canonical compose 仍需执行 `scripts/deploy-homehub-docker-socket.sh --apply`，
随后由 `scripts/smoke-homehub-docker.sh` 完成实际容器内验证。2026-09-06 实际运行验证通过：
image `local/pubg-query-engine-v3:git-1a8a825812b6`，compose rollback backup
`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-105507`，socket
为只读 bind mount、UID 1000 node 通过 GID 104 访问；7 个 allowlisted containers 被 client 列出，
`GET /status` 返回 8 healthy、3 down（postgres/redis/glances 不存在）、1 unhealthy（Jellyfin 日志错误）
和 1 unknown（macOS cloudflared），没有全量 UNKNOWN。主机指标保持 `UNKNOWN` 并明确说明无 macOS executor。

PUBG KD 修复同时覆盖 n8n v3 match normalization、runtime legacy record normalization 和 renderer：旧记录
缺失 `deaths` 时按 placement proxy 补齐；零死亡分母不再显示数学 `∞`，而显示未定义 `—`。源码定向与
完整 runtime tests 已通过，生产 `/status` smoke 也通过；零死亡 KD 不再向用户渲染 `∞`，而显示 `—`。

## 状态

Monorepo 迁移、Codex 工程规范、HomeHub V1 和 HomeHub V1.1 Security & Runtime Reliability
实现阶段已完成；HomeHub V1.1 已通过测试并提交为 `e0a3ed5`，PUBG Intent Router 时间词误判 task
已通过 targeted verification 并以独立 commit `d12b733` 提交。生产 runtime 已在 OrbStack `ubuntu` / CasaOS
使用 immutable image `local/pubg-query-engine-v3:git-46efb62eba0c` 部署并验证 healthy。仓库继续作为代码、
配置模板、workflow、文档和 Codex 状态的 Git source of truth；没有把运行时数据或真实 credentials 放入仓库。

## Telegram / KOOK `Request Failed` 事故：RESOLVED / VERIFIED（2026-09-05）

2026-09-05 晚间 KOOK 和 Telegram 均出现多条 `Request Failed`。只读检查确认这不是两个平台
适配器同时掉线，而是它们共用的 LangBot `arthur-combo` 模型请求链路认证失败：LangBot 的
`9Router` provider 仍保存一个 3 字符的旧/占位 API key，而 9router 本地数据库当前 active key
为另一把 35 字符 key。使用前者访问 `http://9router:20128/v1/models` 返回 HTTP 401
`API key required for remote API access`；使用后者返回 HTTP 200。

最近一批错误为：KOOK 23:13:57、23:14:31、23:14:47；Telegram 23:14:55、23:41:47、
23:41:50（Asia/Shanghai）。平台传输仍有成功记录，Telegram/KOOK `/whoami` 和部分普通消息
可出站；LangBot、插件 runtime、9router 和 Mastra runtime 容器仍在运行，`scripts/doctor.sh`
报告 0 failure / 0 warning。

用户已在 LangBot 管理界面修正 provider credential。复核确认 LangBot provider key 与 9router
active key 完全一致，访问 `/v1/models` 返回 HTTP 200；修复后 Telegram 私聊和群聊测试均成功
完成流式回复，用户确认 KOOK 与 Telegram 均恢复。未重建镜像，LangBot 也无需重启。

修复过程和回滚步骤保留在 `.agent/tasks/2026-09-05-kook-telegram-request-failed.md`，本次
完成记录见 `.agent/checkpoints/2026-09-05-kook-telegram-request-failed-resolved.md`。
9router 同时存在 Kiro OAuth `invalid_grant` 和 Codex Luna 短时 account lock 告警，属于独立的
上游可用性问题，修复 key 后仍需观察 fallback。

## Developer Workflow Optimization V1：COMPLETE（未部署）

开发/验证/部署已采用 FAST / RUNTIME / RELEASE 分层。`scripts/developer-workflow.sh` 依据 Git diff
识别 docs/tests/.agent、HomeHub/runtime source、Docker/package/lockfile、LangBot plugin/patch 和 env-only
scope，并默认选择最低足够流程。普通 HomeHub/runtime TS 修改进入 RUNTIME：typecheck/build、映射后的
定向 tests、非 Docker `/healthz` + `/homehub/health` smoke；不会自动 Docker build、Compose restart 或
CasaOS deploy。

`apps/agent-runtime/Dockerfile` 已改为 manifest/lockfile -> BuildKit cached `pnpm install` -> source ->
build/deploy，且 production stage 使用 `COPY --chown` + 单独 `/data` 创建。2026-09-05 host BuildKit
实测：原 Dockerfile 单一 HomeHub source 改动 build 为 132.25s（`pnpm install` 114.0s），新 Dockerfile
为 22.37s（install `CACHED`），减少 83.1%；最终 image 从 474,477,455 B 至 360,758,644 B（-24.0%）。
优化 image 的容器 `/healthz` 和 `/homehub/health` smoke 已通过。

新增 `scripts/deploy-agent-runtime.sh` 默认 dry-run；显式 apply 一律使用
`docker compose up -d --no-build`。只有干净已提交 source 下的 `--apply --build` 执行 tests、secret scan、
host Buildx immutable commit-tag image build、transfer 到 Ubuntu、compose update、health/smoke 与 rollback
compose backup。此阶段未传入或部署新 image，当前 CasaOS runtime 仍保持既有 `3.3.4-admin-03b0e41`。
详见 `docs/DEVELOPER_WORKFLOW.md`。

## Codex Goal 预算策略

仓库根目录 `AGENTS.md` 与用户级 `/Users/blacksidev/AGENTS.md` 均规定：禁止为 goal
手动设置、指定、增加或限制预算；调用 `/goal` 或 `create_goal` 时不得传入 `token_budget`，
只能使用 Codex 默认预算机制。该约定不覆盖 Codex 平台自身的系统上限；达到系统上限时应在
新的任务或会话继续。

## HomeHub `/whoami` 状态：IMPLEMENTED / DEPLOYED / INBOUND SMOKE PENDING

只读 `/whoami` 已进入 Git source of truth。runtime 提供 `/whoami`、`/homehub/whoami` 和
`/v3/whoami` POST aliases，LangBot V3 plugin 注册 `/whoami` Command。输出同时包含文本和
结构化 `data`/`PresentationModel`，字段为 `platform`、`platformUserId`、`chatId`、
`chatType`、`displayName`、`internalUser`、`role`。

身份解析只使用平台事件归一化后的 `NormalizedBotMessage.user.platformUserId`：Telegram
来源是事件 `from.id`，KOOK 来源是事件 `author_id`（或 Adapter 暴露的同一稳定 sender ID）。
未建立映射时输出 `internalUser: unbound`、`role: unbound`；昵称、用户名和 display name
不参与身份判定。

`/whoami` 不读取或写入 Context，不调用 DataProvider、ActionEngine、审计或危险工具。当前
runtime 镜像已在 OrbStack ubuntu/CasaOS 健康运行，LangBot V3 plugin 3.2.4 已通过本地 API
安装并 ready；真实 Telegram/KOOK 入站事件烟测仍待执行。

部署记录：Git `main` 已推送至 `origin`，runtime 镜像为
`local/pubg-query-engine-v3:3.3.3-whoami-ddfee46`（image id
`sha256:4e902c2b578777be6c42733d180da5dc8e72e883139611833856504d336b8383`），CasaOS compose
回滚副本位于 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260905-214712`。

## `/whoami` 平台来源修复状态：DEPLOYED / RECHECK PENDING

已修复 LangBot command event 缺少 `platform` 导致 Telegram 被当成 KOOK 的问题。当前
LangBot 与 plugin runtime 使用 `local/langbot-agent:1adbc1d-whoami-display-20260905`，其中
`PersonCommandSent`/`GroupCommandSent` 会从 `query.adapter` 传递真实平台；plugin gateway
监听 command event 后才调用 `/v3/whoami`。等待真实 Telegram 用户再次发送命令确认最终入站输出。

## Admin Identity 配置状态：DEPLOYED / INBOUND RECHECK PENDING

runtime 启动配置读取 `TELEGRAM_ADMIN_USER_ID` 和 `KOOK_ADMIN_USER_ID`，配置值存在时只按
平台稳定 ID建立同一个 `arthur` / `ADMIN` mapping；缺少或占位值时不建立绑定。真实值已
写入本机被 Git 忽略的 `.env`，没有写入源码或 `.env.example`。CasaOS runtime 已通过外部
env 文件加载这两个变量并重启生效；真实 Telegram/KOOK 入站复测仍待执行。

active runtime image：`local/pubg-query-engine-v3:3.3.4-admin-03b0e41`；外部 identity env
file：`/DATA/AppData/pubg-query-engine-v3/admin-identity.env`。回滚 compose 副本和部署过程
记录在 `.agent/checkpoints/2026-09-05-homehub-admin-identity-deployment.md`。

## 当前运行时观察

以下信息来自本机 Ubuntu/CasaOS 的只读检查，用于迁移基线，不是新机器的硬编码地址：

| 组件 | 当前观察 |
| --- | --- |
| OrbStack machine | ubuntu running |
| LangBot | langbot + langbot_plugin_runtime，镜像 local/langbot-agent:1adbc1d-whoami-display-20260905，兼容 LangBot 4.10.8 定制镜像 |
| 9router | 9router running；`/api/health` 可用；LangBot provider key 已与当前 active API key 同步，`/v1/models` 验证通过 |
| Mastra/PUBG runtime | pubg-query-engine-v3，镜像 local/pubg-query-engine-v3:3.3.4-admin-03b0e41，healthy，端口 5310 |
| Telemetry | 嵌入 runtime，parser telemetry-parser-4 |
| Review | feature version review-features-4 |
| n8n | n8n running，主机端口 5679 |
| n8n sandbox | compose 已存在，TLS/data 在 /DATA/AppData/n8n-sandbox |
| Postgres / Redis | 当前 Ubuntu 可观察到共享服务；n8n 是否使用 Postgres 需以恢复后的 env 和连接测试为准 |
| Cloudflare Tunnel | 当前容器列表未发现 tunnel；仓库只提供配置模板和检查逻辑 |

Runtime 的 PUBG API key 使用 /run/secrets/pubg_api_key 文件注入；仓库只保存
secret file 路径和空的环境变量，不保存 key。

## 已归档

- Mastra/PUBG V3 runtime、Telemetry、Platform Adapter、WhatsApp 和测试；
- PUBG V2 Python domain、V2 LangBot plugin 和 legacy workflow；
- LangBot V3/V2、organize-emby、macOS NAS control 自定义插件；
- KOOK、Telegram polling、消息转换、PUBG picker、WhatsApp patch/resource；
- n8n V3/V2、PUBG daily stats、organize-emby workflow；
- CasaOS 架构与平台适配历史文档的脱敏归档；
- bootstrap、doctor、backup、restore、secret scan 和插件构建脚本；
- LangBot deploy dry-run/apply 脚本、项目地图和四个可迁移 Codex skills；
- workflow / plugin / service 兼容说明以及 Codex checkpoint。

## HomeHub V1.1 Security & Runtime Reliability 状态：IMPLEMENTED / TARGETED VERIFIED / COMMITTED / DEPLOYED（2026-09-05）

V1.1 已在 Git source 中完成统一授权、管理员身份、运行时执行边界和健康状态语义修复：

- `packages/homehub-domain/src/authorization/authorization-core.ts` 提供平台无关的身份映射和 Action policy；
- `packages/homehub-domain/src/execution/runtime-executor.ts` 提供 Docker、Ubuntu、macOS Host 和 LangBot Component executor；
- `ServiceRegistry` 为 LangBot、Telegram/KOOK、PUBG Runtime、n8n、Postgres、Redis、Emby、Jellyfin、qBittorrent、aria2、Glances、cloudflared 声明执行位置；
- HomeHub Entry / ActionEngine / organize-emby confirmation 使用精确 platform + chat + platform user + action 绑定；
- `HealthResult.summary` 增加 `down`，executor/observation failure 只产生 `unknown`，不会加入 `abnormal`；
- host metrics 失败保留 null，不回填 0%；`/homehub/authorize` 仅返回共享授权决策，不执行操作。

V1.1 的验证证据包括 affected typecheck、HomeHub security/runtime 定向测试、local endpoint smoke、Python plugin
compile、LangBot plugin dry-run/package validation、secret scan 和 diff check。代码已提交为 `e0a3ed5`，并已部署到 CasaOS；当前 image 为 `local/pubg-query-engine-v3:git-46efb62eba0c`。

## Production Deployment 状态：HEALTHY（2026-09-05）

- image：`local/pubg-query-engine-v3:git-46efb62eba0c`
- machine：OrbStack `ubuntu` / CasaOS
- compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`
- rollback backup：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-012427`
- `pubg-query-engine-v3`：`Up (healthy)`
- `/healthz` 与 `/homehub/health`：HTTP 200 / healthy
- 首次 build 因 host proxy `127.0.0.1:7897` refused 失败，未触碰 compose；使用 `--no-proxy` 重试成功。
- 部署未修改 AppData、媒体库和 secrets。

## 后续 task 状态：PUBG Intent Router 时间词误判 / IMPLEMENTED / COMMITTED

TimeRange 已从正向 PUBG intent 中移除；router 先判断 Domain/Intent，再允许时间范围作为参数进入 planner。
结构化 active PUBG follow-up 只接受紧凑时间追问或 PUBG 对局引用，长技术句不会仅凭日期前缀继承 PUBG。
目标回归全部通过：“昨天战绩”进入 PUBG、“前天呢？”在 PUBG 上下文中进入 PUBG、硬件时序句不进入 PUBG、
“昨天 Emby 挂了吗”进入 HomeHub。代码与状态文档已单独提交；只运行 affected typecheck、targeted tests、
secret scan 和 diff check，未构建 Docker image 或执行 Release。

## HomeHub V1 状态：IMPLEMENTED / V1.1 PRODUCTION DEPLOYED

HomeHub V1 已进入 Git source of truth，包含：

- `packages/homehub-domain`：平台无关的服务 registry、schema、主机指标、健康诊断、操作授权、上下文和审计；
- `apps/agent-runtime/src/runtime/homehub-runtime.ts`：runtime facade 与健康/查询入口；
- `apps/agent-runtime/src/homehub`：HomeHub entry 与安全媒体整理操作器；
- `/homehub/health`、`/homehub/route`、`/homehub/query` 和 Telegram polling 诊断 endpoint；
- `/v3/query` 对 HomeHub 路由的分流，避免 HomeHub 请求落入 PUBG planner。

安全约束：服务操作按风险等级要求确认；媒体整理必须指定下载项目，先预览，再确认、备份并逐项移动，
只允许 `/Volumes/Avalon/downloads` 到 `/Volumes/Avalon/media/{movies,tv}`，拒绝覆盖已有目标。
V1.1 已在 OrbStack `ubuntu` / CasaOS 执行 `--apply --build --no-proxy` 并验证 healthy；真实 Telegram/KOOK 入站授权烟测仍需单独执行。生产部署 checkpoint：`.agent/checkpoints/2026-09-05-homehub-v1.1-production-deployment.md`。

## 已验证的边界

- 第三方 LangBot 本体没有复制进仓库。
- node_modules、dist、__pycache__、.pyc、.lbpkg、日志和业务数据未纳入 Git。
- 原始 9router / aria2 compose 中的真实密钥没有迁移，只生成脱敏模板。
- 共享 media、下载目录、Postgres、n8n data、LangBot data 与 Redis 都与 Git 分离。
- 新机器恢复路径是 clone -> 恢复 secrets -> bootstrap -> 恢复数据 -> 启动 -> doctor。
- LangBot plugin 从 Git 构建 `.lbpkg` 后通过 API 安装；LangBot patch 只在 overlay image
  构建阶段应用，不直接改运行容器。

## 待人工完成的运行时动作

这些不是 Git 迁移缺口，而是每台新机器必须按实际环境完成的操作：

1. 在密码管理器中恢复 LangBot、n8n、PUBG、9router、aria2 和 Cloudflare secrets。
2. 在 n8n 重新创建 credentials，导入 workflow，并确认 Data Table / webhook 映射。
3. 如启用 Cloudflare，创建 tunnel、放置 credentials file，并按模板配置 ingress。
4. 构建与发布目标架构可用的 runtime / LangBot 定制镜像。
5. 启动后运行 scripts/doctor.sh、HomeHub endpoint 检查和真实平台入站烟测；不要用 bot 自发消息替代真实入站验证。

## 工程规范基线

- Git 仓库是唯一 source of truth，禁止 runtime-only 修改；Domain 不依赖平台，LLM
  保持在边界，核心逻辑 deterministic。
- n8n 修改必须导出 JSON；第三方 LangBot patch 必须可追踪、可重建、可回滚。
- 每个阶段必须更新状态文档、运行匹配测试、执行 secret scan，并写入 checkpoint。

## 下一步建议

后续开发应先读取 README.md、本文、docs/CURRENT_TASK.md、.agent/state.md，
再查看 Git 状态和最近五次提交。若修改部署，优先修改 infra/docker/ 模板或
实际 CasaOS compose，并同步更新本文件和 checkpoint。

## 最终验证

- 根 pnpm workspace install 使用唯一 pnpm-lock.yaml 成功；
- TypeScript typecheck/build 成功；runtime 92 项测试中 91 项通过、1 项因外部 fixture 缺失跳过；
- legacy-v2 Python 测试 30 项通过；
- shell/Python 语法、bootstrap/backup/restore smoke test 和 Compose config 通过；
- check-secrets 通过，且 staged 文件没有真实 credential 或运行时数据；
- Docker build 命令已写入 apps/agent-runtime/README.md；基础镜像元数据检查因 Docker Hub 网络超时未完成，
  需在网络可用时手动执行。

## WhatsApp 接入状态：BLOCKED / DEFERRED

状态更新：2026-09-05

Meta WhatsApp Cloud API 接入工作已暂停，原因和计划详见 docs/DECISIONS.md。

当前保留：
- apps/whatsapp-adapter：Meta Cloud API 的 webhook 验签、入站消息归一化、文本拆分和发送器边界 facade
- apps/agent-runtime/src/platform/whatsapp：完整实现的 WhatsApp platform adapter、renderer、webhook、sender 和 graph-api
- integrations/langbot/patches/whatsapp.yaml：LangBot 侧的自定义平台资源
- infra/cloudflare：Cloudflare Tunnel 配置模板（保留用于未来 Webhook / HomeLab API）

确保不影响其他平台：
- WhatsApp 相关代码仅作为静态导出，不影响 KOOK / Telegram runtime 路由
- Platform capabilities 定义保持静态配置，不引入运行时依赖
- Runtime 镜像中的 whatsapp 标签仅表示构建时包含相关代码，不会自动启用

恢复条件和操作步骤见 docs/DECISIONS.md。
