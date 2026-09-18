# VPS read-only SSH provision checkpoint

日期：2026-09-18（Asia/Shanghai）

## 运行时变更

- canonical `amadeus-gateway` 上安装了仓库内固定 probe：
  `/usr/local/sbin/amadeus-vps-readonly-probe`，root 拥有、`0755`。
- 创建了无密码专用用户 `amadeus-vps-readonly`，authorized key 使用 forced command，并禁用
  port forwarding、agent forwarding、X11 和 pty；没有修改 sshd 配置、防火墙、root key 或
  Caddy/Xray/Hysteria2/frps。
- CasaOS 外部已放置专用私钥和 hashed known-hosts：
  `/DATA/AppData/openclaw/secrets/vps-readonly-ssh-key`、
  `/DATA/AppData/openclaw/secrets/vps-ssh-known-hosts`，均为 `0600`、只读挂载目标。
- OpenClaw 外部 env 已写入 `VPS_SSH_HOST`、`VPS_SSH_USER`、`VPS_SSH_PORT`；实际地址不入 Git。
- VPS 回滚资料保存在 `/var/backups/amadeus-vps-readonly-20260918105657/`，包含 probe 和
  authorized_keys 的当前版本。

## 验证

- 两条独立新 SSH 会话分别发送 `id`、`uname -a`，均只返回固定 probe，不执行请求命令。
- 插件真实调用 `getVpsSystemStatus`/`getVpsServices`：system `status=ok`，rootfs 使用率
  `9%`，Caddy/Xray/Hysteria2/frps 均 `active/enabled`。
- 当前 root 运维 SSH 会话仍可用，四个服务仍 active。

## 尚未完成

- CasaOS 外部 `kiwivm-credentials.json` 尚无真实 VEID/API key；因此 KiwiVM API、流量历史、
  OpenClaw 新镜像 apply、自然语言调用和 WhatsApp 早晚报告仍未验收。
