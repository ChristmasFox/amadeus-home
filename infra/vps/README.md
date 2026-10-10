# VPS reference topology (sanitized)

> Community reference only. Hostnames and account names are examples; do not copy this historical operator runbook as a live deploy configuration. Real endpoint/account material belongs in ignored files on the operator's host.

本目录保存 `amadeus-gateway` VPS 的可迁移架构和运维模板。真实公网地址、SSH 私钥、
UUID、Reality 私钥和其他凭据只保留在运行环境，不进入 Git。

## 当前架构

- 目标主机：通过本机 SSH alias `amadeus-gateway` 连接。
- 代理：官方 Xray-core 稳定版二进制，VLESS + Reality + Vision，原生 systemd 管理。
- 当前服务：`xray.service`，监听 TCP `2053`；TCP `443` 由 Caddy 提供 HTTPS。
- 备用代理：官方 Hysteria 2 `v2.12.3` 二进制，原生 systemd 管理，监听 UDP `2053`；
  服务名为 `hysteria-server.service`，使用 `sub.example.com` 的 Caddy 证书。
- Reality 目标：`www.apple.com:443`；客户端 `serverName` 使用 `www.apple.com`。
- Caddy 由官方包提供 `caddy.service`，在 443 提供 HTTPS 站点、在 8443 提供订阅入口；本地
  `amadeus-gateway-subscription.service` 在 `127.0.0.1:8787` 返回原订阅正文、统一文件名
  `amadeus-gateway` 和整台 VPS 的 KiwiVM 流量响应头，不参与 Xray 代理流量。
- frps 使用与现有 frpc 匹配的官方 `0.69.0` 二进制，由 `frps.service` 管理。
- OpenClaw Control UI：HomeLab `frpc` 的 `openclaw-tcp` 映射把 `127.0.0.1:18789`
  送到 VPS 的 frps `18789`，Caddy 以 `claw.example.com` 终止 HTTPS 并反代到该本机端口；
  OpenClaw 的 `allowedOrigins` 同时允许该 HTTPS 来源。
- HomeLab public services：Caddy 通过 frps 回源到 `immich.example.com`（2283）、
  `jellyfin.example.com`（8097）、`aria.example.com`（6880）、`qb.example.com`（8080）和
  `9router.example.com`（20128）。
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
- 临时 Qwen-Audio voice enrollment：使用 `infra/vps/frpc/audio-sample-proxy.example.toml` 和
  `infra/vps/audio-sample.example.Caddyfile` 发布 `audio.example.com/reference.wav`；只在复刻
  apply 期间启用，成功后删除 frpc 映射、Caddy site 和 Cloudflare DNS 记录。
- Qwen Image Lab：只反代 UI `image.example.com` → frps 本机 TCP `18798` → HomeLab frpc →
  Mac UI `192.168.5.3:18798`。模板为 `infra/vps/frpc/qwen-image-lab-proxy.example.toml`、
  `infra/vps/image-lab.example.Caddyfile` 和 `infra/vps/frps.toml.example`。Mac 地址最近已从
  HomeLab guest 验证可达；它依赖 LAN 地址分配，apply 前必须复核。Qwen bridge/engine 的
  `18793/18795` 仍只监听 Mac loopback，不得加入 frpc 或公开监听。
- Image Lab 的 VPS TCP `18798` 需要 Caddy 回源，因此 IPv4/IPv6 INPUT 均采用
  `infra/vps/qwen-image-public-input.rules` 中唯一的非 loopback 丢弃规则；持久化由已启用的
  `netfilter-persistent` 管理。这样 Caddy 可连 `127.0.0.1:18798`，公网不能绕过 TLS 直连。
  apply 后必须从新 SSH 会话复核 SSH 可达性，并确认持久化规则可恢复。

### Daily traffic fuse（source only; no live `tc` apply）

`traffic-fuse/traffic_fuse.py` 是当前 Goal 的确定性 Phase 1 实现：它按
`Asia/Shanghai` 日历日保存 provider 增量、可校准的 WAN 快速保护计数、覆盖状态、SQLite
事件键和脱敏 public snapshot。阈值使用十进制 40,000,000,000 / 50,000,000,000 bytes，
业务出口目标为共享 2,000,000 bit/s。provider 计数重置、WAN counter/interface/generation
变化和不完整首日都会标记 `partial_coverage`，不会把未知数据当作零。

