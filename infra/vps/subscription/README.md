# Quantumult X HTTPS 订阅入口

该目录描述一个独立的 HTTPS 订阅入口。订阅正文仍来自 VPS 上的静态配置文件，但由
`amadeus-gateway-subscription.service` 动态附加整台 VPS 的套餐流量响应头和统一下载名；它不参与
Xray/Hysteria 代理流量，也不提供 Web 管理面板。

## 架构

- DNS：在 Cloudflare 的 `nyannyan.top` zone 中创建 `A sub -> VPS IPv4`，默认使用 DNS only
  （灰云），不把订阅 URL 交给 Cloudflare 缓存或代理。
- Web 服务：Caddy 官方 Ubuntu 包，systemd service 名称为 `caddy.service`。
- 订阅响应器：本地 `amadeus-gateway-subscription.service`，仅监听 `127.0.0.1:8787`，Caddy
  通过反向代理转发原有订阅路径。
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
新 token 并启用新路径；若要避免客户端切换期间中断，可暂时并行保留旧路径，待 owner 明确
确认后再撤销旧路径和目录。订阅 token 轮换不会让已经下载的配置或其中的代理凭据失效。

## 现有链接与流量响应

现有的 `/<TOKEN>/qx.conf`、`server.snippet`、`clash.yaml` 和 `shadowrocket.txt` 路径继续保留，
不需要因为启用流量显示而重新生成订阅链接。动态响应器会：

- 原样返回对应订阅文件正文；
- 通过 `Content-Disposition` 将下载文件名统一为 `amadeus-gateway`；
- 返回 `Subscription-Userinfo: upload=0; download=<VPS 已用>; total=<VPS 月度总量>`，并在有
  重置时间时附加 `expire`；客户端据此计算已用/剩余流量；
- 返回 `X-Amadeus-Gateway-Usage`，包含 `usedBytes`、`remainingBytes`、`totalBytes` 和
  `status`。这里的计数是整台 VPS KiwiVM 套餐计数，不区分 Xray/HY2 或用户；KiwiVM 暂时不可用时
  使用上一次成功样本并标记 `stale`，没有样本时不会伪造为 0。

客户端是否把 `Content-Disposition` 显示为订阅名称取决于客户端实现；浏览器下载名和支持订阅
流量响应头的客户端会使用 `amadeus-gateway`。浏览器直接打开订阅 URL 仍会看到配置正文，不会变成
管理面板。

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

### 分阶段 token 轮换

1. 在 VPS 上生成新的随机 token，并把现有四种订阅文件复制到新的 token 目录；保持配置正文和
   代理凭据不变。
2. 在标准 HTTPS 和兼容 `8443` 的 Caddy subscription matcher 中同时加入新旧两组精确路径，
   执行 `caddy validate` 后平滑 reload。
3. 对新旧 token 的四种格式分别做 HTTPS smoke test。新链接可供客户端逐台更新，旧链接继续有效。
4. 只有 owner 明确发出撤销信号后，才从所有 Caddy matcher 中移除旧路径、reload 并删除旧 token
   目录。若已下载的代理凭据也疑似泄露，另行轮换 Xray/HY2 客户端凭据；仅撤销订阅 URL 不够。

如需撤销已导入节点的访问权限，按 `../proxy/README.md` 的凭据轮换流程更新 Xray UUID、Hysteria 2
密码以及全部四种订阅正文，再重启两个代理服务。现有订阅 URL token 可以保持不变；客户端必须刷新或
重新导入才能使用新凭据。订阅恢复 `200` 不等于客户端代理握手成功，须分别用实际设备验收。

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

`Caddyfile.example` 使用互斥 `handle`，只允许精确的 token 路径转发四种格式文件，其他路径统一
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

### 动态响应器安装布局

```text
/usr/local/libexec/amadeus_gateway_subscription.py
/etc/amadeus-gateway/subscription.env
/etc/amadeus-gateway/kiwivm-credentials.json  # root:caddy 0640，仓库外
/var/lib/amadeus-gateway/usage-state.json     # caddy 0600，原子更新
```

