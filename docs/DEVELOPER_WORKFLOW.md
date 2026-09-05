# Developer Workflow Optimization V1

更新时间：2026-09-05（Asia/Shanghai）

本规范只改变开发、验证、镜像构建与部署操作方式；不拆分共享的
`agent-runtime`，不改变 HomeHub / PUBG 业务协议、HTTP 行为或 CasaOS 的持久化数据。

## 入口与默认原则

先让仓库按当前 Git diff 选择**最低足够**的验证等级：

```sh
pnpm workflow:plan
# 或：./scripts/developer-workflow.sh --plan
```

`./scripts/developer-workflow.sh --run` 只会执行 FAST/RUNTIME 的本地检查，绝不会执行
Docker build、Compose restart 或 CasaOS 部署。需要在提交前扫描 secrets 时显式增加
`--check-secrets`。`--files` 可用于确定性检查某组路径，例如：

```sh
./scripts/developer-workflow.sh --files packages/homehub-domain/src/index.ts
./scripts/developer-workflow.sh --files docs/ARCHITECTURE.md
```

若一次 diff 同时命中多个类别，脚本选择最高需要的主流程，同时输出 LangBot 的附加工作流标记。
未识别路径默认保持 FAST，并列出 `UNKNOWN_PATHS` 供人工确认；它们不会自动升级为 Docker
build 或部署。

## FAST / RUNTIME / RELEASE

| 级别 | 典型 scope | 默认验证 | 明确禁止的默认动作 |
| --- | --- | --- | --- |
| **FAST** | `docs/**`、`.agent/**`、测试、skills、纯逻辑/小功能 | 定向测试、受影响 package typecheck、`git diff --check`；需要时 secrets scan | Docker build、Compose restart、CasaOS deploy |
| **RUNTIME** | `apps/agent-runtime/src/**`、`packages/homehub-domain/src/**`，以及 runtime schema/team/tsconfig | 受影响 runtime/domain build 或 typecheck、映射后的定向测试、`scripts/smoke-agent-runtime.sh`、`git diff --check` | production Docker image build、Compose restart、CasaOS deploy |
| **RELEASE** | 明确要求实际发布，或 Docker/package/lockfile 等 build 输入变更 | 完整 release 序列 | 省略显式 `--apply` 的外部写入 |

**HomeHub 或 runtime TypeScript 源码变更只进入 RUNTIME，不会因为共享
`local/pubg-query-engine-v3` 镜像名称而自动进入 RELEASE。**

### 特殊 scope

| 路径 | 工作流 | 镜像行为 |
| --- | --- | --- |
| `apps/agent-runtime/Dockerfile`、`.dockerignore`、任意 `package.json`、`pnpm-lock.yaml` | `RELEASE_BUILD_REQUIRED` | 只在明确 RELEASE 中构建 runtime image |
| `integrations/langbot/plugins/**` | LangBot plugin workflow | `scripts/deploy-langbot.sh --dry-run` 后才可显式 `--apply`；不构建 runtime image |
| `integrations/langbot/patches/**` | LangBot image workflow | 先 `--dry-run --patches`；只有显式 `--apply --patches --activate-image` 才构建 LangBot image |
| 仅 `.env*` / `*.env*` | `ENV_RECREATE_NO_BUILD` | 只允许显式 `docker compose up -d --no-build` 的配置重建 |
| CasaOS/Compose 模板或 `scripts/deploy-agent-runtime.sh` | `RELEASE_CONFIG_NO_BUILD` | 显式应用配置后仍使用 `--no-build` |

## RUNTIME 本地 smoke

`scripts/smoke-agent-runtime.sh` 以临时本地进程启动 runtime，默认使用
`127.0.0.1:15310`，验证：

- `GET /healthz`
- `GET /homehub/health`

它不使用 Docker、不重启 CasaOS，也不写入 production state。可通过
`AGENT_RUNTIME_SMOKE_PORT` 覆盖端口。

## Explicit RELEASE

实际部署只能通过显式命令触发：

```sh
# 默认仅打印计划；不会 build 或接触 CasaOS。
./scripts/deploy-agent-runtime.sh --dry-run

# 已有目标镜像的显式 no-build recreate。
./scripts/deploy-agent-runtime.sh --apply --image local/pubg-query-engine-v3:git-<commit>

# 唯一允许创建新 runtime image 的脚本路径：
./scripts/deploy-agent-runtime.sh --apply --build
```