`traffic-fuse/tc_helper.py` 只接受固定配置中的 `status|apply|release`，发现非本 fuse
拥有的 root qdisc 时拒绝覆盖或删除；它不会接受 OpenClaw 传入的接口、rate、handle 或
任意 shell，并为固定 SSH 端口同时保留 IPv4/IPv6 回程例外。`traffic-fuse.json.example`
仍是模板，必须先完成 Phase 0 的真实默认路由、
qdisc、SSH 恢复和 provider scope 审计，才能在 VPS 外部生成运行配置。

`public-snapshot.json` 应由 root 写入、`0640`，并由现有固定 probe 组
`amadeus-accounting-snapshot` 读取；probe 仍只读取该固定文件，不读取 traffic-fuse SQLite
或任何 provider/account credential。安装时必须确认 probe 用户属于该组，不能把整个
`/var/lib/amadeus-traffic-fuse` 暴露给 Caddy/frps 用户。

systemd 模板 `systemd/amadeus-vps-traffic-fuse*.example` 包含 10 秒观测 tick、独立的
`Persistent=true` 上海午夜 release timer，以及必须在未来受控 apply 前显式 arm 的 180 秒
rescue timer。当前仓库只提供 source/test，不安装服务、不写 live `tc`、不改变现有六个身份、
Legacy 状态、端口或报告 job。Ingress 计费仍可能在 egress shaper 生效前发生，不能把本 fuse
描述成 provider 的绝对 50 GB 日配额限制。

## 订阅账号流量归因（已 apply，2026-10-08）

`docs/AMADEUS_VPS_SUBSCRIPTION_ACCOUNTING_GOAL.md` 定义 example-user-01-example-user-05、M204 和独立 legacy 身份。
VPS 已运行 SQLite 账本、loopback HY2 HTTP auth/采样器、六个活动账号订阅和固定只读 probe；
Amadeus 1.9.9 已部署，Legacy 已禁用。现有 owner 报告 Cron ID 保持不变，
启用时间为 09:30 和 21:30 Asia/Shanghai，走既有 owner outbox。五个 Labmem 账号的 HY2/VLESS
受控连接与计数归因均通过；Xray/Hysteria 重启计数器验证通过。Provider/proxy reconciliation
仍为 `uncalibrated`，不输出差值异常结论。部署、验收与 rollback 记录见 Goal 和
`.agent/checkpoints/2026-10-08-vps-subscription-accounting-deployment.md`。六个活动账号的四种公网订阅格式共
24 条均返回 HTTP 200，正文与 VPS 本地文件一致。Legacy 订阅 token、HY2 secret 和 VLESS UUID 已轮换，
旧订阅路径、认证和隧道拒绝证据见 `.agent/checkpoints/2026-10-08-example-device-legacy-retirement.md`；
旧凭据只保留在 VPS root-only checkpoint 中，不能恢复成 live 配置。

目标 runtime 边界：

- `/var/lib/amadeus-accounting/subscription-accounts.sqlite` 由独立 `amadeus-accounting` systemd 用户拥有，
  mode `0600`；库中含六个活动账号 secret 和已撤销的 Legacy 历史凭据，不能提供给 OpenClaw。
- `/var/lib/amadeus-accounting/subscription-usage-public.json` mode `0640`，group
  `amadeus-accounting-snapshot`。固定 `amadeus-vps-readonly-probe` 只读取这份脱敏文件；SSH probe
  用户不属于 Caddy 或数据库读取组。
- `/var/lib/amadeus-accounting` 是独立的 `amadeus-accounting:amadeus-accounting-snapshot`、`0750`
  目录；现有 `/var/lib/amadeus-gateway` 和 Caddy responder 的 `usage-state.json` 所有者/权限保持不变。
- 账号 auth endpoint 仅 `127.0.0.1:18796`；Hysteria `/traffic`、`/online` 仅
  `127.0.0.1:19999` 且使用独立 stats secret。采样器请求 `/traffic` 时不加 `clear=1`。
