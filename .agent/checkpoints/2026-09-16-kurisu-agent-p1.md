# Kurisu Agent P1 checkpoint

日期：2026-09-16（Asia/Shanghai）
状态：IMPLEMENTED / VERIFIED_LOCAL
基线：`2e38cbf`（P0）

## 本阶段交付

- `apps/agent-runtime/src/kurisu/`：`kurisu.v1` inbound/tool/result/context 契约、稳定 principal/session key、server-derived trusted context、ToolRegistry/schema/timeout/policy、Gateway rollout/dedup/callback binding、SQLite WAL/migration、task intent/lease/reconcile/cancel、approval exact-argument binding、media allowlist/backup-before-move、PUBG/HomeHub/Radar structured adapters。
- `apps/agent-runtime/src/kurisu/service.ts` 和 `src/server.ts`：`GET /kurisu/tools`、`GET /kurisu/status`、`POST /kurisu/inbound`、`POST /kurisu/callback`、`POST /kurisu/tool-call`。默认 session rollout 为 legacy；默认 authorization 为只读。
- `integrations/langbot/plugins/kurisu-gateway/`：仅 `Tool` component，通过 `toolName + input + hostContext` 调用 runtime；没有 EventListener/Command，不创建第二个 Agent。
- `scripts/deploy-langbot.sh`：允许显式 `--plugin kurisu-gateway`，不加入 `all` 生产集合。

## 验证证据

- `pnpm workflow:plan`：RUNTIME；Docker build forbidden；LangBot plugin workflow required。
- `pnpm --filter @agent/agent-runtime typecheck`：通过。
- Kurisu runtime targeted tests：18/18 通过；覆盖 stable identity、callback binding/replay、structured adapters、persistent duplicate、tool policy、SQLite、task crash/reconcile、lease/cancel、approval、media path。
- `python3 -m unittest discover -s integrations/langbot/plugins/kurisu-gateway/tests`：2/2 通过；`python3 -m py_compile` 通过。
- `scripts/deploy-langbot.sh --plugin kurisu-gateway --dry-run --skip-runtime-check`：package dry-run 通过，未安装/重启/写 CasaOS。
- 本地 endpoint smoke：`/kurisu/tools` 返回 contract `kurisu.v1` 与 12 tools；`/kurisu/status` 返回 session-opt-in legacy；`/kurisu/tool-call` 对无 backend 返回 `CAPABILITY_UNAVAILABLE`。
- `pnpm check:secrets`、`git diff --check`：通过。

## 边界与回滚

- 未执行 LangBot API install、Pipeline 修改、CasaOS compose、Docker build、生产数据库写入或真实 Telegram/KOOK 消息。
- P0 已知阻塞仍有效：合法 LangBot user/support-admin session token 缺失，因此 native-agent WebSocket/platform L2/L3 未宣称通过；旧 EventListener 尚未迁移。
- 如本阶段需要回退，恢复 P0 commit `2e38cbf`；本阶段未触碰外部 runtime 状态。

## 下一阶段

P2 接入现有 PUBG deterministic runtime、HomeHub/Radar 只读 facade 与真实 9Router 工具轨迹；所有业务工具继续使用 fake/隔离数据验证，不启动生产写操作。
