# Agent Runtime

这里保留当前 `pubg-query-engine-v3` 的完整 source-preserving 快照：Mastra workflow、PUBG Query/Review Domain、Telemetry Worker、Platform Adapter、WhatsApp 适配器和回归测试都在同一个 TypeScript package 中，以保持现有相对导入和部署行为。

后续可以按 `packages/*` 的 facade 边界渐进拆包；在拆包完成前，不要同时维护第二份实现。

```sh
pnpm --filter @agent/agent-runtime typecheck
pnpm --filter @agent/agent-runtime test
```

从 monorepo 根目录构建容器：

    docker build -f apps/agent-runtime/Dockerfile -t local/pubg-query-engine-v3:dev .

容器部署使用 /DATA/AppData/pubg-query-engine-v3 的 data 和外部 secret file；
不要把 API key 写入 compose 或镜像。
