# 个人 Quantumult X 代理

## 方案

服务端使用 Xray-core 的 VLESS + Reality + `xtls-rprx-vision`，监听 TCP 2053，由
`xray.service` 以专用 `xray` 用户运行。Xray 代理本身不使用 Docker、Nginx、Web 面板或
UDP 监听；Caddy 在 TCP 443 提供 HTTPS 站点，在 8443 提供静态订阅文件。

Quantumult X 的字段以其官方样例为准，而不是按 sing-box 或 Clash Meta 的配置字段猜测：

- VLESS：`method=none`、`password=<UUID>`。
- Reality：`obfs=over-tls`、`obfs-host=<serverName>`、`reality-base64-pubkey`、
  `reality-hex-shortid`。
- Vision：`vless-flow=xtls-rprx-vision`。
- 官方 Reality + Vision 样例没有把 `udp-relay=true` 作为必填字段；是否额外启用需按
  实际 QX 版本和用途单独验证。
- 官方 Reality 样例省略 `fast-open`；Reality 使用 iOS 26 Safari 指纹时不要启用 TCP
  Fast Open。
- 当前官方样例没有要求手填 `fp=`；QX 使用当前 iOS Safari Reality 指纹逻辑。若 QX
  UI 显示 fingerprint 选项，使用默认/当前 iOS Safari，不要填服务端私钥。

## Reality fallback 限制

`infra/vps/subscription/accounting_cli.py render-xray` 生成并已应用的配置把 Reality `target` 指向
`127.0.0.1:24431`。这个 loopback `dokodemo-door` gate 只接受 TLS sniff 得到的精确
`www.apple.com` SNI 并转发到原目标；缺失或不匹配的 SNI 进入 block outbound。live 配置启用 Xray
inbound uplink/downlink 统计，collector 通过 `reality-fallback-gate` tag 采样聚合字节数，不记录
请求来源或目标地址。24431 不应加入公网上的监听或防火墙规则。

服务端配置的 Reality 私钥、客户端 UUID 和 short ID 未改变。候选通过
`/usr/local/bin/xray run -test -config <candidate>` 后应用；M204-Net-Core 与 Labmem001 的真实
VLESS HTTPS smoke 及账号计数均通过。无效 SNI 探测未收到服务端证书；fallback inbound 统计源
为 `ok`，可见聚合流量。计数为零只说明当前采样窗口没有观测到 gate 流量；统计源 unknown/stale
时不能解释为零流量。

