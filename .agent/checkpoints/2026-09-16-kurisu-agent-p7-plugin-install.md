# Kurisu P7：LangBot plugin 安装与灰度前检查

- 日期：2026-09-16（Asia/Shanghai）
- Git：`96864d9`，安装前工作区 clean；`pnpm check:secrets` 通过。
- 灰度对象：管理员已在专用 Telegram 私聊发送消息并获得既有 LangBot 正常回复；不记录用户标识或消息正文。
- 外部配置：`langbot_plugin_runtime` 已挂载仓库外 `/DATA/AppData/pubg-query-engine-v3/secrets/kurisu-gateway-secret` 至 `/run/secrets/kurisu_gateway_secret`，`KURISU_GATEWAY_SECRET_FILE` 已配置且文件可读。
- 可恢复变更：LangBot Compose 备份为 `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260916-213512`；只重建 `langbot_plugin_runtime`，LangBot 主服务未重启。
- 安装：`scripts/deploy-langbot.sh --apply --plugin kurisu-gateway --api-key-file <external>`；LangBot task `12`，`local/kurisu-gateway@0.1.0` 在 3 秒内 `INSTALL_READY`。
- 验证：插件 API 可见 `kurisu-gateway`；plugin runtime running 且 secret 可读；Runtime `/healthz` 和 `/kurisu/status` 通过；`scripts/doctor.sh` 为 `0 failure(s), 0 warning(s)`。
- 下一步：管理员在同一 Telegram 私聊发送明确需要工具的只读请求，记录真实 Tool 调用与回复；不得向群聊发送测试消息，不启用通知/Codex/写工具，不迁移其他会话。