- Xray 运行官方 release 26.9.30；`StatsService` 只监听 `127.0.0.1:10085`；policy 打开用户
  uplink/downlink/online counters，不开放公网 gRPC，也不记录目的地址。
- Collector 每 60 秒采样，Python 标准库 + SQLite，无容器或新 Web 面板；systemd 模板限制为
  128 MiB 和 20% CPU。它单独记录 source 健康状态，源失败不转成零。
- per-account T0 从 provider baseline 建立。KiwiVM 仍是整机配额和进度条唯一真相；HY2/VLESS
  controlled calibration 完成前 reconciliation 始终是 `uncalibrated`，不得声称差值异常。
- `amadeus-vps-readonly-probe` 从脱敏 snapshot 暴露 HY2 认证失败聚合值、限额模式与窗口覆盖秒数、
  Reality fallback 聚合计数及固定安全信号；它不输出来源 IP、认证值或 Reality 目标。

### 代理安全加固（已 apply，2026-10-09）

Xray Reality fallback 现在只连接监听 `127.0.0.1:24431` 的 loopback gate；gate 只允许精确 TLS
SNI `www.apple.com` 到当前伪装目标，其余 SNI 由 block outbound 丢弃。Xray inbound uplink/downlink
计数通过 `reality-fallback-gate` tag 采样。真实 M204 与 example-user-01 VLESS 客户端均通过 HTTPS
验证并产生账号计数；gate 端口不对公网监听，也没有新增防火墙端口。

Hysteria config 未配置 masquerade，官方默认对无效请求返回 404。accounting auth endpoint 仍只监听
loopback；失败来源只在 accounting 进程内存中用于可配置的有界限额，SQLite 和 owner snapshot 只
保存聚合计数。当前 live mode 为 `enforce`（900 秒窗口、120 次阈值、300 秒 cooldown、最多跟踪
4096 个来源）；进程重启会清空逐来源限额状态，snapshot 带窗口实际覆盖秒数。M204 和 example-user-01
在 enforcement 生效后均通过启用 TLS 校验的 HY2 HTTPS smoke。

当前 `amadeus-accounting` 只写独立 state 目录，对 KiwiVM credential 和 HY2 stats-secret 两个
固定文件只读；`amadeus-vps-readonly` 仅通过 snapshot 组读取脱敏快照。该 SSH 用户不属于 `caddy`
组或数据库主组。root-only bootstrap 从当前 Caddyfile/Hysteria/Xray 文件导入 legacy，不在
stdout/journal 中输出值；账号凭据和订阅只保留在 VPS。

端口用途：

| 端口 | 协议 | 用途 | 备注 |
| ---: | --- | --- | --- |
| 22 | TCP | SSH 运维 | 任何防火墙变更前必须确认仍放行 |
| 443 | TCP | Caddy HTTPS 站点（例如 Emby） | Let’s Encrypt 自动证书；不承载 Xray |
| 2053 | TCP | 个人 VLESS + Reality | QX 节点端口；非标准端口 |
| 2053 | UDP | 个人 Hysteria 2 | Clash Meta/Mihomo、Shadowrocket 节点端口；与 TCP 2053 不冲突 |
| 24431 | TCP | Xray Reality fallback gate | 仅 loopback `127.0.0.1` 监听，不开放公网 |
| 7000 | TCP | frps 控制通道 | 仅供 HomeLab frpc 连接 |
| 8096 | TCP | Emby frp 回源端口 | Caddy `emby.example.com` |
| 2283 | TCP | Immich frp 回源端口 | Caddy `immich.example.com` |
| 8097 | TCP | Jellyfin frp 回源端口 | Caddy `jellyfin.example.com` |
| 6880 | TCP | AriaNG frp 回源端口 | Caddy `aria.example.com` |
| 8080 | TCP | qBittorrent WebUI frp 回源端口 | Caddy `qb.example.com` |
| 20128 | TCP | 9Router frp 回源端口 | Caddy `9router.example.com`；API 仍要求 key |
| 6800/7575 | TCP | 其他现有 frp 映射 | 当前按 frpc 配置监听；未新增 Caddy 公网站点 |
| 80 | TCP | Caddy ACME HTTP-01 / HTTPS 跳转 | 不承载代理流量 |
| 8443 | TCP/UDP | Caddy HTTPS 订阅入口 | UDP 为 Caddy 默认 HTTP/3；只提供订阅文件 |
| 18789 | TCP | OpenClaw frp 回源端口 | 由 Caddy 的 `claw.example.com` 使用；OpenClaw 仍要求 gateway token |

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

