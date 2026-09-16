# Kurisu P7：全会话自然语言 Rollout

- 日期：2026-09-16（Asia/Shanghai）
- 授权：用户明确要求所有会话的普通自然语言统一走 Kurisu。
- 源码：`e5573b9` 将 `pubg-stats-v3` 升至 `3.3.3`、`product-radar` 升至 `0.6.0`，移除两个 manifest 的 `EventListener` 注册；保留 `Command`/确定性 `Tool`，不破坏显式协议入口。
- 防回退：新增 `scripts/verify-kurisu-global-rollout.mjs`，断言两个 legacy manifest 无 `EventListener`、保留 Command，且 `kurisu-gateway` 只含 Tool。
- 本地验证：PUBG plugin `16/16`、Product Radar plugin `39/39`、`KURISU_GLOBAL_ROLLOUT_PASS`、R01、plugin package dry-run、secret scan、diff check 均通过。
- 部署：LangBot task `18` 安装 `local/pubg-stats@3.3.3`，task `19` 安装 `local/product-radar@0.6.0`，均为 `INSTALL_READY`；随后 `docker compose up -d --force-recreate langbot_plugin_runtime`。LangBot 主服务未重启。
- live 核验：API manifest 显示 `pubg-stats eventListener=false command=true tool=true`、`product-radar eventListener=false command=true tool=false`、`kurisu-gateway eventListener=false tool=true`；doctor `0 failure(s), 0 warning(s)`。
- 回滚：插件包备份 `.backups/langbot/20260916-223517/`；Compose gateway-secret 备份 `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260916-213512`。恢复时重装对应旧插件包并重建 plugin runtime。
- 边界：只证明自然语言抢先监听已移除与 Telegram 私聊只读 Tool 链路可用；KOOK/群聊/媒体、按钮、审批、写工具、通知、Codex、briefing producer 与完整回滚演练仍需独立验收。
