# Post-Migration Tasks

这些是迁移完成后按需执行的运行时操作，不是本地仓库初始化的阻塞项：

- 在新 Mac mini 的 OrbStack ubuntu/CasaOS 中恢复 AppData 和外部 secrets；
- 重新创建 n8n credentials 并验证 Data Table、webhook 和 workflow active 状态；
- 构建目标架构可用的 LangBot 与 agent-runtime 镜像；
- 如启用 Cloudflare，创建 tunnel 并进行 ingress / DNS / TLS 验证；
- 运行 doctor.sh 和 Telegram、KOOK、WhatsApp 真实入站 smoke test。