`subscription.env.example` 是非敏感配置模板。`kiwivm-credentials.json` 只允许包含外部
KiwiVM 的 `veid` 和 API key，不能提交到 Git、日志或订阅响应。服务使用 Python 标准库，运行在
现有 `caddy` 用户下，不需要 Docker 或 Web 管理面板。

安装代码和 unit 后，先执行：

```sh
ssh amadeus-gateway 'python3 -m py_compile /usr/local/libexec/amadeus_gateway_subscription.py'
ssh amadeus-gateway 'systemctl enable --now amadeus-gateway-subscription.service'
ssh amadeus-gateway 'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile'
ssh amadeus-gateway 'systemctl reload caddy.service'
```

运行时应从原订阅 URL 验证 `Content-Disposition`、`Subscription-Userinfo` 和正文仍为对应格式；
不要在 shell 输出或报告中打印 token、UUID 或 API key。

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

## 账号归因与采集运行说明（已 apply，2026-10-08）

`accounting_cli.py`、`accounting_store.py`、`accounting_service.py` 和
`../systemd/amadeus-gateway-accounting.service.example` 是运行时源码。服务、账号数据库、HY2 Stats
API secret、KiwiVM 凭据和生成的订阅文件已安装在 VPS 受保护路径；本地模板不含运行时 secret。

Phase 2 的部署顺序如下，供新环境恢复时参考；不得在 live VPS 上重复创建或轮换账号。先创建专用 `amadeus-accounting` 系统用户和
`amadeus-accounting-snapshot` 只读共享组；新建 `/var/lib/amadeus-accounting`，使用
`amadeus-accounting:amadeus-accounting-snapshot`、`0750`。数据库由 `amadeus-accounting`
持有并为 `0600`。不要更改现有 `/var/lib/amadeus-gateway` 的 owner/mode：Caddy responder 以
`caddy:caddy` 身份写入其中的 `usage-state.json`。也不要更改现有 `/etc/amadeus-gateway` 的
owner/mode：当前目录为 `root:caddy 0750`，订阅响应器以 `caddy` 身份从中读取
`kiwivm-credentials.json`（`root:caddy 0640`）。在独立 `/etc/amadeus-accounting` 下创建
`root:amadeus-accounting 0750` 目录；复制一份 KiwiVM 凭据到该目录供 collector 使用，原有
`/etc/amadeus-gateway/kiwivm-credentials.json` 保持不动。accounting env、复制的 KiwiVM 凭据及
HY2 Stats API secret 使用 `root:amadeus-accounting 0640`。systemd 的 `UMask=0077` 会保护 SQLite
WAL/SHM 和临时文件。

创建隔离配置目录并复制 KiwiVM 凭据时只复制文件，不读取或打印其内容：

```sh
install -d -o root -g amadeus-accounting -m 0750 /etc/amadeus-accounting
install -o root -g amadeus-accounting -m 0640 \
  /etc/amadeus-gateway/kiwivm-credentials.json \
  /etc/amadeus-accounting/kiwivm-credentials.json
```

只读 SSH probe 账号只加入 snapshot 组；独立 state 目录允许该组读取 `0640` 脱敏快照，而数据库仍为
`0600` 且只由 accounting 用户读取。不把 probe 用户加入数据库、accounting 主组或 `caddy` 组。
建立状态目录后，先以 `ACCOUNTING_COLLECTOR_ENABLED=false` 启动 accounting service，让 loopback HY2 auth endpoint 在切换 Hysteria 前可用；完成 Hysteria 与 Xray 切换并确认两路统计接口健康后，再改为 `true` 并重启服务采集。这样首个 provider 样本会在两路统计都可用后建立 T0，避免把预期中的切换间隔记成 T0 后数据源故障。随后运行 `scripts/provision-vps-readonly.sh --apply` 安装固定探针。

