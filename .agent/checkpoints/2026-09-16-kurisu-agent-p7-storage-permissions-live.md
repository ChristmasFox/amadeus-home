# Kurisu P7：SQLite 权限补强 live 发布

- 日期：2026-09-16（Asia/Shanghai）
- Git/image：`3e00275` 已 push；`local/pubg-query-engine-v3:git-3e00275d8e70` 已加载并部署到 OrbStack `ubuntu` CasaOS。
- Compose rollback：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260916-210824`。
- live 验证：Runtime `running/healthy`；`5310` 宿主绑定为 `127.0.0.1`；无/错误 gateway header 返回 `401`；正确 secret 可进入应用层；Kurisu 主库/WAL/SHM 全部为 `0600`；外部 gateway secret 为 `root:docker 0640`。
- 范围：只重建 Runtime；LangBot/n8n 未重启，Kurisu 插件未安装，session rollout/通知/Codex/写工具未启用，未发送平台消息。
- 后续：在合法 native-agent session、single-consumer 迁移范围和管理员 Telegram DM 灰度对象明确前，继续保持插件未安装。