参考：[Quantumult X 官方配置样例](https://github.com/crossutility/Quantumult-X/blob/master/sample.conf)
和 [Quantumult X App Store 版本记录](https://apps.apple.com/id/app/quantumult-x/id1443988620)。

## 配置文件与 secret

服务端配置只存在于 VPS 的 `/etc/xray/config.json`，权限为 `root:xray`、`0640`。
Reality private key 只能出现在 VPS 服务端配置；客户端只需要 Reality public key。

安全地生成并记录客户端所需的 UUID、Reality public key 和 short ID 后，使用
`config.example.quantumult-x.conf` 的字段顺序创建 QX 节点。不要把填充后的节点行、截图、
备份或订阅内容写入仓库。

## 服务端配置模板

`config.example.json` 是无凭据模板。部署时应在 VPS 上替换所有占位符，然后先执行：

```sh
/usr/local/bin/xray run -test -config /etc/xray/config.json
```

测试通过后再由 systemd 加载。Reality 的 `target`/`serverNames` 必须与选定上游站点的
TLS 证书和客户端 `obfs-host` 一致；不要随意复制其他客户端的字段名。

## QX 客户端模板

```text
vless=<VPS_SERVER>:2053, method=none, password=<UUID>, obfs=over-tls, obfs-host=<REALITY_SERVER_NAME>, reality-base64-pubkey=<REALITY_PUBLIC_KEY>, reality-hex-shortid=<REALITY_SHORT_ID>, vless-flow=xtls-rprx-vision, tag=amadeus-reality
```

当前运行实例的 `serverName`/`obfs-host` 是 `www.apple.com`。实际客户端节点中的
`<VPS_SERVER>`、`<UUID>`、`<REALITY_PUBLIC_KEY>` 和 `<REALITY_SHORT_ID>` 只在交付给用户
时填入，不得回写 Git。

## Hysteria 2 备用节点

VPS 另运行官方 Hysteria 2 `v2.12.3`，systemd 服务为 `hysteria-server.service`，监听 UDP
`2053`。它复用 `sub.nyannyan.top` 的 Caddy 证书，认证密码只存在 VPS 的
`/etc/hysteria/config.yaml`。

认证使用 loopback HTTP auth service。失败来源只用于 accounting 进程内存中的有界失败窗口；
数据库保留按分钟聚合的失败与限额次数，不保存来源地址或提供可复用的失败明细。新环境模板
默认 `telemetry`；当前 live mode 是在 M204/Labmem001 重试兼容性 smoke 通过后启用的 `enforce`，
达到阈值的来源会在 cooldown 内得到通用认证拒绝。进程重启会重置来源窗口，security snapshot
会显示当前窗口长度及已覆盖秒数。不要将聚合失败数解释成攻击或入侵证据。

Hysteria 服务端未配置 masquerade 时，官方默认响应为 404。若候选配置中发现指向外部 URL 的
proxy masquerade，`render-hysteria` 会将其收敛为本地静态 `Not Found` 响应；本地 string/file
masquerade 保持不变。任何未知 proxy 形式都应让候选生成失败，不能保留外部代理跳转。

Clash Meta/Mihomo 使用 `config.example.hysteria2.clash.yaml` 中的字段；Shadowrocket 使用
`config.example.hysteria2.shadowrocket.txt` 的 `hysteria2://` URI。Quantumult X 当前官方样例
没有 Hysteria 2 节点格式，因此 QX 继续使用上面的 VLESS Reality 节点；不要为了追求一份文本
而把 HY2 伪装成 QX 的 VLESS 语法。

参考：[Hysteria 2 官方服务端配置](https://hy2.app/docs/advanced/Full-Server-Config/)、
[Hysteria 2 URI Scheme](https://v2.hysteria.network/docs/developers/URI-Scheme/) 和
[Clash Meta Hysteria2 配置](https://wiki.metacubex.one/config/proxies/hysteria2/)。

## Smoke test

```sh
ssh amadeus-gateway '/usr/local/bin/xray run -test -config /etc/xray/config.json'
ssh amadeus-gateway 'systemctl is-enabled xray.service && systemctl is-active xray.service'
ssh amadeus-gateway 'ss -lntup | grep ":2053 "'
ssh amadeus-gateway 'systemctl is-enabled hysteria-server.service && systemctl is-active hysteria-server.service'
ssh amadeus-gateway 'ss -lunp | grep ":2053 "'
```

以上检查只能证明服务端配置、进程和 TCP 监听正常；最终 Reality 握手和实际代理效果仍需
在 Quantumult X 中导入节点后，从手机网络发起连接验证。

## 凭据泄露时轮换

订阅 URL token 只控制下载配置，不能撤销已导入的 Xray UUID 或 Hysteria 2 密码。
在 owner 明确授权后，先对 `/etc/xray/config.json`、`/etc/hysteria/config.yaml` 和当前 token 目录
下的四个订阅文件做 root-only 外部备份；不要把备份、填充后的配置或凭据放入 Git。

1. 在 VPS 上分别生成新的 VLESS UUID 和高熵 Hysteria 2 密码，保持 Reality 密钥、服务端地址、
   TLS 证书、端口和订阅 URL token 不变。同步更新服务端配置，以及 QX 的 `qx.conf`/
   `server.snippet`、Clash 的 `clash.yaml`、Shadowrocket 的 `shadowrocket.txt`。
2. 先对候选 Xray 配置运行 `xray run -test -config <candidate>`，并用独立 loopback 端口验证
   Hysteria 候选配置可启动；核对四种订阅的凭据和格式，不要打印或记录实际 secret。
3. 停止两个代理服务以断开旧连接，原子替换六个文件，重新启动 Xray 和 Hysteria 2。确认
   TCP/UDP 2053 监听、订阅 HTTPS 正文与新凭据一致、旧凭据已从 live 文件消失。
4. 通知所有设备刷新或重新导入订阅，并分别做真实代理握手验收。服务端监听和订阅 `200`
   不能替代设备端测试；不要把 root-only 备份中的旧凭据恢复到运行配置。

若需要按设备归因流量，应在后续单独设计每设备凭据及服务端统计；整台 VPS 的 KiwiVM
套餐计数和共享凭据无法证明哪台设备耗流量。
