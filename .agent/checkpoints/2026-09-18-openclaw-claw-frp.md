# OpenClaw public Control UI via FRP

日期：2026-09-18（Asia/Shanghai）

## 结果

- Cloudflare 代理域名：`claw.nyannyan.top`。
- VPS Caddy 新增 `claw.nyannyan.top` HTTPS 站点，反代到 `127.0.0.1:18789`。
- Caddy ACME HTTP-01 校验成功并取得有效证书；未写入 Cloudflare API token 或证书私钥到 Git。
- HomeLab `/DATA/AppData/frpc/frpc.toml` 新增无密钥模板对应的 `openclaw-tcp`：
  `127.0.0.1:18789` → VPS `18789`。
- VPS `/etc/frp/frps.toml` 允许端口加入 `18789`，`maxPortsPerClient` 从 9 调整为 10，
  以保留新增 OpenClaw 映射和原有 qBittorrent 映射。
- OpenClaw `gateway.controlUi.allowedOrigins` 增加
  `http://192.168.5.3:18789` 和 `https://claw.nyannyan.top`；反代来源加入
  `gateway.trustedProxies` 的 `127.0.0.1` 和实际 Docker 网桥 `172.24.0.1`。

## 验证

- `frps verify`：通过。
- `frpc verify`：通过；frps API 显示 10 个映射全部 `online`，包括 `openclaw-tcp` 和
  `qBittorrent-tcp`。
- OpenClaw `config validate --json`：`valid=true`，无 warning；容器 healthy。
- `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`：通过；Caddy active。
- `curl -I https://claw.nyannyan.top/healthz`：HTTP 200，响应经 Cloudflare/Caddy 回源。
- 公网证书链验证：Let's Encrypt，SAN 包含 `*.nyannyan.top`。

## 回滚

- VPS 变更前备份：`/var/backups/openclaw-claw-20260918-102140`。
- HomeLab 变更前备份：`/DATA/AppData/openclaw/backups/openclaw-claw-20260918-102138`。
- 仓库无真实 token、Cloudflare 凭据、frps token 或证书私钥。

## 源文件

- `infra/vps/frps.toml.example`
- `infra/vps/frpc/openclaw-proxy.example.toml`
- `infra/vps/web-openclaw.example.Caddyfile`
- `integrations/openclaw/openclaw.json.example`
