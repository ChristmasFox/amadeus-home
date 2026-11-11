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

## 9Router 公网入口（Tunnel + Access）

- 9Router 只通过 Tunnel 连接内部 `http://9router:20128`，不开路由器端口转发，不给 origin 开公网监听；
  Lab / OpenClaw 继续使用内部地址，不改走公网域名。
- DNS 用指向 `<tunnel-id>.cfargotunnel.com` 的已代理 CNAME；不要再使用指向公网 origin 的已代理 A 记录。
- 整个主机名由一个 self-hosted Access application 保护，使用可复用策略：
  1. 指定邮箱 + One-time PIN（浏览器控制台）；
  2. 指定 service token（API，请求头 `CF-Access-Client-Id` / `CF-Access-Client-Secret`）；
  默认拒绝，不为 `/v1/*` 设置 Bypass。
- 9Router 自己的登录密码和 API key 仍是第二层：通过 Access 之后，无 key 的 `/v1/*` 必须仍是 401。
- tunnel token 与 service token 只放仓库外的受限文件，不进 git、日志或报告。
