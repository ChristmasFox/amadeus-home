# Agent Runtime

这里保留当前 `pubg-query-engine-v3` 的完整 source-preserving 快照：Mastra workflow、PUBG Query/Review Domain、Telemetry Worker、Platform Adapter、WhatsApp 适配器和回归测试都在同一个 TypeScript package 中，以保持现有相对导入和部署行为。

后续可以按 `packages/*` 的 facade 边界渐进拆包；在拆包完成前，不要同时维护第二份实现。

## HomeHub V1

HomeHub 与 PUBG runtime 共用此进程，但 domain 实现位于 `packages/homehub-domain`，保持
服务注册、健康诊断、操作授权、上下文和审计逻辑的平台无关。HomeHub 请求通过下面的
端点访问：

- `GET /homehub/health`：检查 HomeHub 组件状态；
- `POST /homehub/route`：判断请求是否属于 HomeHub；
- `POST /homehub/query`：执行状态查询、诊断、确认式服务操作和媒体整理预览；
- `GET /homehub/telegram/polling`：提供 Telegram polling 诊断指标。

媒体整理只允许处理 `/Volumes/Avalon/downloads` 下明确指定的项目；默认只生成预览，
必须收到明确确认后才会备份并移动文件，禁止覆盖已有 `/Volumes/Avalon/media` 内容。
HomeHub 服务操作同样需要按服务风险等级确认，真实 credentials 和运行时数据不入库。

```sh
pnpm --filter @agent/agent-runtime typecheck
pnpm --filter @agent/agent-runtime test
```

从 monorepo 根目录构建容器：

    docker build -f apps/agent-runtime/Dockerfile -t local/pubg-query-engine-v3:dev .

容器部署使用 /DATA/AppData/pubg-query-engine-v3 的 data 和外部 secret file；
不要把 API key 写入 compose 或镜像。
