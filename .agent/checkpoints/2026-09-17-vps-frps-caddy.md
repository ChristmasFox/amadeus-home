# VPS frps 与 Caddy HTTPS checkpoint

日期：2026-09-17（Asia/Shanghai）

## 已完成

- 通过既有 SSH alias `amadeus-gateway` 操作；未修改 SSH 登录方式、未关闭公钥认证、未修改
  防火墙、未重启 VPS。
- 从官方 frp GitHub Release 安装并校验 `frps 0.69.0`，与 HomeLab OrbStack 中现有 `frpc
  0.69.0` 匹配；未运行第三方一键安装脚本。
- `frps.service` 已 enable/active；frps 控制端口为 TCP `7000`，dashboard 仅监听
  `127.0.0.1:7500`。认证 token 独立保存在 VPS `/etc/frp/token`，未写入仓库。
- HomeLab `/DATA/AppData/frpc/frpc.toml` 的 `serverAddr` 已切换到声明式域名
  `sub.nyannyan.top`，原配置已在 OrbStack 外部保留 dated backup；9 个现有 TCP 映射均已
  注册到 frps。`glances` 的原始本地地址保持不变。
- 为给 Caddy 释放标准 HTTPS 端口，Xray 26.3.27 已从 TCP `443` 迁移到 TCP `2053`；
  `xray run -test` 通过，`xray.service` 已 enable/active 并监听 2053。
- Caddy 2.11.4 已 reload 并接管 TCP `443`；`emby.nyannyan.top` 反代到本机 frps
  Emby 映射端口 `127.0.0.1:8096`。Let’s Encrypt HTTP-01 验证、证书签发、证书域名匹配和
  公网 HTTPS `302` 回源测试均通过。
- QX 订阅的 `qx.conf` 与 `server.snippet` 已在 VPS 内同步更新为 Xray TCP `2053`，并同时
  通过 Caddy 标准 443 与兼容 8443 提供；真实
  订阅 token、UUID、Reality private key、frps token 和公网地址均未写入 checkpoint 或 Git。

## 当前端口

| 端口 | 用途 |
| ---: | --- |
| 22/TCP | SSH 运维 |
| 80/TCP | Caddy ACME HTTP-01 与 HTTPS 跳转 |
| 443/TCP | Caddy HTTPS 站点 |
| 2053/TCP | Xray VLESS + Reality + Vision |
| 7000/TCP | frps/frpc 控制通道 |
| 8443/TCP/UDP | Caddy QX 订阅 HTTPS 与 HTTP/3 |
| 8096、2283、6880、6800、20128、8080、8097、7575、61208/TCP | 现有 frpc 服务映射 |

## 可恢复信息

- Xray 配置备份保留在 VPS `/etc/xray/config.json.pre-caddy-*`；Caddy 迁移前配置也保留在
  VPS `/etc/caddy/Caddyfile.pre-emby-*`。
- frps 运行配置：`/etc/frp/frps.toml`；systemd unit：`/etc/systemd/system/frps.service`。
- 仓库无凭据模板：`infra/vps/frps.toml.example`、`infra/vps/systemd/frps.service.example`
  以及 `infra/vps/` 下的 Xray/Caddy 文档。

## 已知事项

- QX 需要刷新现有订阅或重新导入同一订阅地址，使客户端使用新的 `2053` 端口；最终 Reality
  握手仍需用户在手机端验证。
- 当前 frps 按既有 frpc 配置公开监听多个服务端口，其中包含 qBittorrent、aria2、9router
  等管理类服务；后续应按实际用途通过 frps `allowPorts`/防火墙/额外认证收紧暴露面。
