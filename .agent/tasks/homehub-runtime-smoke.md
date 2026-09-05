# HomeHub Runtime Smoke Test

这是 HomeHub V1 代码阶段之后的目标环境人工任务，不是本地代码提交的阻塞项。

## 目标

在 OrbStack Linux machine `ubuntu` 的 CasaOS runtime 中验证 HomeHub endpoint、Telegram
polling 指标和真实入站分流；不要把 credentials 或运行时数据写入 Git。

## 步骤

1. 先在目标 Ubuntu 中执行对应 compose 的 dry-run/config 检查，确认镜像包含当前 Git commit。
2. 仅在审阅 compose、备份和回滚点后，使用仓库规定的显式 `--apply` 或等价部署流程。
3. 检查 `GET /homehub/health`、`POST /homehub/route`、`POST /homehub/query`。
4. 使用明确的 Telegram/KOOK 入站消息验证 HomeHub 与 PUBG 分流；不要用 bot 自发消息替代真实入站。
5. 记录 CasaOS 容器状态、endpoint 返回和回滚信息到新的日期 checkpoint。

## 安全边界

- 不执行真实服务重启，除非人工明确确认并保留恢复窗口。
- 媒体整理只用测试下载项目验证预览和确认，不触碰现有 `/Volumes/Avalon/media` 文件。
- 所有 token、API key、`.env`、数据库数据和日志留在仓库外。
