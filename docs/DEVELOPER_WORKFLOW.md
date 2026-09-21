# Developer Workflow

默认根据 Git 改动选择最低足够验证，不隐式重启或部署：

Operation Skuld storage work also uses the dedicated storage-runtime checks.
`storage-preflight.sh` and `migrate-immich-media.sh` are plan/verify first;
`--cutover`, maintenance `--apply`, scheduler installation, and source reclaim
are separate explicit operations. The external volume is identified by UUID
and sentinel, and migration never uses `rsync --delete`.

- FAST：文档、状态、脚本和纯逻辑；执行定向测试、typecheck、`git diff --check`。
- PUBG_DOMAIN_PLUGIN：`pnpm typecheck:pubg`、`pnpm test:pubg` 和 diff check。
- PRODUCT_RADAR：Product Radar 自己的 typecheck/tests；它不是 PUBG 依赖。
- RELEASE_BUILD_REQUIRED：只有明确发布时，才执行 secret scan、受影响的 commit-tagged
  ARM64 image build、传入 OrbStack ubuntu，再由 CasaOS `docker compose up -d --no-build`。
- OPENCLAW_RELEASE_CONFIG：使用 `scripts/deploy-openclaw.sh --apply`，该脚本负责
  checkpoint、迁移、停用旧 consumer 和 health/smoke。
- ENV_RECREATE_NO_BUILD：只重建外部配置，不构建镜像。

执行：

```sh
pnpm workflow:plan
pnpm workflow:verify
pnpm test:workflow
```

实际发布建议使用 `scripts/deploy-openclaw.sh --apply --build-auto`；配置/workspace-only
改动使用 `--apply --no-build`，脚本会检查 live image 是否仍覆盖当前业务 source。只有
明确需要完整两镜像 release 时才使用 `--apply --build`；`--full-verify` 可在选择性发布时
显式追加全量本地验证。

每次 `--apply` 都必须先通过 release version gate：当前根目录 `VERSION` 必须严格高于
live OpenClaw image source commit 中的版本；发布完成后脚本会用
`amadeus-release:<版本>` 写入 checkpoint 和生产 owner outbox，并等待 `.sent.json`。版本不递进
或通知未送达时，部署返回失败。

任何 Docker build、Compose 写入、停止服务、数据迁移都必须通过明确的 RELEASE/apply
入口；默认 dry-run。生产目标是 OrbStack `ubuntu` 的 CasaOS，不是 macOS host Docker。
