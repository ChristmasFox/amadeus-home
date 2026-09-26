# 2026-09-26：nyannyan.top 公网 502 恢复

## 诊断

- HomeLab `nyannyan` 上的 CasaOS 服务本地健康：OpenClaw `:18789/healthz=200`、Product Radar `:5315/health=200`，容器均 running/healthy。
- frpc 进程仍在，但 systemd 日志持续出现 `StartWorkConn contains error: invalid NewWorkConn`；表现为 VPS Caddy/frps 的部分回源工作连接失效，导致公网域名间歇 502。
- 未修改 SSH、防火墙、域名、Caddy 配置或任何 secret；未重建业务容器。

## 修复

执行了可恢复的应用级操作：

```sh
orb -m nyannyan -u root systemctl restart frpc
```

frpc 重新登录 `sub.nyannyan.top:7000` 成功，并重新注册 8 个既有映射：
`aria2rpc-tcp`、`ariang-tcp`、`emby-tcp`、`glances-tcp`、`immich-tcp`、`jellyfin-tcp`、`openclaw-tcp`、`qBittorrent-tcp`。

## 真实公网验收（2026-09-26）

直连公网、绕过本机代理：

- `claw.nyannyan.top`：403（OpenClaw gateway token 保护，预期）
- `immich.nyannyan.top`：200
- `emby.nyannyan.top`：302
- `jellyfin.nyannyan.top`：302
- `aria.nyannyan.top`：200
- `qb.nyannyan.top`：200
- `monitor.nyannyan.top`：200
- frpc restart 后 5 分钟日志无新的 `error/fail/invalid`。

`9router.nyannyan.top` 仍不是已启用公网服务：没有 DNS/frpc 映射，9Router 只作为 OpenClaw 本机依赖。
