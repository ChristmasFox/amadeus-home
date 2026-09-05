# Project State

更新时间：2026-09-05（Asia/Shanghai）

## 状态

Monorepo 迁移阶段已完成，当前仓库可以作为代码、配置模板、workflow、文档和
Codex 状态的 Git source of truth。尚未执行公网 push，也没有把运行时数据或真实
credentials 放入仓库。

## 当前运行时观察

以下信息来自本机 Ubuntu/CasaOS 的只读检查，用于迁移基线，不是新机器的硬编码地址：

| 组件 | 当前观察 |
| --- | --- |
| OrbStack machine | ubuntu running |
| LangBot | langbot + langbot_plugin_runtime，兼容 LangBot 4.10.8 定制镜像 |
| Mastra/PUBG runtime | pubg-query-engine-v3，镜像 local/pubg-query-engine-v3:3.3.2-whatsapp-20260905-3，healthy，端口 5310 |
| Telemetry | 嵌入 runtime，parser telemetry-parser-4 |
| Review | feature version review-features-4 |
| n8n | n8n running，主机端口 5679 |
| n8n sandbox | compose 已存在，TLS/data 在 /DATA/AppData/n8n-sandbox |
| Postgres / Redis | 当前 Ubuntu 可观察到共享服务；n8n 是否使用 Postgres 需以恢复后的 env 和连接测试为准 |
| Cloudflare Tunnel | 当前容器列表未发现 tunnel；仓库只提供配置模板和检查逻辑 |

Runtime 的 PUBG API key 使用 /run/secrets/pubg_api_key 文件注入；仓库只保存
secret file 路径和空的环境变量，不保存 key。

## 已归档

- Mastra/PUBG V3 runtime、Telemetry、Platform Adapter、WhatsApp 和测试；
- PUBG V2 Python domain、V2 LangBot plugin 和 legacy workflow；
- LangBot V3/V2、organize-emby、macOS NAS control 自定义插件；
- KOOK、Telegram polling、消息转换、PUBG picker、WhatsApp patch/resource；
- n8n V3/V2、PUBG daily stats、organize-emby workflow；
- CasaOS 架构与平台适配历史文档的脱敏归档；
- bootstrap、doctor、backup、restore、secret scan 和插件构建脚本；
- workflow / plugin / service 兼容说明以及 Codex checkpoint。

## 已验证的边界

- 第三方 LangBot 本体没有复制进仓库。
- node_modules、dist、__pycache__、.pyc、.lbpkg、日志和业务数据未纳入 Git。
- 原始 9router / aria2 compose 中的真实密钥没有迁移，只生成脱敏模板。
- 共享 media、下载目录、Postgres、n8n data、LangBot data 与 Redis 都与 Git 分离。
- 新机器恢复路径是 clone -> 恢复 secrets -> bootstrap -> 恢复数据 -> 启动 -> doctor。

## 待人工完成的运行时动作

这些不是 Git 迁移缺口，而是每台新机器必须按实际环境完成的操作：

1. 在密码管理器中恢复 LangBot、n8n、PUBG、9router、aria2 和 Cloudflare secrets。
2. 在 n8n 重新创建 credentials，导入 workflow，并确认 Data Table / webhook 映射。
3. 如启用 Cloudflare，创建 tunnel、放置 credentials file，并按模板配置 ingress。
4. 构建与发布目标架构可用的 runtime / LangBot 定制镜像。
5. 启动后运行 scripts/doctor.sh 和真实平台入站烟测；不要用 bot 自发消息替代真实入站验证。

## 下一步建议

后续开发应先读取 README.md、本文、docs/CURRENT_TASK.md、.agent/state.md，
再查看 Git 状态和最近五次提交。若修改部署，优先修改 infra/docker/ 模板或
实际 CasaOS compose，并同步更新本文件和 checkpoint。
