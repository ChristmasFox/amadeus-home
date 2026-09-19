# VPS Caddy 多服务公网 525 修复 checkpoint

日期：2026-09-20（Asia/Shanghai）

## 根因

Cloudflare DNS 已解析到 `amadeus-gateway`，frps/frpc 映射和 HomeLab 回源服务均正常；VPS
生效的 `/etc/caddy/Caddyfile` 只配置了 `sub`、`emby`、`claw` 和本轮先补的 `immich`，
因此缺少站点证书和路由的域名在 Cloudflare 端表现为 `525`。

## 当前路由

| 域名 | VPS Caddy upstream | HomeLab 服务 |
| --- | --- | --- |
| `emby.nyannyan.top` | `127.0.0.1:8096` | Emby |
| `immich.nyannyan.top` | `127.0.0.1:2283` | Immich |
| `jellyfin.nyannyan.top` | `127.0.0.1:8097` | Jellyfin |
| `aria.nyannyan.top` | `127.0.0.1:6880` | AriaNG |
| `qb.nyannyan.top` | `127.0.0.1:8080` | qBittorrent WebUI |
| `monitor.nyannyan.top` | `127.0.0.1:61208` | Glances |
| `9router.nyannyan.top` | `127.0.0.1:20128` | 9Router；`/v1/models` 无 key 返回 `401` |
| `claw.nyannyan.top` | `127.0.0.1:18789` | OpenClaw；本轮未修改 |

## 变更与回滚

- 仓库模板：`infra/vps/subscription/Caddyfile.example` 增加上述 Immich 及其他明确站点路由。
- VPS live：先备份，再追加 Caddy site，`caddy validate` 通过后执行 `systemctl reload caddy`。
- 回滚副本：`/etc/caddy/backups/Caddyfile.pre-public-services-20260919T161251Z`。
- 未修改 frps/frpc、Cloudflare DNS、SSH、firewall、OpenClaw 或 HomeLab 容器。

## 验收

- `frps.service` active，端口 `7000` 控制通道和 `2283` 等映射正常。
- Immich 本地与公网 `/api/server/ping`：HTTP 200，`{"res":"pong"}`。
- 公网：Jellyfin `302`、AriaNG `200`、qBittorrent `200`、Glances `200`、9Router `/` `307`。
- Let’s Encrypt 为新增域名签发成功；所有本轮目标域名不再返回 Cloudflare `525`。
- Immich PostgreSQL 容器仍显示既有 healthcheck `unhealthy`，但 Immich server 为 healthy 且
  应用 ping 通过；该数据库健康检查未在本轮改动。
