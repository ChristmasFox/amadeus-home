# Decisions

## 2026-09-05：仓库边界

不把 /Users/blacksidev 整体初始化为 Git 仓库，而是在
/Users/blacksidev/agent-monorepo 建立独立仓库。这样不会把无关的个人文件、
临时状态和其他项目意外纳入迁移范围。

## 2026-09-05：source-preserving runtime

apps/agent-runtime 保留现有 Mastra/PUBG V3 相对导入和部署形态；
packages/* 与独立 app 先作为稳定 facade。迁移的首要目标是可恢复和不改变线上
行为，真正拆包另行进行并配套测试。

## 2026-09-05：LangBot 第三方本体不入库

只追踪自定义插件、patch、WhatsApp 资源、配置键模板和兼容版本。第三方源码、
容器层和运行时数据通过版本化镜像或外部恢复流程提供。

## 2026-09-05：数据与 Git 分离

Git 只保存系统定义。Postgres、n8n data、LangBot data、runtime state 和重要
volume 使用 backup/restore；Redis 默认视为可重建缓存。备份脚本默认排除
credentials，秘密归档必须独立并在仓库外加密保存。

## 2026-09-05：CasaOS 是 canonical runtime

长期 HomeLab 服务部署在 OrbStack ubuntu 的 CasaOS。仓库的 Docker 文件是
脱敏模板，实际修改应落在 /var/lib/casaos/apps/<app>/docker-compose.yml，
不默认使用 macOS host Docker。

## 2026-09-05：workflow source of truth

n8n workflow JSON 进入 Git；credential 由 n8n 目标实例重新建立。这样 workflow
可以审查和回滚，又不会把 n8n credential export 误当成安全配置。

## 2026-09-05：不自动推送

初始化只在本地执行 git init / git commit。除非用户单独授权，否则不添加
公网 remote、不 push，也不把备份归档放入仓库。

## 2026-09-05：WhatsApp 接入暂缓

Meta WhatsApp Cloud API 的商业版能力（如 webhook 批量验证、会话模板、
高并发消息队列）是接入稳定性与合规的必要前提。当前开源版限制与平台变更
频率较高，暂不继续投入实现和部署。

保留原因：
- 已完成的 Adapter、实验代码和 LangBot patch 作为 future integration reference
- Cloudflare Tunnel 配置保留，后续仍可用于 Webhook / HomeLab API
- 代码不影响 KOOK / Telegram runtime，相关导出和能力定义保持静态配置

恢复条件：
- 获得 WhatsApp Business API 商业版授权
- 明确所需的消息模板、会话状态和 webhook 验签能力
- 完成与现有 runtime 的集成测试和性能基准

恢复操作：
1. 重新评估 Meta Cloud API 最新能力与合规要求
2. 更新 docs/CURRENT_TASK.md 状态
3. 启用 apps/agent-runtime/src/platform/whatsapp 相关代码
4. 配置 Cloudflare Tunnel 和 LangBot webhook 集成
