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