服务复用 Caddy 为 `sub.example.com` 管理的公开证书；Hysteria 配置只引用证书路径，认证密码
仍保存在 VPS 的 `/etc/hysteria/config.yaml`，不写入 Git。升级或变更时先备份配置，然后执行：

```sh
ssh amadeus-gateway '/usr/local/bin/hysteria version'
ssh amadeus-gateway 'systemctl daemon-reload && systemctl restart hysteria-server.service'
ssh amadeus-gateway 'systemctl is-enabled hysteria-server.service && systemctl is-active hysteria-server.service'
ssh amadeus-gateway 'ss -lunp | grep ":2053 "'
```

Clash/Mihomo 使用 `clash.yaml`，Shadowrocket 使用 `shadowrocket.txt`；Quantumult X 当前
继续使用 `server.snippet` 中的 VLESS Reality，不能把 HY2 行直接塞进 QX 配置。

账号归因模板 `proxy/config.example.hysteria2.accounting.yaml` 用 loopback HTTP auth 映射 legacy
原 password 和五个新 secret；不得直接切到 `userpass`，旧客户端没有发送用户名。模板不含运行
时 secret；若在重建环境中使用，必须先完成 Goal 中的受保护安装和验证流程。

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
ssh amadeus-gateway 'ss -lntup | grep -E ":(22|22|80|443|2053|7000|8443|8096|2283|6880|6800|20128|8080|8097|7575) "'
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
- frpc login 失败：确认 HomeLab frpc 的 `serverAddr` 指向 `sub.example.com`、`serverPort=7000`，再从 VPS 查看 frps 的 login 日志；不要把 token 打印到终端。
- Emby HTTPS 失败：确认 Caddy 已监听 443、`emby.<domain>` DNS 指向 VPS、80 的 ACME HTTP-01 可达，并检查 Caddy journal 的证书记录。
- 订阅 URL 返回 404：检查 Caddyfile 中的 token 路径与 `/var/lib/caddy/subscription/<token>/qx.conf`
  是否一致，再执行 `caddy validate` 和 `systemctl reload caddy`。
- 订阅 URL TLS 失败：确认 DNS 记录仍解析到 VPS、80/8443 可达，并查看 Caddy journal 中的 ACME
  续期状态；不要把 Cloudflare 代理开关变更和服务配置混在一起操作。
- HY2 客户端超时：确认 `sub.example.com` 为 Cloudflare DNS only（灰云），因为普通 Cloudflare
  代理不转发这个 UDP 端口；再检查 `hysteria-server.service`、证书 SNI 和密码是否一致。
- HY2 证书错误：确认 Caddy 证书仍包含 `sub.example.com`，并检查 Hysteria 配置引用的
  Caddy 证书路径和服务用户 `caddy` 的读取权限。
- 客户端超时：先从本机验证 SSH alias 指向的主机 TCP 2053，再检查 VPS 上的监听和上游 Reality 目标；不要先改 SSH 或重启 VPS。
- 防火墙：当前代理部署不要求新增规则。未来启用 UFW/nftables 时，必须先明确放行当前 SSH 端口 22，再放行代理端口，并用新的 SSH 会话验证。
- 当前系统曾存在 `networking.service` 对不存在 `eth1` 的遗留引用。该问题不影响当前实际 `eth0` 默认路由，但修复网络接口配置可能导致失联，未经确认不得自动修改。

## 安全边界

SSH 公钥认证是运维生命线。此目录不保存 SSH 私钥、公网 IP、密码、API key、UUID、
Reality private key、frps token 或其他真实 secret；也不包含从 VPS 导出的完整配置文件。
