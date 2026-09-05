# Cloudflare Tunnel

当前运行时检查没有发现 cloudflared tunnel 容器；这里只保存可迁移模板，不保存
tunnel ID、token、credentials JSON 或域名 private key。

迁移步骤：

1. 在 Cloudflare 创建或恢复 tunnel；
2. 把 credentials JSON 放到 Ubuntu 的受限路径，例如 /DATA/AppData/cloudflared/；
3. 使用 tunnel-config.example.yml 替换 hostname 和内部 service；
4. 通过目标 CasaOS/Ubuntu 运行 compose；
5. 用 cloudflared tunnel info、curl 和 scripts/doctor.sh 验证。

若使用 token 模式，token 只能通过外部 env 注入 docker compose，不能写入模板。
