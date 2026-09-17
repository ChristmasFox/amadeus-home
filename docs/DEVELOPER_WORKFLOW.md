# Developer Workflow

默认根据 Git 改动选择最低足够验证，不隐式重启或部署：

- FAST：文档、状态、脚本和纯逻辑；执行定向测试、typecheck、`git diff --check`。
- PUBG_DOMAIN_PLUGIN：`pnpm typecheck:pubg`、`pnpm test:pubg` 和 diff check。
- PRODUCT_RADAR：Product Radar 自己的 typecheck/tests；它不是 PUBG 依赖。
- RELEASE_BUILD_REQUIRED：只有明确发布时，才执行 secret scan、commit-tagged ARM64
  image build、传入 OrbStack ubuntu，再由 CasaOS `docker compose up -d --no-build`。
- OPENCLAW_RELEASE_CONFIG：使用 `scripts/deploy-openclaw.sh --apply`，该脚本负责
  checkpoint、迁移、停用旧 consumer 和 health/smoke。
- ENV_RECREATE_NO_BUILD：只重建外部配置，不构建镜像。

执行：

```sh
pnpm workflow:plan
pnpm workflow:verify
pnpm test:workflow
```

任何 Docker build、Compose 写入、停止服务、数据迁移都必须通过明确的 RELEASE/apply
入口；默认 dry-run。生产目标是 OrbStack `ubuntu` 的 CasaOS，不是 macOS host Docker。
