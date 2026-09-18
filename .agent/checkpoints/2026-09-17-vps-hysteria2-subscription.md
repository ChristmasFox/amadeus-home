# VPS Hysteria 2 and format-specific subscriptions checkpoint

日期：2026-09-17（Asia/Shanghai）

## 已完成

- 通过 `ssh amadeus-gateway` 在 Ubuntu VPS 安装官方 Hysteria 2 `v2.12.3` amd64 release binary，并用官方 `hashes.txt` 校验 SHA-256。
- 创建 `hysteria-server.service`，以 `caddy:caddy` 低权限运行，监听 UDP `2053`；现有 Xray 继续监听 TCP `2053`，没有端口冲突。
- HY2 使用 `sub.nyannyan.top` 现有 Caddy/Let’s Encrypt 证书，认证密码只存在 VPS 的 `/etc/hysteria/config.yaml`。
- 扩展现有 Caddy 精确 token 路径，新增 `clash.yaml` 和 `shadowrocket.txt`；原有 `qx.conf`/`server.snippet` 保持 QX VLESS Reality。
- Clash/Mihomo 和 Shadowrocket 订阅端点从 VPS 返回 HTTP 200；Mac 官方 Hysteria 客户端完成 UDP/QUIC 握手，并通过 SOCKS5 访问网页返回 HTTP 200。
- VPS 服务、订阅和端口检查通过：Caddy active、HY2 active/enabled、UDP `2053` 监听，HY2 内存约 6.4 MiB（以 systemd MemoryCurrent 为准）。

## 兼容性决策

- HY2 适用于 Clash Meta/Mihomo 和 Shadowrocket。
- Quantumult X 当前官方 sample 没有 Hysteria 2 节点语法，QX 继续使用 VLESS Reality；不能把 HY2 直接写成 QX 的 VLESS 行。
- 采用同一 bearer token 下的多个格式文件，而不是让一份正文猜测客户端 User-Agent。

## 恢复信息

- 本次 VPS 配置备份保存在 VPS 外部的 `/root/vps-backups/hysteria-<timestamp>/`，未复制到 Git。
- 回滚时先恢复 Caddyfile 并 `caddy validate`，再 reload Caddy；HY2 可单独 `systemctl disable --now hysteria-server.service`。
- 没有修改 SSH 登录方式、防火墙或 VPS 电源状态；没有重启 VPS。

## Secrets 检查

- Git 只保存架构、模板、systemd unit 和故障排查说明；真实 token、HY2 密码、证书私钥、公网 IP 和其他凭据均不入库。
