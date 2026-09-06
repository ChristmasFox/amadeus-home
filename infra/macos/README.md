# macOS Host Agent

`mac_host_agent.py` 是 HomeHub V1.2 的只读 macOS 观测边界。它只暴露：

- `GET /v1/health`
- `GET /v1/host/status`
- `GET /v1/cloudflared/status`

所有请求都必须带 `Authorization: Bearer <token>`（也接受同值的
`X-MacHostAgent-Token`）。不存在 `/exec`、`/shell` 或任意命令转发接口；源码中的
`subprocess` 调用只使用固定的本机观测命令，并且 `shell=False`。

## 在 Mac mini 上安装

```sh
sudo mkdir -p /Users/Shared/HomeHub
sudo sh -c 'umask 077; openssl rand -hex 32 > /Users/Shared/HomeHub/mac-host-agent.token'
chmod 600 /Users/Shared/HomeHub/mac-host-agent.token
```

复制并审查 `mac-host-agent-launchd.plist.example`，把仓库路径替换为实际路径后：

```sh
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.local.homehub.mac-host-agent.plist
launchctl kickstart -k "gui/$(id -u)/com.local.homehub.mac-host-agent"
```

launchd 模板默认监听 `0.0.0.0:49152`，因此 CasaOS 容器可通过
`http://host.docker.internal:49152` 访问。应在 macOS 防火墙/网络边界限制端口来源，token
只放在 Mac mini 和 CasaOS 外部 secret 路径，不要写入 Git。
