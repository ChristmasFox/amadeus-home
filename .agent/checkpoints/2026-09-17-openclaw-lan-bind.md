# OpenClaw LAN bind checkpoint

日期：2026-09-17（Asia/Shanghai）

## 变更

- 按用户明确要求，将 `infra/docker/casaos/openclaw/docker-compose.example.yml` 的
  `OPENCLAW_BIND_ADDRESS` 默认值从 `127.0.0.1` 改为 `0.0.0.0`。
- 同步更新 canonical CasaOS compose：
  `/var/lib/casaos/apps/openclaw/docker-compose.yml`。
- 使用 `docker compose up -d --no-build` 重建，没有重新构建镜像。

## 验证

- `docker port openclaw`：`18789/tcp -> 0.0.0.0:18789`。
- `ss -ltnp`：`0.0.0.0:18789` 正在监听。
- 容器 health：`healthy`。
- 从宿主机请求 `http://192.168.5.3:18789/healthz`：HTTP `200`。
- gateway token 仍由外部 `/DATA/AppData/openclaw/openclaw.env` 保存；未打印、未写入 Git。

## 恢复

变更前 compose 备份：
`/DATA/AppData/openclaw/backups/openclaw-bind-20260917-100930/docker-compose.yml`
