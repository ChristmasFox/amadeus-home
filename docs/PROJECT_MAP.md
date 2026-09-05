# Project Map

本文件是进入仓库后的快速导航。详细运行拓扑见 `docs/ARCHITECTURE.md`，阶段事实见
`docs/PROJECT_STATE.md`。

## 请求路径

```text
Telegram / KOOK / WhatsApp
        -> LangBot adapters and custom plugins
        -> apps/agent-runtime
        -> deterministic PUBG/domain/review logic
        -> n8n gateway and workflows
        -> platform renderer / reply
```

LLM 只负责 planner、解释和边界转换；domain、状态、协议校验和排序保持 deterministic。

## 目录责任

| 路径 | 责任 | 运行时边界 |
| --- | --- | --- |
| `apps/agent-runtime` | Mastra/PUBG runtime、Telemetry、review、平台 adapter | CasaOS `pubg-query-engine-v3` |
| `apps/telemetry-worker` | Telemetry 对外 facade | 当前嵌入 agent runtime |
| `apps/whatsapp-adapter` | WhatsApp webhook/send facade | 当前实现保留在 agent runtime |
| `packages/contracts` | 跨 app/plugin 契约 | TypeScript workspace |
| `packages/platform-core` | identity、capability、message、renderer 抽象 | platform-neutral |
| `packages/pubg-domain` | PUBG domain 与 V2 回滚实现 | 不依赖聊天平台 |
| `packages/presentation` | 跨平台展示边界 | adapter/renderer 使用 |
| `integrations/langbot/plugins` | 自定义 LangBot plugin source | `.lbpkg` 通过 LangBot API 安装 |
| `integrations/langbot/patches` | 第三方 LangBot build-time patch | 只进入定制镜像，不直接改容器 |
| `integrations/n8n/workflows` | n8n JSON source of truth | 在线实例导入后重绑 credentials |
| `infra` | 脱敏 Compose、Cloudflare、Mac mini 模板 | 不自动覆盖 CasaOS |
| `scripts` | bootstrap、doctor、backup、restore、部署和检查 | 操作需显式确认 |
| `docs` | 架构、状态、决策、清单和历史归档 | Codex 启动上下文 |
| `.agent` | tasks、state、checkpoints | 不依赖聊天历史 |
| `skills` | 可迁移 Codex skill source | 按需复制/链接到 `$CODEX_HOME/skills` |

## 修改映射

- 改 runtime 行为：先改 `apps/agent-runtime` 或对应 package，再更新测试和状态文档。
- 改 LangBot：改插件 source 或 patch；插件使用 `scripts/build_*` / `scripts/deploy-langbot.sh`，patch 重新构建镜像。
- 改 n8n：在 `integrations/n8n/workflows/` 提交导出的 JSON，不提交 credentials。
- 改部署：优先改 `infra/` 模板；真实 CasaOS 只在明确 `--apply` 后由脚本操作。
- 改迁移/恢复：同步 `scripts/`、README、`docs/PROJECT_STATE.md` 和 checkpoint。

## Codex 状态入口

新会话先读取根 `README.md`、`docs/ARCHITECTURE.md`、`docs/PROJECT_STATE.md`、
`docs/CURRENT_TASK.md`、`.agent/state.md`，再检查 `git status` 和 `git log -5`。
