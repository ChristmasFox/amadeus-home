# OpenClaw 部署构建优化

日期：2026-09-18（Asia/Shanghai）
状态：SOURCE_ONLY，尚未 apply 到 CasaOS

## 背景

旧入口的 `--build` 会同时构建 OpenClaw 和 Product Radar，并执行全量 build/typecheck/test。
这对 workspace、配置、Compose 或单一业务域改动都过重；而 `docker compose up -d --no-build`
本身并不会构建镜像，真正耗时来自 apply 前的全量验证和两个 BuildKit build。

## 实现

- `--apply --build-auto`：读取 live CasaOS 容器的 `git-<commit>-<timestamp>` image tag，
  按当前 Git 与该 commit 的路径差异决定是否构建 OpenClaw/Product Radar。
- `--apply --build-openclaw` / `--apply --build-radar`：只构建指定镜像。
- `--apply --no-build`：复用 live images；若业务 source 已超出对应 image commit，fail closed。
- `--apply --build`：保留为明确的全量双镜像 release，并执行全量验证。
- 未构建的服务仍执行 image inspect；所有 apply 继续使用 Compose `--no-build`，不在 CasaOS
  内重新构建。

## 受影响路径

- OpenClaw image：`plugins/pubg/**`、`plugins/amadeus/**`、`packages/pubg-domain/**`、
  OpenClaw Dockerfile、root package metadata。
- Product Radar image：`apps/product-radar/**`。
- workspace、SOUL/AGENTS、OpenClaw config、Compose、部署脚本和文档不触发镜像 rebuild。

## 验证

本 checkpoint 由源码修改和本地 dry-run 验证组成；没有执行 CasaOS apply、镜像构建、服务重启
或外部状态迁移。

## 本地验证结果

- `bash -n scripts/deploy-openclaw.sh scripts/developer-workflow.sh scripts/test-developer-workflow.sh`：PASS
- `pnpm workflow:plan`：PASS，识别为 `OPENCLAW_RELEASE_CONFIG`
- `pnpm test:workflow`：PASS
- `pnpm check:secrets`：PASS
- `git diff --check`：PASS
- `deploy-openclaw.sh --dry-run`、`--dry-run --build-auto`、`--dry-run --build-openclaw`、
  `--dry-run --no-build`：PASS
- 当前 CasaOS image（只读 inspect）：OpenClaw 和 Product Radar 都是
  `local/*:git-5fd139d3e58d-20260918081806`；从该 commit 到当前树没有 image-owned path
  变化，因此本轮优化按 `--build-auto` 会复用两个镜像。
