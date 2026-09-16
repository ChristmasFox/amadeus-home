# Kurisu P7：POST 边界硬化 live 发布

- 日期：2026-09-16（Asia/Shanghai）
- Git：`60528e9` 已 push；immutable image 为 `local/pubg-query-engine-v3:git-60528e9c6d8f`。
- 目标：关闭 Runtime Kurisu POST 入口的未认证调用，并减少宿主端口暴露面；不安装插件、不切换 rollout、不发送平台消息。
- live 变更：OrbStack `ubuntu` CasaOS `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml` 现将 `5310` 绑定到 `127.0.0.1`；`/run/secrets/kurisu_gateway_secret` 使用仓库外 `/DATA/AppData/pubg-query-engine-v3/secrets/kurisu-gateway-secret`，权限 `root:docker 0640`。
- live 验证：Runtime `running/healthy`；`/healthz` 通过；无 header 的 `/kurisu/tool-call` 返回 `401`；正确 secret 可进入 Runtime 应用层；Kurisu state 主库/WAL/SHM 仍为 `0600`。
- 回滚：本次 Compose 变更前备份为 `/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260916-210205`；前一 immutable image 回滚记录见 `.agent/checkpoints/2026-09-16-kurisu-agent-p7-runtime-deployment.md`。保留 `127.0.0.1` 绑定，不恢复未认证的全接口暴露。
- 后续：同一外部 secret 还需挂载到 LangBot plugin runtime，取得合法 user/support-admin session 后才能安装 `kurisu-gateway` 和做管理员 Telegram DM 灰度。
