# Kurisu Agent P6 checkpoint

日期：2026-09-16（Asia/Shanghai）
状态：P6 `LOCAL_COMPLETE / BRIEFING_BLOCKED / L3_BLOCKED`
实现提交：`24946b9`

## 范围与安全边界

- 完成 P6 本地集成验收、反偏离检查和 Release 准备；没有 CasaOS compose 写入、Docker build/transfer/restart、LangBot API 安装、n8n DB 写入或 Telegram/KOOK 真实消息。
- canonical runtime 仍是 OrbStack `ubuntu` 内的 CasaOS；P7 未授权。
- 真实 LangBot native-agent WebSocket/platform L2/L3 继续 blocked：没有合法 user/support-admin session token。P2 当前 9Router provider trace 是 provider evidence，不替代 L3。
- briefing scheduler/生成/投递 producer 仍未发现，沿用 P5 `BLOCKED_UNSUPPORTED`。

## P6 实现

- `apps/agent-runtime/tests/kurisu-acceptance.test.ts`：101 条结构化 L2 变体，60 条独立失败改写，记录 `caseId/revision/layer/modelRoute/configFingerprint/inputFixture/expectedInvariants/actualToolCalls/result/evidenceRefs`，并记录执行时间、耗时、失败原因；A16 dummy battery 仅测试注册。
- `scripts/smoke-kurisu-http.sh`：启动隔离本地 server，验证 `/healthz`、`/kurisu/status`、`/kurisu/tools`、`/kurisu/tool-call` 的实际 `server.ts` 前门。
- `scripts/verify-kurisu-r01.mjs`：9 项 R01 静态反偏离检查，覆盖单一结构化 Tool、无关键词先路由、无第二 Agent、无通用 shell、无伪完成和 dummy registration。
- `scripts/verify-kurisu-release-dry-run.sh`：组合 Runtime/LangBot/backup/restore dry-run；不传入 apply。
- `apps/agent-runtime/kurisu.env.example`：外部 secret/config 模板，默认通知、写工具、Codex 均关闭。
- `scripts/backup-kurisu-state.sh` / `scripts/restore-kurisu-state.sh`：只针对 `/DATA/AppData/pubg-query-engine-v3/data/state.json.kurisu.sqlite`，默认 dry-run，apply 前备份远端状态。
- `docs/runbooks/KURISU_AGENT_ROLLBACK.md`：入口/镜像/plugin/config/owner/worker/在途写任务回滚顺序。

## 证据

- `docs/reports/KURISU_AGENT_P6_ACCEPTANCE.json`：`LOCAL_ACCEPTANCE_PASS`，101 条、60 条 failure-derived；中位耗时 `0.233ms`、P95 `0.544ms`，model calls `0`、tool calls `101`；明确 layer 为结构化 L2 fake-backend，本地报告不冒充 L3。
- `docs/reports/KURISU_AGENT_P6_R01.json`：`R01_PASS`，9/9 checks。
- `docs/reports/KURISU_AGENT_P6_RELEASE_DRY_RUN.md`：`R02_PASS`，明确 `MUTATION=none`，列出 Runtime compose、`local/kurisu-gateway@0.1.0`、配置与精确 state backup/restore。
- `pnpm --filter @agent/agent-runtime exec tsx --test` 的 9 个 Kurisu 测试：`50/50 PASS`。
- `pnpm --filter @agent/product-radar test`：`53/53 PASS`；两个 package typecheck：PASS。
- LangBot plugin unittest：`4/4 PASS`；Python compile：PASS；`pnpm check:secrets`、`git diff --check`：PASS。
- 全量 `pnpm --filter @agent/agent-runtime test` 已有界复测：前序用例通过，但在 `review-v3-2.test.ts` 子进程后 10 秒无新增输出；已终止本次自有测试树且确认无残留。记录为 `KNOWN_HANG / NOT_FULL_PASS`。

## 恢复与下一步

- 代码恢复点：`24946b9`；P6 reports/state/checkpoint 随后提交的 Git commit 也必须保留。
- 不要把已知 full-suite hang、缺少 native session、旧 EventListener 或 briefing producer 写成完成；解除条件和 P7 授权见 `.agent/tasks/2026-09-16-kurisu-agent-p7-release.md`。
- 如进入 P7，先执行 runbook 的 dry-run 和 Kurisu state backup，再按单独授权的管理员 Telegram DM 灰度；KOOK 老入口保持原权限和路径。
