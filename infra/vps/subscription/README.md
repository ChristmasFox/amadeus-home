# Quantumult X HTTPS 订阅入口

该目录描述一个独立的 HTTPS 静态订阅入口。它不参与 Xray/Hysteria 代理流量，也不提供
Web 管理面板。

## 架构

- DNS：在 Cloudflare 的 `nyannyan.top` zone 中创建 `A sub -> VPS IPv4`，默认使用 DNS only
  （灰云），不把订阅 URL 交给 Cloudflare 缓存或代理。
- Web 服务：Caddy 官方 Ubuntu 包，systemd service 名称为 `caddy.service`。
- 端口：TCP 80 用于 ACME HTTP-01/HTTPS 跳转；TCP 443 提供普通 HTTPS 站点；TCP 8443
  提供订阅 HTTPS。Caddy 默认还会在 8443 开启 HTTP/3 UDP 监听；该 UDP 监听不承载代理流量。
- Xray：独占 TCP 2053，配置和 secret 与订阅服务分离；Hysteria 2 使用 UDP 2053。
- URL 形式：首选标准 HTTPS `443`：`server.snippet`/`qx.conf` 给 Quantumult X，
  `clash.yaml` 给 Clash Meta/Mihomo，`shadowrocket.txt` 给 Shadowrocket；`8443` 仅作为旧
  客户端兼容入口。
- 这些 URL 共用同一个 token，但返回格式不同。不存在一份正文可以稳定地同时作为 QX、Clash
  和 Shadowrocket 订阅；HY2 节点只放入 Clash/Mihomo 和 Shadowrocket 格式，QX 继续使用
  VLESS Reality。

订阅 URL 是 bearer credential：知道 URL 即可读取 UUID 等客户端信息。token 只能保留在
VPS 的 Caddyfile 和订阅文件路径中，不得提交到 Git、截图或公开聊天记录。泄露后应立即生成
新 token、reload Caddy，再删除旧 token 目录。

## VPS 文件布局

```text
/etc/caddy/Caddyfile
/var/lib/caddy/subscription/<RANDOM_TOKEN>/qx.conf
/var/lib/caddy/subscription/<RANDOM_TOKEN>/server.snippet
/var/lib/caddy/subscription/<RANDOM_TOKEN>/clash.yaml
/var/lib/caddy/subscription/<RANDOM_TOKEN>/shadowrocket.txt
```

Caddyfile 应为 `root:caddy`、`0640`；订阅文件和 token 目录应为 `caddy:caddy`，订阅文件
权限为 `0640`，目录权限为 `0750`。默认不启用访问日志，避免 token 出现在日志中。

## 安装与证书

使用 [Caddy 官方安装文档](https://caddyserver.com/docs/install) 提供的签名 Ubuntu/Debian
软件包，不运行第三方一键脚本。官方包提供 `caddy.service`，配置文件路径为
`/etc/caddy/Caddyfile`。

DNS 生效后，Caddy 使用公开受信任的 ACME 证书。需要确保 TCP 80、443 和 8443 在 VPS 上可达；
Xray 使用 2053，不要为证书申请修改 SSH 配置。

普通 HTTPS 站点可在同一 Caddyfile 中反代到 frps 的本机映射端口，例如：

```caddyfile
emby.example.com {
    reverse_proxy 127.0.0.1:8096
}
```

## 配置模板

`Caddyfile.example` 使用互斥 `handle`，只允许精确的 token 路径返回四种格式文件，其他路径统一
返回 404。部署时必须将 `REPLACE_WITH_RANDOM_TOKEN`
替换成 VPS 上生成的随机值，并把订阅文件放入对应 token 目录。

```sh
ssh amadeus-gateway 'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile'
ssh amadeus-gateway 'systemctl reload caddy.service'
ssh amadeus-gateway 'systemctl is-enabled caddy.service && systemctl is-active caddy.service'
```

订阅文件内容应从 VPS 当前配置生成：QX 文件只包含 QX 官方支持的 VLESS + Reality + Vision
节点行；Clash/Mihomo 和 Shadowrocket 文件可包含 HY2。不要把填充后的内容回写到模板或其他
仓库文件。

## 故障排查

```sh
ssh amadeus-gateway 'systemctl status caddy.service --no-pager -l'
ssh amadeus-gateway 'journalctl -u caddy.service -n 100 --no-pager'
curl --noproxy '*' -fsS -D - -o /dev/null 'https://sub.example.com:8443/<RANDOM_TOKEN>/qx.conf'
```

- 404：检查 Caddyfile 的 token 路径与文件目录名是否完全一致。
- TLS 失败：检查 DNS、TCP 80/8443 和 Caddy journal 的 ACME 记录。
- HY2 订阅导入失败：Clash/Mihomo 使用 `clash.yaml`，Shadowrocket 使用 `shadowrocket.txt`；
  不要把这两个格式直接作为 QX 资源导入。HY2 节点要求 `sub.nyannyan.top` 为灰云并可达 UDP 2053。
- QX 导入后节点缺失：确认响应正文是一行 QX 节点配置，且没有以 `;` 开头的注释符。
- 任何 token 泄露：保留旧配置备份，生成新 token 后 reload，再明确删除旧目录。
