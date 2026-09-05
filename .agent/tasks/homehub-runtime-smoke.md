# HomeHub Runtime Smoke Test

这是 HomeHub V1 与 `/whoami` 代码阶段之后的目标环境人工任务，不是本地代码提交的阻塞项。

## 目标

在 OrbStack Linux machine `ubuntu` 的 CasaOS runtime 中验证 HomeHub endpoint、Telegram
polling 指标和真实入站分流；不要把 credentials 或运行时数据写入 Git。

## 步骤

1. [x] 在目标 Ubuntu 中执行对应 compose 的 dry-run/config 检查，确认镜像包含当前 Git commit。
2. [x] 在审阅 compose、备份和回滚点后，使用显式部署流程激活 runtime 镜像并安装 LangBot plugin。
3. [x] 检查 runtime `/healthz`、`/v3/whoami` 和 `scripts/doctor.sh`。
4. [ ] 使用明确的 Telegram/KOOK 入站消息验证 `/whoami`；不要用 bot 自发消息替代真实入站。
5. [x] 记录 CasaOS 容器状态、endpoint 返回和回滚信息到新的日期 checkpoint。

## 安全边界

- 不执行真实服务重启，除非人工明确确认并保留恢复窗口。
- 媒体整理只用测试下载项目验证预览和确认，不触碰现有 `/Volumes/Avalon/media` 文件。
- 所有 token、API key、`.env`、数据库数据和日志留在仓库外。
