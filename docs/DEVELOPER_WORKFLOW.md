> **Current policy:** [Autonomous Goal Workflow V2](ENGINEERING_POLICY.md). Lab deploys once after a green main merge; Gate-Local retains its separate policy.

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
- RELEASE_BUILD_REQUIRED：Lab PR 合并且 CI 通过后，由 M204 自动完成补丁版本递增、
  ARM64 image build、备份、切换和实时验收。
- OPENCLAW_RELEASE_CONFIG：Lab 由同一个自动发布流程处理 checkpoint、镜像切换和
  health/smoke；失败会恢复先前的 Compose 配置与镜像。
- ENV_RECREATE_NO_BUILD：只重建外部配置，不构建镜像。

## Product versions and release identity

- Lab uses root `VERSION` and `RELEASE_NOTES.md`; Gate uses
  `apps/pubg-saas/package.json.version` and
  `apps/pubg-saas/RELEASE_NOTES.md`. Root `package.json.version` is Monorepo
  tooling metadata only.
- Both product versions use standard SemVer. Lab increments its patch version
  automatically on M204 after a green main merge; Gate uses
  `scripts/pubg-saas-version.sh`. Formal tags use `lab/vX.Y.Z` and
  `gate/vX.Y.Z`; existing historical tags are not renamed.
- Gate candidates remain separate from Gate formal releases. Shared Domain or
  Presentation changes can test/build both products without synchronizing
  their versions.

执行：

```sh
pnpm workflow:plan
pnpm workflow:verify
pnpm test:workflow
```

Lab 自动发布器会将补丁版本和当期 Release Notes 直接提交到 main，无版本专用 PR。
它只发布 OpenClaw，并要求外部备份、容器健康、WhatsApp 连接和真实 PUBG 战绩查询都通过；
任何切换后的验收失败都会自动回滚。版本 Tag 与 GitHub Release 在实时验收成功后创建。

Gate 的独立产品级入口为 `scripts/release-gate.sh`。Gate-Local M2 仍暂停，
Gate-Staging/Prod 目标 adapter 尚未配置；在 adapter 与环境授权就绪前，Gate `--apply`
会 fail closed，本文不把现有 Compose 命令描述为正式 Gate Release。

Gate 运行时写入仍须通过它自己的授权入口。Lab 镜像构建和 Compose 写入由 M204 自动
发布器执行；本地计划命令默认 dry-run。生产目标是 host profile 指定的 OrbStack CasaOS。

## Validation policy

`pnpm workflow:plan` is authoritative at the start of each implementation phase. It emits the
scope workflow and `DOCKER_IMAGE_SET`; storage/backup/migration shell changes use the
storage-runtime, migration-readiness, service-aware-backup and manifest contract fixtures. A
configuration-only OpenClaw change enters the next main-merge Lab release; runtime source changes
rebuild the OpenClaw image after CI.

Use `scripts/run-check.sh` for bounded command evidence. Successful checks emit one summary line,
failed checks retain only a bounded diagnostic tail, and an unchanged cache key may reuse a passed
check. `docs/VALIDATION_MATRIX.md` is the source for the tier selection.

The release boundary has a local verification gate selected from affected paths, including
`pnpm check:secrets`, architecture and relevant product tests. Live acceptance then checks actual
runtime health, storage state, backup/recovery evidence and owner notification. Fresh-clone
rehearsal sets `AMADEUS_FRESH_CLONE_REHEARSAL=1` and never recursively invokes itself.
