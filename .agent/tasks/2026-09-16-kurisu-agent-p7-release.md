# Kurisu P7 Release 与真实平台验收

状态：RUNTIME_DEPLOYED / BOUNDARY_HARDENED / GLOBAL_NLU_ROLLOUT_DEPLOYED / CROSS_PLATFORM_SMOKE_PENDING

P6 已完成本地实现、结构化 L2 fixture、R01/R02、release dry-run、备份/恢复预览和回滚 runbook。用户已明确授权 push 并部署；本次已按 immutable image、no-build compose 和精确 state 备份规则完成 Runtime 部分发布，但没有安装插件或切换 rollout。

已完成：source `5a015f1` push；Runtime `local/pubg-query-engine-v3:git-5a015f1b87c7` 已在 OrbStack `ubuntu` CasaOS 运行且健康；compose rollback `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260916-204409`；state archive `/Volumes/Avalon/backups/agent-monorepo/kurisu/20260916T124511Z/kurisu-state-20260916T124511Z.tar.gz`；doctor、HTTP endpoints 和权限核验通过。

已完成并部署边界硬化：Kurisu POST 入口要求外部 secret，未配置时 fail-closed；Runtime 宿主端口仅绑定 `127.0.0.1`，容器间私网访问不变。当前生产插件仍未安装。

持久化安全补强已完成并部署：`KurisuStore` 在建库和事务提交后收紧主库/WAL/SHM 为 `0600`，专门回归测试通过，live 新 image 重建后权限核验通过。

已完成插件安装前置条件：管理员已在专用 Telegram 私聊发送灰度消息；Runtime 与 LangBot plugin runtime 共享外部 gateway secret；`local/kurisu-gateway@0.1.0` 已由 LangBot task `12` 安装并达到 `INSTALL_READY`。当前仍只允许该私聊进行真实 Tool 调用灰度，不能扩大 session rollout。

灰度首个真实 `kurisu.radar.list` 调用发现 Runtime 遗漏 `KURISU_RADAR_URL`，返回 `CAPABILITY_UNAVAILABLE`；已将 `http://product-radar:5315` 写入 Git Compose 模板与 CasaOS Runtime Compose，使用现有 immutable image 无构建重建。管理员已在同一 Telegram 私聊重发只读请求：Runtime execution 为 `ok`，LangBot 已成功回写最终消息。该验证只读取 Product Radar Watch，不修改数据。

已完成全会话自然语言切换：PUBG `3.3.3` 与 Product Radar `0.6.0` 取消 `EventListener` 注册，保留确定性协议命令/工具；安装后已强制重建 plugin runtime。线上 API 登记确认两个 legacy plugin 均为 `eventListener=false`，Kurisu Gateway 仍为唯一 Tool-only natural-language bridge。普通 Telegram/KOOK 会话现进入 LangBot 原生 Agent + Kurisu，不再由 legacy listener 抢先消费。

剩余：Telegram 私聊只读链路已通过；KOOK、群聊、媒体/按钮/审批等跨平台 smoke、真实 briefing producer、写工具/通知/Codex 灰度和完整平台回滚演练尚未完成。通知、Codex、写工具及 Product Radar central owner 继续关闭。

验收范围：仅管理员 Telegram 私聊先做 shadow/灰度，验证真实入站、引用、图片、按钮、审批、Codex 任务恢复、通知补发和回滚；KOOK 未迁移会话保持旧权限与旧功能。不得把 P6 fake/provider 证据当作 L3/L4 通过，也不得向群聊发测试消息。
