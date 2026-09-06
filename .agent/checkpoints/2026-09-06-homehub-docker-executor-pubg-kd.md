# HomeHub Docker Executor + PUBG KD checkpoint

日期：2026-09-06（Asia/Shanghai）

## 已完成

- `packages/homehub-domain/src/execution/runtime-executor.ts` 新增基于 Unix socket 的受限 Docker Engine API client。
- 精确容器 allowlist：langbot、pubg-query-engine-v3、n8n、postgres、redis、emby、jellyfin、qbittorrent、aria2、glances。
- 允许观察：bounded `ps`、脱敏 `inspect`、最多 200 行 `logs`、`stats`；允许变更：`start`、`restart`。
- 拒绝 Docker Compose、`exec`、`run`、`rm`、prune 与 arbitrary shell；LangBot component 不再转译为 `docker exec`。
- HomeHub HostCollector 改为 macOS host boundary；容器内没有 Mac host executor 时返回 UNKNOWN 和原因，不冒充 host 指标。
- runtime 新增 `GET /status`、`GET /homehub/status`；新增 `scripts/smoke-homehub-docker.sh` 和显式配置脚本 `scripts/deploy-homehub-docker-socket.sh`。
- runtime/infra compose 模板声明只读 Docker socket 和 socket group。
- PUBG n8n/runtime/renderer 修复零死亡 KD：补齐旧记录 placement proxy，KD 未定义显示 `—`，不再向用户渲染 `∞`。

## 验证

- `pnpm --filter @agent/homehub-domain build`：通过。
- `pnpm --filter @agent/agent-runtime typecheck`：通过。
- `pnpm test`：114 pass、1 skip。
- `pnpm check:secrets`：通过。
- `git diff --check`：通过。
- `scripts/smoke-homehub-docker.sh` 的生产验证尚未执行；需要先用显式 `--apply --build` 发布 source，并用显式 `--apply` 挂载 Docker socket。

## 恢复/部署

1. 保持工作树干净并运行 `./scripts/deploy-agent-runtime.sh --apply --build --no-proxy`。
2. 执行 `./scripts/deploy-homehub-docker-socket.sh --apply`；脚本会在 canonical compose 旁创建 rollback backup。
3. 运行 `./scripts/smoke-homehub-docker.sh`，记录 socket、allowlist client 和 `/status` 输出。
4. 若失败，恢复脚本打印的 `docker-compose.yml.codex-backup.<timestamp>`，执行 `docker compose up -d --no-build`。

## 生产部署验证（2026-09-06）

- image：`local/pubg-query-engine-v3:git-1a8a825812b6`。
- canonical compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`。
- rollback backup：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml.codex-backup.20260906-105507`。
- `pubg-query-engine-v3` 以 node + GID 104 访问只读 Docker socket；`test -S` 通过。
- `scripts/smoke-homehub-docker.sh` 通过：restricted Docker API 列出 7 个 allowlisted containers；`GET /status`
  返回 8 healthy、3 down（实际不存在的 postgres/redis/glances）、1 unhealthy（Jellyfin recent log error）
  和 1 unknown（macOS cloudflared），不是全量 UNKNOWN。
- Host CPU/Memory 保持 UNKNOWN，原因为 `macOS executor unavailable; HomeHub container metrics are not host metrics`。

## 未完成

- Codex Global Completion Notification Bridge 尚未实现。
