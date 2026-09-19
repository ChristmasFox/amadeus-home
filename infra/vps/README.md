# Amadeus Gateway VPS

本目录保存 `amadeus-gateway` VPS 的可迁移架构和运维模板。真实公网地址、SSH 私钥、
UUID、Reality 私钥和其他凭据只保留在运行环境，不进入 Git。

## 当前架构

- 目标主机：通过本机 SSH alias `amadeus-gateway` 连接。
- 代理：官方 Xray-core 稳定版二进制，VLESS + Reality + Vision，原生 systemd 管理。
- 当前服务：`xray.service`，监听 TCP `2053`；TCP `443` 由 Caddy 提供 HTTPS。
- 备用代理：官方 Hysteria 2 `v2.12.3` 二进制，原生 systemd 管理，监听 UDP `2053`；
  服务名为 `hysteria-server.service`，使用 `sub.nyannyan.top` 的 Caddy 证书。
- Reality 目标：`www.apple.com:443`；客户端 `serverName` 使用 `www.apple.com`。
- Caddy 由官方包提供 `caddy.service`，在 443 提供 HTTPS 站点、在 8443 提供订阅入口；本地
  `amadeus-gateway-subscription.service` 在 `127.0.0.1:8787` 返回原订阅正文、统一文件名
  `amadeus-gateway` 和整台 VPS 的 KiwiVM 流量响应头，不参与 Xray 代理流量。
- frps 使用与现有 frpc 匹配的官方 `0.69.0` 二进制，由 `frps.service` 管理。
- OpenClaw Control UI：HomeLab `frpc` 的 `openclaw-tcp` 映射把 `127.0.0.1:18789`
  送到 VPS 的 frps `18789`，Caddy 以 `claw.nyannyan.top` 终止 HTTPS 并反代到该本机端口；
  OpenClaw 的 `allowedOrigins` 同时允许该 HTTPS 来源。
- 本任务不启用 Docker、Nginx 或 Web 管理面板。
- 运行时配置：`/etc/xray/config.json`，权限应为 `root:xray`、`0640`。
- 工作目录：`/var/lib/xray`，权限应为 `xray:xray`、`0750`。
- frps 配置：`/etc/frp/frps.toml`；认证 token：`/etc/frp/token`，均只保留在 VPS。
- 订阅文件：`/var/lib/caddy/subscription/<token>/qx.conf`、`server.snippet`、`clash.yaml` 和
  `shadowrocket.txt`，由动态订阅响应器经 Caddy HTTPS 提供；四种格式共用 token，但正文不是
  同一份文本，下载响应名统一为 `amadeus-gateway`。
- OpenClaw VPS 只读探针：`/usr/local/sbin/amadeus-vps-readonly-probe`，由专用
  `amadeus-vps-readonly` SSH 用户的 forced-command key 调用；它只输出固定的 uptime/load/memory/
  rootfs 和四个 systemd unit 状态。账号无密码，authorized key 禁用交互命令、端口转发、agent
  forwarding、X11 和 pty。
- Emby 回源：Caddy `emby.<domain>:443` → frps 本机 `127.0.0.1:8096` → HomeLab Emby。

端口用途：

| 端口 | 协议 | 用途 | 备注 |
| ---: | --- | --- | --- |
| 22 | TCP | SSH 运维 | 任何防火墙变更前必须确认仍放行 |
| 443 | TCP | Caddy HTTPS 站点（例如 Emby） | Let’s Encrypt 自动证书；不承载 Xray |
| 2053 | TCP | 个人 VLESS + Reality | QX 节点端口；非标准端口 |
| 2053 | UDP | 个人 Hysteria 2 | Clash Meta/Mihomo、Shadowrocket 节点端口；与 TCP 2053 不冲突 |
| 7000 | TCP | frps 控制通道 | 仅供 HomeLab frpc 连接 |
| 8096/2283/6880/6800/20128/8080/8097/7575/61208 | TCP | frps 映射的 HomeLab 服务 | 当前按现有 frpc 配置公开监听；管理类端口应按需收紧 |
| 80 | TCP | Caddy ACME HTTP-01 / HTTPS 跳转 | 不承载代理流量 |
| 8443 | TCP/UDP | Caddy HTTPS 订阅入口 | UDP 为 Caddy 默认 HTTP/3；只提供订阅文件 |
| 18789 | TCP | OpenClaw frp 回源端口 | 由 Caddy 的 `claw.nyannyan.top` 使用；OpenClaw 仍要求 gateway token |

## 安装与升级原则

