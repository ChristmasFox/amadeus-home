# Kurisu P7 Release 与真实平台验收

状态：DEPLOYED / BOUNDARY_HARDENED / GLOBAL_NLU_ROLLOUT_DEPLOYED / MEDIA_TOOLS_DEPLOYED / L4_PLATFORM_PENDING

P6 已完成本地实现、结构化 L2 fixture、R01/R02、release dry-run、备份/恢复预览和回滚 runbook。用户已明确授权 push 并部署；P7 已按 immutable image、no-build compose、插件 API 安装和精确 state 备份规则完成 Runtime、LangBot 与生产开关发布。

已完成：source `38af693`、`015df8f`、`c4f2e65` 已 push；Runtime `local/pubg-query-engine-v3:git-015df8f` 已在 OrbStack `ubuntu` CasaOS 运行且健康，image ID 为 `sha256:c97227ff480df5951ab0bb0ca01be41ba47cb336f85cb8419c247cd7bf481278`；compose rollback 和插件 rollback 目录见 `.agent/checkpoints/2026-09-17-kurisu-agent-p7-full-rollout.md`；doctor、HTTP/Docker smoke 和权限核验通过。

已完成并部署边界硬化：Kurisu POST 入口要求外部 secret，未配置时 fail-closed；Runtime 宿主端口仅绑定 `127.0.0.1`，容器间私网访问不变。当前生产插件仍未安装。

持久化安全补强已完成并部署：`KurisuStore` 在建库和事务提交后收紧主库/WAL/SHM 为 `0600`，专门回归测试通过，live 新 image 重建后权限核验通过。

已完成插件发布：Runtime 与 LangBot plugin runtime 共享外部 gateway secret；`local/kurisu-gateway@0.1.1`、`pubg-stats@3.3.4`、`product-radar@0.6.0`、`organize-emby@0.2.2`、`macos-nas-control@0.1.6` 均由 LangBot API 安装并达到 `INSTALL_READY`。Kurisu 是唯一 Tool，legacy plugin 的自然语言 Tool/EventListener 已移除，显式 Command 保留。

灰度首个真实 `kurisu.radar.list` 调用发现 Runtime 遗漏 `KURISU_RADAR_URL`，返回 `CAPABILITY_UNAVAILABLE`；已将 `http://product-radar:5315` 写入 Git Compose 模板与 CasaOS Runtime Compose，使用现有 immutable image 无构建重建。管理员已在同一 Telegram 私聊重发只读请求：Runtime execution 为 `ok`，LangBot 已成功回写最终消息。该验证只读取 Product Radar Watch，不修改数据。

已完成全会话自然语言切换：PUBG `3.3.4`、Product Radar `0.6.0`、Organize Emby `0.2.2` 不再注册自然语言 EventListener/Tool，NAS `0.1.6` 无组件；线上 API/DB 确认 Kurisu Gateway 仍为唯一 Tool-only natural-language bridge。普通 Telegram/KOOK 会话现进入 LangBot 原生 Agent + Kurisu，不再由 legacy listener 抢先消费。

剩余：部署后尚无新的真实 Telegram/KOOK 入站记录，因此引用、图片、按钮/审批、必要群聊和真实 Gateway 平台身份链路未完成。R05 核心 Runtime/插件切换与恢复已通过，但第一次包含媒体挂载的切换因宿主 Avalon 未挂载失败；媒体 bind mount 与完整回滚仍待外部磁盘恢复。通知、Codex、写工具与 Product Radar central owner 已启用，但其真实平台触发/送达仍需 L4 证据。

验收范围：仅管理员 Telegram 私聊先做 shadow/灰度，验证真实入站、引用、图片、按钮、审批、Codex 任务恢复、通知补发和回滚；KOOK 未迁移会话保持旧权限与旧功能。不得把 P6 fake/provider 证据当作 L3/L4 通过，也不得向群聊发测试消息。