`--apply --build` 要求 Git 工作树与暂存区均干净，并严格执行：

1. `git diff --check`；
2. `pnpm test`；
3. `pnpm check:secrets`；
4. 使用 host 的 `docker buildx build --load` 构建 `local/pubg-query-engine-v3:git-<12-char-commit>`；
5. `docker save | orb -m ubuntu -u root docker load` 把 immutable commit-tag image 传入 Ubuntu；
6. 备份 CasaOS compose 中的 image 行、更新 image；
7. `docker compose up -d --no-build`；
8. `/healthz` 与 `/homehub/health`；
9. 输出 compose 备份路径，随后在仓库写 deployment checkpoint 与回滚说明。

因此 Ubuntu/CasaOS 只加载并运行已构建的 image，不会因 `compose up` 隐式执行 production
build。当前 Ubuntu Docker 为 28.2.2，但未安装 `docker buildx` CLI；host Docker 28.5.2 /
Buildx 0.29.1 是本流程的现代 BuildKit builder。没有引入 CI、registry remote cache 或长期
host Docker 服务。

若本机 Docker 客户端配置了指向容器内不可达的 loopback proxy，可在明确 RELEASE 时附加
`--no-proxy`；该开关只把 build args 置空，不会写入任何 proxy 或 credential。

## Dockerfile cache 与 runtime layer

`apps/agent-runtime/Dockerfile` 现在按以下顺序构建：

```text
workspace manifests + pnpm-lock
→ pnpm install（BuildKit cache mount: /pnpm/store）
→ tsconfig / domain source / runtime source / runtime assets
→ pnpm build
→ pnpm deploy --prod + dist/assets
→ COPY --chown 到最终 node runtime image
```

关键不变量：一般 HomeHub / Runtime TS source 只会使 source、build、deploy 层失效；
`pnpm install` layer 保持命中。`pnpm deploy` 使用同一个只在 BuildKit 中存在的 store cache，
不会把 store 带入 final image。

最终 stage 使用 `COPY --chown=node:node --from=build /prod/ ./`，并只创建归属 `node` 的
`/data`。这消除了之前 `chown -R node:node /app /data` 对完整 `/app` 造成的大层重写。
`.dockerignore` 也排除了 `.local/` 和 macOS `.DS_Store`。

## 2026-09-05 Benchmark（host BuildKit，非部署）

所有镜像均只在 macOS Docker builder 生成，未加载到 CasaOS、未重启服务。为绕过本机 Docker
配置中失效的 `127.0.0.1:7897` proxy 注入，测试命令显式传入空 proxy build args；网络冷启动
耗时本身会波动，因此结论以“单一 HomeHub TS 文件改动”是否重跑 install 为准。

| 场景 | 总耗时 | `pnpm install` | 结果 |
| --- | ---: | ---: | --- |
| 原 Dockerfile，首次 build | 78.16s | 44.0s | baseline |
| 原 Dockerfile，临时改动一个 `packages/homehub-domain/src/index.ts` 文件 | 132.25s | 114.0s，重新下载/安装 | source copy 在 install 前，cache 失效 |
| 新 Dockerfile，首次填充 BuildKit pnpm store | 129.73s | 106.8s | 冷网络受 registry 波动影响 |
| 新 Dockerfile，连续不改源第二次 build | 0.34s | `CACHED` | 所有可复用层命中 |
| 新 Dockerfile，临时改动同一个 HomeHub TS 文件 | 22.37s | `CACHED` | 仅 build/deploy/final copy 重跑 |

针对实际痛点的可比 source-change 构建由 132.25s 降至 22.37s（**83.1%**），并且日志明确显示
`RUN ... pnpm install ...` 为 `CACHED`。最终镜像从 474,477,455 bytes 降至 360,758,644 bytes，
减少 113,718,811 bytes（**24.0%**）；容器内 `/healthz` 与 `/homehub/health` smoke 均通过。

## Remaining risks

- BuildKit cache 是 builder-local cache；清理 Docker builder 或更换机器后首个 build 必须重新填充。
- 当前 CasaOS Ubuntu 没有 Buildx CLI，因此不要在其中直接运行这个使用 cache mount 的 Dockerfile；
  使用脚本的 host BuildKit build + image transfer 路径。
- benchmark 的冷网络时间受 npm registry、proxy 与缓存状态影响，不把首次 build 的绝对秒数当成 SLA。
- 本阶段没有执行 `--apply`，故 production runtime image、CasaOS compose、运行容器与业务行为均未改变。
