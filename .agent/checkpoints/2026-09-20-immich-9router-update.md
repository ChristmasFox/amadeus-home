# 2026-09-20 Immich 与 9router 更新检查点

## Scope

- 目标运行时：OrbStack Linux machine `ubuntu` 内的 CasaOS。
- 仅更新 `immich` 与 `9router`；未修改 Claw/OpenClaw、Caddy、frps、Cloudflare、SSH/防火墙或媒体文件。

## Live changes

- `/var/lib/casaos/apps/immich/docker-compose.yml`
  - `altran1502/immich-server:v2.5.3` → `altran1502/immich-server:v3.2.2`
  - `altran1502/immich-machine-learning:v2.5.3` → `altran1502/immich-machine-learning:v3.2.2`
  - `docker.io/tensorchord/pgvecto-rs:pg14-v0.2.0` → `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0`
  - 移除旧 `vectors.so` 启动参数和旧数据库 checksum healthcheck，加入 `shm_size: 128mb`。
- `/var/lib/casaos/apps/9router/docker-compose.yml`
  - `decolua/9router:latest` → `decolua/9router:0.5.75`
  - 端口 `20128`、数据 `/DATA/AppData/9router/data`、环境变量和 secret 未改动。

## Recovery

- Immich：`/DATA/AppData/immich/backups/pre-update-20260920T132238Z`
  - 包含更新前 compose、`immich.dump`、manifest 和 SHA-256 清单。
- 9router：`/DATA/AppData/9router/backups/pre-update-20260920T132238Z`
  - 包含更新前 compose、`data.tar.gz`、manifest 和 SHA-256 清单。
- 旧 9router 镜像：`decolua/9router:rollback-20260920T132238Z`。
- 回滚原则：先停止受影响 app，恢复对应 compose/数据备份；Immich 切换 VectorChord 后不回退到旧版本
  server，除非先按官方数据库恢复路径处理。

## Evidence

- 两套 compose：`docker compose config --quiet` 通过。
- Immich server、machine-learning、Postgres、Redis：`healthy`。
- Postgres 扩展包含 `vchord 0.4.3`、`vector 0.8.1`、`vectors 0.2.0`。
- `https://immich.nyannyan.top/api/server/ping`：HTTP 200，返回 `{"res":"pong"}`。
- `https://immich.nyannyan.top/`：HTTP 200。
- `https://9router.nyannyan.top/dashboard`：HTTP 200。
- `https://9router.nyannyan.top/v1/models` 无 API key：HTTP 401，鉴权边界保持。
- 更新后最近日志未出现 error/fatal/panic/exception/migration failed 信号。
