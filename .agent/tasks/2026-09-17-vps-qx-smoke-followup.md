# Quantumult X 端到端验证

状态：待用户在手机 Quantumult X 中导入交付节点后执行。

验证内容：

- 导入 `infra/vps/proxy/config.example.quantumult-x.conf` 对应的已填充节点。
- 确认 Reality public key、short ID、serverName 和 Vision flow 与交付值一致。
- 使用手机网络发起一次实际连接，验证 DNS、HTTPS 和需要的个人应用流量。

服务端配置测试、systemd 状态、TCP 2053 监听、本机 TLS 回落和外部 TCP 连通性已经通过；
订阅服务端的 `qx.conf` 和 `server.snippet` 均已通过 HTTPS GET 返回 200，仓库不保存已填充
的客户端节点或任何真实凭据。若 QX 对旧 `qx.conf` 仍提示“内容无效”，优先用同一 token
下的 `server.snippet` 地址重试，并保持资源解析器关闭。
