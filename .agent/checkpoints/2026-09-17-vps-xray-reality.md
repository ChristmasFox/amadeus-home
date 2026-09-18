# VPS Xray Reality checkpoint

日期：2026-09-17（Asia/Shanghai）

## 已完成

- 目标主机通过既有 SSH alias `amadeus-gateway` 访问；未改 SSH 登录方式，未关闭公钥认证，
  未重启 VPS。
- 已确认 Ubuntu 24.04、2 vCPU、约 1 GiB RAM、约 20 GiB SSD；现有 TCP 拥塞控制为 BBR，
  qdisc 为 fq。
- 已从官方 Xray-core Release 安装并校验 Xray 26.3.27 二进制，没有运行第三方一键脚本。
- 已生成独立 UUID 和 Reality key pair；真实 UUID、private key、public key 和 short ID 不
  写入本 checkpoint 或 Git。
- `xray.service` 已 enable/active，配置测试通过，监听 TCP 443，运行时以 `xray` 专用用户
  启动。
- 已通过 Caddy 官方 Ubuntu 包安装 Caddy 2.11.4；`caddy.service` 已 enable/active，在
  TCP 80/8443 提供订阅 HTTPS 和 ACME HTTP-01，未占用 Xray 的 443。
- 订阅文件使用 VPS 内随机 token 路径，文件权限为 `caddy:caddy`、`0640`；真实订阅 URL 和
  token 不写入 checkpoint 或 Git。
- Reality 目标最终采用 `www.microsoft.com:443`，客户端 `serverName` 为
  `www.microsoft.com`；VPS 侧 TLS 校验和本机回落 smoke 通过。
- 从本机按 SSH alias 解析的主机执行 TCP 443 检查通过；订阅 HTTPS GET 返回 200，未知路径
  返回 404，Let’s Encrypt 证书已成功签发。

## 可恢复信息

- 运行配置：VPS `/etc/xray/config.json`。
- systemd unit：VPS `/etc/systemd/system/xray.service`。
- 仓库模板：`infra/vps/`。
- 回退时先保留 VPS 上当前配置和二进制备份，再按 `infra/vps/README.md` 中的显式 service
  停止/替换步骤操作；不得用仓库模板覆盖真实 secret。

## 已知事项

- VPS 曾有 `networking.service` 对不存在 `eth1` 的遗留引用；本次未修改，避免网络变更造成
  SSH 失联。
- Quantumult X 手机上的最终 Reality 握手尚未由此工作区执行，需要用户导入交付配置后验证。