accounting CLI 默认只输出 dry-run 计划、不创建文件或数据库。下面示例中的 `--apply` 是实际
写入的显式门槛；只可在 Phase 2 受保护备份完成后逐项执行：

```sh
python3 /usr/local/libexec/amadeus-gateway-accounting/accounting_cli.py bootstrap \
  --db /var/lib/amadeus-accounting/subscription-accounts.sqlite \
  --caddyfile /etc/caddy/Caddyfile \
  --subscription-root /var/lib/caddy/subscription \
  --hysteria-config /etc/hysteria/config.yaml \
  --xray-config /etc/xray/config.json \
  --service-user amadeus-accounting \
  --apply

python3 /usr/local/libexec/amadeus-gateway-accounting/accounting_cli.py generate-stats-secret \
  --output /etc/amadeus-accounting/hysteria-stats-secret \
  --service-group amadeus-accounting \
  --apply

python3 /usr/local/libexec/amadeus-gateway-accounting/accounting_cli.py render-hysteria \
  --source-config /etc/hysteria/config.yaml \
  --output /etc/hysteria/config.accounting.candidate.yaml \
  --stats-secret-file /etc/amadeus-accounting/hysteria-stats-secret \
  --caddy-group caddy \
  --apply

python3 /usr/local/libexec/amadeus-gateway-accounting/accounting_cli.py render-xray \
  --db /var/lib/amadeus-accounting/subscription-accounts.sqlite \
  --source-config /etc/xray/config.json \
  --output /etc/xray/config.accounting.candidate.json \
  --xray-group xray \
  --apply

python3 /usr/local/libexec/amadeus-gateway-accounting/accounting_cli.py render \
  --db /var/lib/amadeus-accounting/subscription-accounts.sqlite \
  --subscription-root /var/lib/caddy/subscription \
  --caddy-fragment /etc/caddy/subscription-accounts.caddy.candidate \
  --vless-server '<PUBLIC_VLESS_HOST>' --hy2-server '<PUBLIC_HY2_HOST>' \
  --hy2-sni '<HY2_SNI>' --reality-server-name '<REALITY_SERVER_NAME>' \
  --reality-public-key '<REALITY_PUBLIC_KEY>' --reality-short-id '<REALITY_SHORT_ID>' \
  --apply
```

`bootstrap` 只从当前 Caddy/Hysteria/Xray 配置导入 legacy 身份，并为五个 Labmem 账号生成独立
token、HY2 secret 和 UUID；重跑时不会轮换凭据。`render-xray` 保留现有 2053 VLESS listener、
Reality、routing 和旧 UUID，candidate 必须通过 `xray run -test` 后才能进入受保护的 Phase 2
checkpoint 流程。`render-hysteria` 只生成 HTTP auth/loopback Traffic Stats candidate YAML；
`render` 写五个新订阅目录和六个账号的 bounded Caddy matcher。CLI 的计划、成功和失败输出都不含
凭据。不要把 candidate 文件、数据库、填充后的 env 或订阅文件复制回 Git。

五个新 token URL 在 accounting service 成功记录 provider T0 前必须保持私密、不得发给用户。当前
T0 为 `2026-10-08T04:58:07Z`；生成链接仍保留在 VPS，并未通过聊天或 Git 分发。
Labmem 身份是新生成的，因此首次出现的协议绝对计数可从 T0 归因；legacy 计数可能含历史流量，
必须有 T0 基线，否则该协议总量继续显示 unknown。

Snapshot 由 accounting service 原子写成 `0640`、组为
`amadeus-accounting-snapshot`；probe 仅读取这一个固定文件。缺失账号/协议计数会保持 unknown，
`knownProxyAccountedBytes` 是已观测部分；只有 `proxyAccountedComplete=true` 才能称为总量。
HY2 在线计数表示 client instance 数；VLESS 在线计数表示 Xray 最近活动的来源 IP 数，不保存或
暴露来源 IP，也不等同于物理设备数。未经 HY2、VLESS 各自受控流量校准，`reconciliation.status`
保持 `uncalibrated`，不能声称流量异常。
