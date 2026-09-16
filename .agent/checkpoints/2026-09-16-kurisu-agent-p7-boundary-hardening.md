# Kurisu P7 前置：POST 边界与宿主端口硬化

- 日期：2026-09-16（Asia/Shanghai）
- 问题：Runtime 的 `5310` 端口此前发布到所有宿主接口；`/kurisu/inbound`、`/kurisu/callback`、`/kurisu/tool-call` 仅校验 JSON，没有调用方认证。
- 修复：三个 Kurisu POST 入口统一要求 `X-Kurisu-Gateway-Secret`；secret 未配置返回 `503`，错误 secret 返回 `401`。LangBot gateway 从外部环境/secret file 读取同一 secret 并发送该 header。Runtime Compose 与 CasaOS 模板的宿主端口改为 `127.0.0.1`，容器间 `langbot_network` 访问保持不变。
- 验证：agent-runtime 全量 `181 passed / 0 failed / 1 skipped`；Kurisu HTTP smoke 验证未授权 `401` 与授权请求继续到达结构化前门；Kurisu plugin `4/4`；Python compile、secret scan、diff check 通过。
- 发布边界：本 checkpoint 完成时尚未重建/重启 CasaOS；需要下一阶段以 immutable image 部署并核对 live port binding。未安装插件、未切换 rollout、未发送平台消息。
- 配置前提：gateway secret 只允许放在 `/DATA/AppData/pubg-query-engine-v3/secrets/` 等仓库外位置；不要写入 Git、镜像或聊天记录。插件安装前必须把同一外部 secret 挂载到 LangBot plugin runtime。
- 回滚：部署时保留 compose backup；代码回滚到上一个 immutable image 可恢复旧 Runtime，但不建议恢复未认证的公开宿主端口。
