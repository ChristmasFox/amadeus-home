# OpenClaw PUBG 重构计划交付

状态 READY_TO_IMPLEMENT，仅文档变更。

已读取仓库启动规则、旧目标及状态、PUBG facade、query-engine、review-facts、team/chicken-index 和 n8n 数据生成器；发现 Domain 反向依赖 Runtime、PUBG 数据仍依赖 n8n、旧目标与最新用户决定冲突。新增 docs/OPENCLAW_PUBG_REFACTOR_GOAL.md，并同步目标指向，保留历史记录。

新目标：OpenClaw 唯一主 Agent + 一个原生 PUBG 插件 + 独立 Domain + 官方 API/SQLite。取消灰度/双栈；一次性迁移及旧依赖清理；不扩展其他业务插件。计划已包含工具接口、数据覆盖/指标口径、非本轮 producer 停用、版本核验、精简真实验收和可复制 Goal。

本轮没有修改业务源码、构建或部署。下一步在目标机按计划执行 S0–S4，不能复用旧平台验收结果冒充新架构完成。
