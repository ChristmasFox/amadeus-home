# Kurisu P7 Release 与真实平台验收

状态：PARTIAL_RUNTIME_DEPLOYED / BOUNDARY_HARDENED / PLUGIN_PENDING / PLATFORM_BLOCKED

P6 已完成本地实现、结构化 L2 fixture、R01/R02、release dry-run、备份/恢复预览和回滚 runbook。用户已明确授权 push 并部署；本次已按 immutable image、no-build compose 和精确 state 备份规则完成 Runtime 部分发布，但没有安装插件或切换 rollout。

已完成：source `5a015f1` push；Runtime `local/pubg-query-engine-v3:git-5a015f1b87c7` 已在 OrbStack `ubuntu` CasaOS 运行且健康；compose rollback `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260916-204409`；state archive `/Volumes/Avalon/backups/agent-monorepo/kurisu/20260916T124511Z/kurisu-state-20260916T124511Z.tar.gz`；doctor、HTTP endpoints 和权限核验通过。

已完成并部署边界硬化：Kurisu POST 入口要求外部 secret，未配置时 fail-closed；Runtime 宿主端口仅绑定 `127.0.0.1`，容器间私网访问不变。当前生产插件仍未安装。

持久化安全补强已完成源码实现：`KurisuStore` 在建库和事务提交后收紧主库/WAL/SHM 为 `0600`，并有专门回归测试；需随下一次 Runtime immutable image 发布。

剩余开始条件：在安装 `kurisu-gateway`/切换 session rollout 前，必须在合法流程中取得 LangBot user/support-admin session；配置 Runtime 与 LangBot plugin runtime 共享的外部 gateway secret；确认真实 briefing producer、旧 EventListener single-consumer 迁移范围、管理员 Telegram DM 测试对象和回滚 checkpoint。当前条件未齐，插件保持未安装。

验收范围：仅管理员 Telegram 私聊先做 shadow/灰度，验证真实入站、引用、图片、按钮、审批、Codex 任务恢复、通知补发和回滚；KOOK 未迁移会话保持旧权限与旧功能。不得把 P6 fake/provider 证据当作 L3/L4 通过，也不得向群聊发测试消息。
