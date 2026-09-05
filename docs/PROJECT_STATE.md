# Project State

更新时间：2026-09-05（Asia/Shanghai）

## 状态

Monorepo 迁移、Codex 工程规范和 HomeHub V1 代码阶段已完成，当前仓库可以作为代码、
配置模板、workflow、文档和 Codex 状态的 Git source of truth。`main` 已跟踪用户指定的
`origin/main`；没有把运行时数据或真实 credentials 放入仓库。

## 当前运行时观察

以下信息来自本机 Ubuntu/CasaOS 的只读检查，用于迁移基线，不是新机器的硬编码地址：

| 组件 | 当前观察 |
| --- | --- |
| OrbStack machine | ubuntu running |
| LangBot | langbot + langbot_plugin_runtime，兼容 LangBot 4.10.8 定制镜像 |
| Mastra/PUBG runtime | pubg-query-engine-v3，镜像 local/pubg-query-engine-v3:3.3.2-whatsapp-20260905-3，healthy，端口 5310 |
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

## HomeHub V1 状态：IMPLEMENTED / NOT YET DEPLOYED

HomeHub V1 已进入 Git source of truth，包含：

- `packages/homehub-domain`：平台无关的服务 registry、schema、主机指标、健康诊断、操作授权、上下文和审计；
- `apps/agent-runtime/src/runtime/homehub-runtime.ts`：runtime facade 与健康/查询入口；
- `apps/agent-runtime/src/homehub`：HomeHub entry 与安全媒体整理操作器；
- `/homehub/health`、`/homehub/route`、`/homehub/query` 和 Telegram polling 诊断 endpoint；
- `/v3/query` 对 HomeHub 路由的分流，避免 HomeHub 请求落入 PUBG planner。

安全约束：服务操作按风险等级要求确认；媒体整理必须指定下载项目，先预览，再确认、备份并逐项移动，
只允许 `/Volumes/Avalon/downloads` 到 `/Volumes/Avalon/media/{movies,tv}`，拒绝覆盖已有目标。
尚未在 OrbStack ubuntu/CasaOS 中执行 `--apply` 部署和真实 Telegram/KOOK 入站烟测。

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
