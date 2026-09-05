# Telemetry Worker

当前 worker 实现位于 `apps/agent-runtime/src/review/telemetry.ts`，由 Mastra runtime 注入并按 `matchId + parserVersion + featureVersion` 读取/写入 Feature Store。这里提供可迁移的 app 边界 facade；后续独立进程化时只需把该实现移入本目录，不改变 Review 协议。