1. 从 [XTLS/Xray-core Releases](https://github.com/XTLS/Xray-core/releases) 选择稳定版，下载官方 `Xray-linux-64.zip` 和对应 `.dgst` 文件。
2. 用发布页提供的 SHA-512 值校验压缩包后，再安装 `/usr/local/bin/xray`。
3. 使用 `proxy/config.example.json` 生成运行配置；真实 UUID 和 Reality 私钥只在 VPS 上生成和保存。
4. 使用 `systemd/xray.service.example` 作为 Xray unit 模板；订阅入口按 `subscription/README.md` 使用官方 Caddy 包和 `caddy.service`。
5. 替换配置前先执行 `xray run -test -config <candidate.json>` 或 `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`；通过后再原子替换、reload/restart 对应服务。

### OpenClaw 只读探针

将仓库的 `amadeus-vps-readonly-probe.sh` 安装为 root 拥有的
`/usr/local/sbin/amadeus-vps-readonly-probe`（`0755`），再为 OpenClaw 单独创建无密码、仅由
forced command 限制的 `amadeus-vps-readonly` 用户。把专用公钥写入该用户的 `authorized_keys`，
并在同一行加入：

```text
command="/usr/local/sbin/amadeus-vps-readonly-probe",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc
```

OpenClaw 容器只挂载对应私钥和严格的 known-hosts 文件。不要复用 root 运维私钥，也不要把
`SSH_ORIGINAL_COMMAND` 传给 shell；工具只调用固定 probe 路径。

### Hysteria 2

HY2 使用官方 GitHub Release `v2.12.3` 的 `hysteria-linux-amd64`，下载后用同一 Release 的
`hashes.txt` 校验 SHA-256，不运行第三方一键脚本。运行文件和配置如下：

```text
/usr/local/bin/hysteria
/etc/hysteria/config.yaml
/etc/systemd/system/hysteria-server.service
```

服务复用 Caddy 为 `sub.nyannyan.top` 管理的公开证书；Hysteria 配置只引用证书路径，认证密码
仍保存在 VPS 的 `/etc/hysteria/config.yaml`，不写入 Git。升级或变更时先备份配置，然后执行：

```sh
ssh amadeus-gateway '/usr/local/bin/hysteria version'
ssh amadeus-gateway 'systemctl daemon-reload && systemctl restart hysteria-server.service'
ssh amadeus-gateway 'systemctl is-enabled hysteria-server.service && systemctl is-active hysteria-server.service'
ssh amadeus-gateway 'ss -lunp | grep ":2053 "'
```

Clash/Mihomo 使用 `clash.yaml`，Shadowrocket 使用 `shadowrocket.txt`；Quantumult X 当前
继续使用 `server.snippet` 中的 VLESS Reality，不能把 HY2 行直接塞进 QX 配置。

### frps

当前 frpc 为 `0.69.0`，VPS 使用同版本的官方 GitHub Release 压缩包，下载后校验官方 SHA-256，
不运行第三方安装脚本。安装文件和运行配置如下：

```text
/usr/local/bin/frps
/etc/frp/frps.toml
/etc/frp/token
/etc/systemd/system/frps.service
```

`frps.toml` 使用文件型 token source，dashboard 只监听 `127.0.0.1:7500`，并通过
`allowPorts` 限制到当前已声明的映射端口。安装或升级时先执行：

```sh
ssh amadeus-gateway '/usr/local/bin/frps verify -c /etc/frp/frps.toml'
ssh amadeus-gateway 'systemctl daemon-reload && systemctl restart frps.service'
ssh amadeus-gateway 'systemctl is-enabled frps.service && systemctl is-active frps.service'
```

### Caddy HTTPS

Caddy 在 `emby.<domain>` 站点中反代到 VPS 本机的 frps Emby 端口。DNS 记录必须指向 VPS，
TCP 80/443 必须可达；Caddy 会通过 ACME HTTP-01 自动申请和续期证书。不要把 Cloudflare
API token、Origin Certificate 私钥或填充后的 Caddyfile 写入仓库。

禁止使用来源不明的 `curl | bash` 一键脚本。升级时保留旧二进制和配置备份，确认新版本
通过配置测试、服务状态和端口检查后再清理旧文件。不要把运行配置、备份或客户端订阅
内容复制到仓库。

常用检查命令：

```sh
ssh amadeus-gateway 'systemctl status xray.service --no-pager -l'
ssh amadeus-gateway 'systemctl is-enabled xray.service && systemctl is-active xray.service'
ssh amadeus-gateway 'journalctl -u xray.service -n 100 --no-pager'
ssh amadeus-gateway 'systemctl status caddy.service --no-pager -l'
ssh amadeus-gateway 'journalctl -u caddy.service -n 100 --no-pager'
ssh amadeus-gateway 'systemctl status frps.service --no-pager -l'
ssh amadeus-gateway 'journalctl -u frps.service -n 100 --no-pager'
ssh amadeus-gateway 'systemctl status hysteria-server.service --no-pager -l'
ssh amadeus-gateway 'journalctl -u hysteria-server.service -n 100 --no-pager'
ssh amadeus-gateway 'ss -lntup | grep -E ":(22|80|443|2053|7000|8443|8096|2283|6880|6800|20128|8080|8097|7575|61208) "'
ssh amadeus-gateway 'ss -lunp | grep ":2053 "'
ssh amadeus-gateway '/usr/local/bin/xray run -test -config /etc/xray/config.json'
ssh amadeus-gateway '/usr/local/bin/frps verify -c /etc/frp/frps.toml'
```

## 卸载

卸载前先导出必要的非敏感运行记录，并确认没有其他服务依赖 `xray` 用户或 443 端口。
只操作下列明确目标，不要使用指向工作区或根目录的递归删除：

```sh
ssh amadeus-gateway 'systemctl disable --now xray.service'
ssh amadeus-gateway 'rm -f /etc/systemd/system/xray.service /usr/local/bin/xray'
ssh amadeus-gateway 'systemctl daemon-reload'
```

确认不再需要运行配置和数据后，才可由管理员单独删除 `/etc/xray`、`/var/lib/xray` 以及
专用的 `xray` 用户/组。卸载过程不应修改 SSH 登录方式或重启 VPS。

frps 卸载只操作明确的 frps 文件，不删除 HomeLab 的 frpc 配置或代理数据：

```sh
ssh amadeus-gateway 'systemctl disable --now frps.service'
ssh amadeus-gateway 'rm -f /etc/systemd/system/frps.service /usr/local/bin/frps'
ssh amadeus-gateway 'systemctl daemon-reload'
```

确认不再需要 token 和配置后，才可由管理员单独删除 `/etc/frp`、`/var/lib/frps` 以及专用
`frps` 用户/组。卸载过程不应修改 SSH 登录方式或重启 VPS。

HY2 卸载只操作明确的服务和文件，不删除 Caddy 证书或其他订阅：

```sh
ssh amadeus-gateway 'systemctl disable --now hysteria-server.service'
ssh amadeus-gateway 'rm -f /etc/systemd/system/hysteria-server.service /usr/local/bin/hysteria /etc/hysteria/config.yaml'
ssh amadeus-gateway 'systemctl daemon-reload'
```

确认不再需要 HY2 订阅后，再删除对应 token 目录中的 `clash.yaml` 和 `shadowrocket.txt`。

订阅入口单独卸载时，先确认不再需要该 URL，再执行 `systemctl disable --now caddy.service`，
备份后删除 `/etc/caddy/Caddyfile` 和 `/var/lib/caddy/subscription` 中的明确目标；不要删除
Caddy 自动维护的其他数据，除非确认没有其他站点依赖。

## 故障排查

- `xray run -test` 失败：先检查 JSON 格式、Reality 私钥是否只存在于 VPS、`serverNames` 是否与客户端一致，再查看 journal。
- Xray 无法启动：确认 2053 没有被其他进程占用；443 应由 Caddy 监听。非标准端口可能受到网络环境限制。
- frps inactive：检查 `frps verify`、`systemctl status frps` 和 `journalctl -u frps`，确认 token 文件为 `root:frps`、`0640`，并与 frpc 的 token 相同。
- frpc login 失败：确认 HomeLab frpc 的 `serverAddr` 指向 `sub.nyannyan.top`、`serverPort=7000`，再从 VPS 查看 frps 的 login 日志；不要把 token 打印到终端。
- Emby HTTPS 失败：确认 Caddy 已监听 443、`emby.<domain>` DNS 指向 VPS、80 的 ACME HTTP-01 可达，并检查 Caddy journal 的证书记录。
- 订阅 URL 返回 404：检查 Caddyfile 中的 token 路径与 `/var/lib/caddy/subscription/<token>/qx.conf`
  是否一致，再执行 `caddy validate` 和 `systemctl reload caddy`。
- 订阅 URL TLS 失败：确认 DNS 记录仍解析到 VPS、80/8443 可达，并查看 Caddy journal 中的 ACME
  续期状态；不要把 Cloudflare 代理开关变更和服务配置混在一起操作。
- HY2 客户端超时：确认 `sub.nyannyan.top` 为 Cloudflare DNS only（灰云），因为普通 Cloudflare
  代理不转发这个 UDP 端口；再检查 `hysteria-server.service`、证书 SNI 和密码是否一致。
- HY2 证书错误：确认 Caddy 证书仍包含 `sub.nyannyan.top`，并检查 Hysteria 配置引用的
  Caddy 证书路径和服务用户 `caddy` 的读取权限。
- 客户端超时：先从本机验证 SSH alias 指向的主机 TCP 2053，再检查 VPS 上的监听和上游 Reality 目标；不要先改 SSH 或重启 VPS。
- 防火墙：当前代理部署不要求新增规则。未来启用 UFW/nftables 时，必须先明确放行当前 SSH 端口 22，再放行代理端口，并用新的 SSH 会话验证。
- 当前系统曾存在 `networking.service` 对不存在 `eth1` 的遗留引用。该问题不影响当前实际 `eth0` 默认路由，但修复网络接口配置可能导致失联，未经确认不得自动修改。

## 安全边界

SSH 公钥认证是运维生命线。此目录不保存 SSH 私钥、公网 IP、密码、API key、UUID、
Reality private key、frps token 或其他真实 secret；也不包含从 VPS 导出的完整配置文件。
