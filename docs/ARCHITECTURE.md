# Architecture

更新时间：2026-09-05（Asia/Shanghai）

## 总体拓扑

长期服务的 canonical runtime 是 OrbStack Linux machine ubuntu 中的 CasaOS。
macOS 只提供 OrbStack、共享卷和可选的本地转发脚本；不把 HomeLab 服务默认部署到
macOS host Docker。

    Telegram / KOOK / WhatsApp
              |
              v
          LangBot
      custom plugins + patches
              |
              +-- command / listener / platform adapter
              |
              v
      Mastra/PUBG Agent Runtime (:5310)
        +-- query planner / domain / presentation
        +-- telemetry parser + review features
        +-- state/context/selection JSON store
              |
              v
              n8n (:5679)
        +-- PUBG API credential（运行时重新绑定）
        +-- sync workflows
        +-- data gateway
        +-- Data Table / database

## Monorepo 边界

### Apps

- apps/agent-runtime 是当前线上行为的 source-preserving Mastra/PUBG V3 实现，
  包含 server、query engine、planner、telemetry/review、平台适配器、测试和部署定义。
- apps/telemetry-worker 是 Telemetry 的稳定公开边界；当前实现仍嵌入
  agent runtime，后续可以在不改变协议的情况下拆成独立 worker。
- apps/whatsapp-adapter 是 WhatsApp adapter 的稳定公开边界；真正的发送、
  webhook 和 renderer 仍在 runtime 中，以避免迁移时改变线上行为。

### Packages

- packages/contracts：跨 app / plugin 的共享契约。
- packages/platform-core：identity、capability、message 和渲染的核心抽象。
- packages/pubg-domain：V3 domain facade 与 legacy-v2/ Python 实现。
- packages/presentation：跨平台输出边界。

这些 package 先作为明确的 API 边界，不强行复制现有相对导入。这样仓库迁移不会
同时引入一轮不可验证的架构重写。

## Integration 责任

### LangBot

integrations/langbot/ 只包含自定义资产：

- plugins/：PUBG V2/V3、organize-emby、macOS NAS control；
- patches/：KOOK、Telegram polling、消息转换、PUBG picker、WhatsApp 资源；
- config-example/：不含 credential 的配置键模板。

第三方 LangBot 本体、运行时数据库、插件安装包和容器层不进入仓库。兼容版本记录在
integrations/langbot/README.md。

### n8n

integrations/n8n/workflows/ 是 workflow source of truth，包含 V3、V2 legacy、
PUBG daily stats 和 organize-emby workflow。credential 只用 placeholder 表示；
导入后必须在目标 n8n 实例中重新创建并绑定。

### Platform Adapter

Runtime 与 LangBot 插件共享 Telegram、KOOK、WhatsApp 的平台 contract。平台差异在
adapter / renderer 层处理，业务 domain 不直接依赖某一个聊天平台。WhatsApp Cloud
API 凭据、webhook verify token 和 Telegram/KOOK token 都在运行时 secrets 中。

## 数据所有权与恢复

| 数据 | canonical 位置 | Git 策略 | 恢复策略 |
| --- | --- | --- | --- |
| Runtime state/context/features/selections | /DATA/AppData/pubg-query-engine-v3/data | 不提交 | backup.sh |
| LangBot data/plugins/SQLite | /DATA/AppData/langbot | 只提交自定义源 | volume 备份 + 重新安装插件 |
| n8n workflows | 仓库 JSON | 提交 | 导入 workflow |
| n8n credentials/executions | /DATA/AppData/n8n 与外部 secret | 不提交 | volume 备份，credentials 重新核验 |
| n8n sandbox TLS/data | /DATA/AppData/n8n-sandbox | 不提交 | volume 备份或重新生成 |
| Postgres | 对应 CasaOS AppData / volume | 不提交 | 数据库备份后恢复 |
| Redis | 对应 volume | 不提交 | 默认可重建缓存 |
| Media/downloads | /Volumes/Avalon/... | 不提交 | 由共享卷或独立备份恢复 |

默认 backup.sh 备份 LangBot、n8n、n8n-sandbox 和 PUBG runtime data；需恢复
Postgres 或其他重要 volume 时通过 --apps 显式加入。Redis 不作为核心恢复依赖。

## 部署约束

CasaOS app 定义的实际落点是：

    /var/lib/casaos/apps/<app>/docker-compose.yml

持久化数据落点是 /DATA/AppData/<app>，共享媒体落点是 /Volumes/Avalon/...。
infra/docker/ 中的文件是脱敏模板，不会自动覆盖现有 CasaOS compose。修改现有
服务前应先读取实际文件，完成后使用：

    orb -m ubuntu -u root bash -lc 'cd /var/lib/casaos/apps/<app> && docker compose up -d --no-build'
    orb -m ubuntu -u root docker ps

## 开发与镜像构建边界

FAST/RUNTIME/RELEASE 的 source-scope 选择与验证命令定义在
`docs/DEVELOPER_WORKFLOW.md`。Docker build 不属于 HomeHub/runtime source 的默认验证：
RUNTIME 只执行 TypeScript build/typecheck、定向 tests 和本地 endpoint smoke。实际 RELEASE 使用
host Docker Buildx 生成 commit-tagged image，再 transfer 到 OrbStack `ubuntu`；CasaOS 仅执行
`docker compose up -d --no-build`。这避免 Ubuntu 的运行时 compose 隐式触发新的 production build。

## 迁移不变量

1. workflow、插件源码和 patch 必须可从 Git 重建。
2. credential 值必须从 Git 和 workflow JSON 中消失。
3. 所有状态恢复操作必须显式发生在 Ubuntu/CasaOS，而不是 host Docker。
4. runtime 的结果协议、resultSetId、telemetry/review 版本和 V2 回滚边界不能因整理目录而改变。
5. 每个阶段的上下文必须写入 docs/ 与 .agent/checkpoints/，不能只存在聊天记录。
