# Checkpoint: Developer Workflow Optimization V1

日期：2026-09-05（Asia/Shanghai）
Branch：`main`
开始基线 commit：`ac1c7eb`（`docs: enforce default goal budget rules`）
完成 commit：本 checkpoint 所在的提交（不执行公网 push）

## 完成内容

- 新增 `scripts/developer-workflow.sh`，基于 Git diff/untracked files 自动输出最低足够的
  `FAST`、`RUNTIME` 或显式 `RELEASE` 流程，并识别 Docker/package/lockfile、LangBot plugin/patch、
  env-only 与 CasaOS config scope。
- FAST/RUNTIME 的 `--run` 只执行本地 `git diff --check`、受影响 package typecheck/build、定向 tests
  和（RUNTIME）非 Docker endpoint smoke；代码路径中没有 Docker build、Compose restart 或 CasaOS deploy。
- 新增 `scripts/smoke-agent-runtime.sh`，临时启动 source runtime，验证 `/healthz` 与
  `/homehub/health` 后停止进程。
- 新增 `scripts/deploy-agent-runtime.sh`：默认 dry-run；普通 apply 只运行
  `docker compose up -d --no-build`。只有干净、已提交 source 的 `--apply --build` 才执行 tests、secret
  scan、host Buildx immutable commit-tag image build、`docker save | orb ... docker load`、compose image
  update、health/smoke 与 remote compose backup。
- `apps/agent-runtime/Dockerfile` 已重排为 manifest/lockfile -> cached `pnpm install` -> source -> build/
  deploy，使用 BuildKit `/pnpm/store` cache mount；final stage 改用 `COPY --chown`，避免 `chown -R /app`
  大 layer 重写。
- 新增 `docs/DEVELOPER_WORKFLOW.md`、repository `developer-workflow` skill，并更新 `AGENTS.md`、release
  skill、README、architecture 和状态文档。

## 验证

- `pnpm test:workflow`：通过；覆盖 HomeHub source -> RUNTIME/no Docker、docs -> FAST/no Docker、
  Dockerfile -> RELEASE build required、env-only -> `--no-build` recreate、LangBot plugin/patch 分流，以及
  fake OrbStack 下 deploy `--apply` 命令包含 `docker compose up -d --no-build`。
- `./scripts/developer-workflow.sh --run --files packages/homehub-domain/src/index.ts`：通过；domain build、
  18 项 HomeHub/`/whoami` 定向 tests、local `/healthz` 和 `/homehub/health` smoke 均通过，未执行 Docker。
- `pnpm typecheck`、`pnpm build`：通过。
- `pnpm test`：101 tests，100 pass、1 skip、0 fail。
- `pnpm check:secrets`、`git diff --check`：通过。
- 所有新增/修改 Bash 脚本通过 `bash -n`；新 skill 的官方 Python quick validator 因本机缺少 PyYAML
  无法启动，已使用 Ruby YAML 对等检查 frontmatter、名称、描述、允许字段和 TODO 条件，通过。
- optimized image 容器内 `/healthz` 与 `/homehub/health` smoke：通过；未接触 CasaOS。

## BuildKit benchmark（host Docker，非部署）

| 场景 | 总耗时 | `pnpm install` |
| --- | ---: | ---: |
| 原 Dockerfile，单一临时 HomeHub TS source 改动 | 132.25s | 114.0s，重新执行 |
| 新 Dockerfile，同一临时 source 改动 | 22.37s | `CACHED` |
| 新 Dockerfile，无 source 改动的连续 build | 0.34s | `CACHED` |

source-change 路径缩短 83.1%。final image 从 474,477,455 B 降至 360,758,644 B（-113,718,811 B / -24.0%）。
冷网络 build 受 npm registry 和本机 Docker loopback proxy 配置影响，故不将首次 build 秒数视为 SLA。

## Runtime / Deployment 状态

- 未调用 `scripts/deploy-agent-runtime.sh --apply`。
- canonical OrbStack `ubuntu` / CasaOS 的运行容器、compose、外部 env、数据和 active image 均未改变；
  仍保持既有 runtime `local/pubg-query-engine-v3:3.3.4-admin-03b0e41`。
- 目标 Ubuntu Docker 28.2.2 当前未安装 Buildx CLI；RELEASE 设计为 host Docker 28.5.2 / Buildx 0.29.1
  构建并 transfer image，避免 Ubuntu compose 触发 production build。

## Remaining Risks / Next Step

- BuildKit cache 是 builder-local；清理 builder 或换机器后必须重新填充。
- 真正 RELEASE 后仍必须把 image tag、remote compose backup、health/smoke 和回滚命令写入新的 deployment
  checkpoint。
- 既有真实 Telegram/KOOK `/whoami` 入站烟测仍在 `.agent/tasks/homehub-runtime-smoke.md`，与本阶段无关。
- 本阶段无代码后续任务；如需回滚本优化，revert 包含本 checkpoint 的 completion commit 即可恢复原 Dockerfile
  层次和工作流文档。
