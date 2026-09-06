# PUBG Review V1 deployment follow-up

状态：待用户显式要求 RELEASE（source implementation 已完成；本阶段不部署）。
创建：2026-09-06（Asia/Shanghai）

## 上线前检查

1. 确认仓库 clean 并再次执行 `pnpm test`、`pnpm check:secrets`、`pnpm build`、`./scripts/smoke-agent-runtime.sh`。
2. 使用 `scripts/deploy-agent-runtime.sh --plan` 生成 runtime image/build/compose 计划；如需新镜像，显式使用 `--apply --build`，并使用 immutable commit tag。
3. 在本机先执行 `./scripts/build_pubg_v3_plugin.sh` 和 `./scripts/deploy-langbot.sh --dry-run`，确认 `pubg-stats 3.3.0` 包 hash。
4. 从 Git source 导入 `integrations/n8n/workflows/pubg-data-gateway-v3.workflow.json`，保留在线 workflow rollback；credentials 不从仓库恢复。
5. 将 runtime compose 更新到 OrbStack `ubuntu` 的 CasaOS canonical path，执行 `docker compose up -d --no-build`，不在 macOS host Docker 部署持久服务。
6. 通过真实 `/v3/query` 复测 Match ID `d8c41c10-de9f-40b4-ac88-ede0ab554a31`、默认复盘、Telegram/KOOK fallback 和 callback；验证 features cache 使用 `telemetry-parser-5` / `review-features-5`。
7. 通过 LangBot Plugin API 安装 `pubg-stats 3.3.0`，记录 task、active plugin runtime 和 rollback package。
8. 部署后更新 `docs/CURRENT_TASK.md`、`docs/PROJECT_STATE.md`、`.agent/state.md` 与新的 deployment checkpoint，保留 runtime/plugin/n8n rollback evidence。

## 当前边界

- 本阶段未修改 CasaOS compose、生产 runtime image、在线 n8n workflow 或 LangBot 安装状态。
- 真实 PUBG telemetry 与 secrets 不入 Git；调试原始数据仅在仓库外临时路径使用。
