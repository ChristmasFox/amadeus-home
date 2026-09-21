# Amadeus 1.4.5 — Development Efficiency Addendum

更新时间：2026-09-21（北京时间）

## 0. Status

本文件是 `docs/AMADEUS_1_4_5_OPERATION_SKULD_FINAL_HARDENING_GOAL.md` 的正式组成部分。

Amadeus 1.4.5 不只完成 Operation Skuld Final Hardening，同时必须收口当前 Agent 开发流程中的高 token / 高耗时问题。

本 Addendum 不降低 release 质量，不通过“少测一点”换速度，而是通过：

```text
change scope detection
→ targeted validation
→ phase acceptance
→ one final full release gate
→ compact evidence
```

避免同一批代码反复执行全量测试、全量 build、Docker build、长日志读取和整份 Goal 重读。

1.4.5 完成后，开发工作流必须同时优化：

```text
模型 token 消耗
开发总耗时
测试重复率
构建重复率
日志上下文体积
长 Goal 上下文重读
失败定位成本
```

---

# 1. Core Principle

正式原则：

> Run the cheapest validation that can disprove the current change; run the full release gate once at the release boundary.

中文：

> 开发阶段只运行足以证明当前改动错误的最低成本验证；完整验证只在真正的阶段边界和发布边界执行。

禁止两个极端：

```text
每改一行就 pnpm test + typecheck + build
```

以及：

```text
为了省 token 不测试，最后直接部署
```

目标是：

```text
少跑重复测试
≠ 少做必要验证
```

---

# 2. Existing Workflow Must Become Authoritative

仓库已经存在：

```text
scripts/developer-workflow.sh
pnpm workflow:plan
pnpm workflow:verify
```

1.4.5 必须把它从“建议工具”升级为 Codex / `/goal` 的默认执行入口。

每次 implementation phase 开始前：

```bash
pnpm workflow:plan
```

根据 Git diff 输出：

```text
CHANGE_SCOPE_LEVEL
CHANGE_SCOPE_WORKFLOW
DOCKER_BUILD
COMPOSE_MODE
VERIFY
```

Agent 不得在没有特殊理由的情况下绕过 workflow classification，直接执行 full suite。

如果 Agent 认为 classification 不足，必须先记录原因，例如：

```text
FULL_VERIFY_REASON=cross-package contract changed
```

而不是习惯性执行全量验证。

---

# 3. Validation Tiers

定义五层验证。

## Tier 0 — Static / syntax

适用：

```text
docs
state files
shell-only small edit
JSON/YAML/template edit
```

典型检查：

```text
git diff --check
bash -n changed-script.sh
python/json parser
compose config --quiet
specific architecture fixture
```

禁止自动执行：

```text
pnpm test
pnpm build
Docker build
live deploy
```

除非该改动实际影响运行时代码。

## Tier 1 — Targeted package validation

适用：单 package / 单 domain 改动。

例如：

```text
PUBG
→ pnpm typecheck:pubg
→ pnpm test:pubg

Amadeus plugin / Identity
→ pnpm typecheck:amadeus
→ pnpm test:amadeus

Presentation
→ presentation typecheck
→ presentation test
→ architecture check

Product Radar
→ pnpm typecheck:product-radar
→ pnpm test:product-radar

storage / migration shell
→ bash -n
→ test-storage-runtime
→ related readiness fixture
```

不得因为修改一个 storage shell 自动执行所有 TypeScript package tests。

## Tier 2 — Phase acceptance

一个 Goal Phase 完成后运行一次该 Phase 的 acceptance。

示例：

```text
Phase: storage health
→ test-storage-runtime
→ storage-health fixture
→ architecture

Phase: backup
→ backup fixture
→ SQLite integrity fixture
→ PostgreSQL dump fixture

Phase: secrets
→ secret inventory fixture
→ export/import rehearsal
→ leak scan
```

Phase 内每个小修复只跑直接失败的测试；不要每次重新跑整个 Phase suite。

## Tier 3 — Full local release gate

仅在准备 release 前执行一次完整本地 gate：

```text
pnpm test
pnpm typecheck
pnpm build
pnpm check:secrets
git diff --check
architecture
fresh-clone rehearsal
```

如果完整 gate 某一项失败：

1. 修复该失败；
2. 优先重跑失败项；
3. 当失败项通过后，只在有跨领域副作用时重跑完整 gate；
4. release 前必须最终拥有一份完整 green gate evidence。

不得形成：

```text
full gate
→ 修 1 行
→ full gate
→ 修 1 行
→ full gate
```

默认模式应为：

```text
full gate
→ targeted fix verification
→ final confidence decision
```

若改动触及 shared contract / package metadata / lockfile / build graph，则允许再次 full gate。

## Tier 4 — Live acceptance

部署后只验证 runtime truth：

```text
health
smoke
doctor
migration-readiness
storage health
owner notification
service-specific integrity
```

不得在 live deploy 后再次无理由执行：

```text
pnpm test
pnpm typecheck
pnpm build
```

这些属于 source validation，不属于 live validation。

---

# 4. Build Policy

Build 是必要的，但必须区分三种 build。

## 4.1 TypeScript local build

需要：

- runtime TypeScript source 已改变；
- Dockerfile COPY 的是生成后的 `dist`；
- release artifact 需要当前 dist。

OpenClaw image 当前直接 COPY：

```text
plugins/pubg/dist/*
plugins/amadeus/dist/*
```

所以插件源码变化后，release 前必须至少生成一次对应最新 dist。

但开发期间不需要每个小改动都 `pnpm build`。

推荐：

```text
edit
→ targeted typecheck/test
→ edit
→ targeted typecheck/test
→ phase complete
→ optional affected-package build
→ release boundary
→ one full build
```

## 4.2 Docker image build

只有以下条件需要：

```text
runtime source changed
Dockerfile changed
image-owned bundled asset changed
base image changed
package metadata / dependency changed
```

不需要 Docker build：

```text
docs only
state/checkpoint only
host LaunchAgent only
host shell maintenance only
compose/env-only change that existing image already supports
migration evidence only
```

配置-only 应优先：

```text
docker compose up -d --no-build
```

现有 `developer-workflow.sh` 的 `RELEASE_BUILD_REQUIRED` / `OPENCLAW_RELEASE_CONFIG` / `ENV_RECREATE_NO_BUILD` 分类必须继续保留并增强。

## 4.3 Rebuild only affected images

如果只改 OpenClaw plugin：

```text
不要同时重建 Product Radar image
```

如果只改 Product Radar：

```text
不要同时重建 OpenClaw image
```

`deploy-openclaw.sh --build-auto` 应根据 source ownership 计算需要 build 的 image set。

1.4.5 应增加测试确保 source-to-image classification 不会无意义地 rebuild 两个 image。

---

# 5. Test Necessity Matrix

建立 tracked validation matrix，例如：

```text
docs/VALIDATION_MATRIX.md
```

最低要求：

| Changed area | During edit | Phase gate | Release gate | Docker build |
| --- | --- | --- | --- | --- |
| docs only | diff check | optional docs check | no full gate solely for docs | no |
| shell storage | bash -n + targeted fixture | storage-runtime | full once at release | no unless image-owned |
| PUBG | pubg typecheck/test | pubg suite | full once | OpenClaw only |
| Amadeus | amadeus typecheck/test | amadeus suite | full once | OpenClaw only |
| Presentation | presentation tests | architecture | full once | affected consumers only |
| Product Radar | radar typecheck/test | radar suite | full once | Product Radar only |
| compose/env | compose config | service smoke | release config gate | normally no |
| Dockerfile/dependency | targeted tests | affected build | full release gate | yes |
| shared package metadata | affected tests | workspace validation | full release gate | affected images |

矩阵应由脚本读取或至少通过 tests 保证 `developer-workflow.sh` 与文档一致。

---

# 6. Avoid Repeated Goal Re-reading

长 Goal 仍保留为设计与 acceptance source of truth，但不应该在 Agent 每一步重复读取全文。

新增运行时执行摘要：

```text
.agent/EXECUTION_PLAN.md
.agent/run-state.json
```

它们是执行缓存，不取代 Goal。

## EXECUTION_PLAN

目标约 150–300 行，包含：

```text
Goal id / version
hard constraints
phase list
touched areas
phase acceptance commands
release gate
non-goals
```

不要复制 Goal 中大段背景、示例和历史讨论。

## run-state.json

例如：

```json
{
  "goal": "1.4.5",
  "phase": "service-aware-backup",
  "completed": [
    "fresh-clone",
    "storage-health",
    "safe-gc"
  ],
  "validated": {
    "test-storage-runtime": "passed",
    "storage-health-fixture": "passed"
  },
  "changedAreas": [
    "scripts/storage-health.sh",
    "scripts/storage-maintenance.sh"
  ],
  "remaining": [
    "backup",
    "runbook-convergence",
    "release"
  ]
}
```

Agent 恢复执行时先读取：

```text
EXECUTION_PLAN
run-state
current diff
```

只有需要某条具体设计约束时，再读取 Goal 对应 section。

禁止每个 Phase 开头重新通读 1000+ 行 Goal。

---

# 7. Compact Command Evidence

长 stdout/stderr 是 token 和定位时间的大头。

建立统一 helper，例如：

```text
scripts/run-check.sh
```

行为：

```text
command full output
→ evidence file

success
→ return exit=0 + duration + concise summary

failure
→ return exit code
→ matching FAIL/ERROR lines
→ tail N
→ evidence path
```

推荐默认：

```text
success output <= 20 lines
failure context <= 100–200 lines
```

完整日志保存在：

```text
/tmp/amadeus-checks/...
或
release evidence directory
```

而不是全部进入模型上下文。

Docker 日志默认：

```text
docker logs --tail N
```

禁止默认读取 container 全生命周期日志。

---

# 8. Command De-duplication

执行状态必须记录 command fingerprint：

```text
command
relevant git tree hash / changed files
result
completedAt
```

同一个 source state 下已成功通过的 expensive check，不应因为 Agent 下一轮继续思考而自动重跑。

例如：

```text
presentation tests PASS @ tree abc
```

只改 `scripts/storage-health.sh` 后：

```text
presentation tests remain valid
```

不必重跑。

如果修改 presentation source，则 invalidate。

这可以实现成简单 deterministic cache，不需要复杂 build system。

---

# 9. Failure-directed Retry

发生失败时：

```text
full suite failure
        ↓
identify failed component
        ↓
targeted test while fixing
        ↓
targeted pass
        ↓
decide whether dependency graph invalidates other gates
```

不要：

```text
修改
→ 从头跑全部
```

典型例子：

```text
LaunchAgent PATH failure
```

修复仅涉及 macOS scheduler shell/plist 时，应验证：

```text
bash -n
plist lint
scheduler fixture
real launchctl smoke
```

没有理由重新跑 PUBG / Presentation / Product Radar 全量 tests 或重建业务镜像。

---

# 10. Release Gate Is Still Strict

优化不能降低以下最终保证：

在 release commit 前必须拥有：

```text
full test green
full typecheck green
full build green
secret scan green
architecture green
fresh-clone rehearsal green
Goal-specific acceptance green
```

关键区别是：

> 这些完整检查在 release boundary 跑一次，而不是在每个小修复后重复跑。

部署完成后：

```text
doctor
service health
migration-readiness
storage health
owner notification
```

也必须通过。

---

# 11. Timing and Token Telemetry

1.4.5 开始记录开发验证成本，但不记录 prompt / secret 内容。

每个 check 保存：

```text
name
startedAt
finishedAt
durationSeconds
exitCode
cached / executed
outputBytes
```

汇总示例：

```text
Validation Summary

Targeted checks executed: 18
Targeted checks reused: 11
Full test gates: 1
Full builds: 1
Docker builds:
  OpenClaw: 1
  Product Radar: 0
Live deploy attempts: 1
```

目标不是做复杂 telemetry，而是让后续能回答：

```text
为什么一个 Goal 花了 6 小时？
时间花在测试、build、Docker、网络、模型思考还是 live deploy？
```

如果 Codex CLI / provider 能可靠提供 token usage，可额外记录 aggregate token counters；不能获取时不要猜测。

任何 telemetry 不得包含：

```text
prompt contents
secret values
API keys
private message contents
```

---

# 12. Phase Budget Guardrails

Agent 不能因为一个 Phase 小问题无限循环。

建议每个 Phase 记录：

```text
attempts
last blocker
validation runs
```

当相同 expensive command 连续执行 2 次且 source state 没有相关变化时：

```text
STOP redundant retry
inspect evidence
```

当同一问题连续修复失败 3 次时：

```text
pause implementation
re-diagnose root cause
```

而不是继续 trial-and-error 消耗 token。

---

# 13. 1.4.5 Specific Execution Strategy

本版本特别大，因此必须按 Phase 使用最低足够验证。

## Fresh clone / Git scripts

开发中：

```text
git check-ignore
git ls-files
fresh clone fixture
architecture
```

不要反复 build runtime images。

## Storage health / scheduler / GC

开发中：

```text
bash -n
storage fixtures
scheduler fixture
```

只有 live acceptance 时运行真实 scheduler / GC。

## Backup / secrets

开发中：

```text
fixture SQLite
fixture pg dump contract
fixture encrypted bundle
```

只在 final live acceptance 创建 fresh production backup。

## Manifest / Runbook

开发中：

```text
contract consistency test
JSON validation
```

不需要 Docker build。

## Runtime code

如果 1.4.5 没有修改 plugins/apps TypeScript runtime：

```text
不要为了版本号或运维脚本变化重建 OpenClaw/Product Radar image。
```

如果 runtime source 发生真实修改，再按 affected image build。

---

# 14. Fresh Clone Rehearsal Must Not Recursively Run Wasteful Gates

主 Goal 要求 fresh clone rehearsal。

实现时避免：

```text
outer pnpm test
→ test-fresh-clone
→ fresh clone pnpm test
→ fresh clone pnpm test includes test-fresh-clone
→ recursion / duplicate full suite
```

必须设计独立的 fresh-clone gate，例如：

```text
fresh clone
→ install/check tracked inputs
→ run a non-recursive curated release suite
```

Fresh clone script 必须能够识别：

```text
AMADEUS_FRESH_CLONE_REHEARSAL=1
```

避免递归调用自身。

---

# 15. Expected Repository Changes

1.4.5 至少考虑：

```text
scripts/developer-workflow.sh
scripts/test-developer-workflow.sh
scripts/run-check.sh                 # optional implementation name
scripts/test-fresh-clone-readiness.sh
docs/DEVELOPER_WORKFLOW.md
docs/VALIDATION_MATRIX.md
.agent/EXECUTION_PLAN.md              # generated / per-goal policy decided by implementation
.agent/run-state.json                 # runtime state / ignore policy decided safely
```

如果 run-state 不适合 tracked mutable file，可把 schema/template tracked，live state ignored：

```text
.agent/run-state.example.json
.agent/runtime/run-state.json
```

不得因为效率优化引入一个新的 Agent runtime / planner。OpenClaw 仍是产品 Agent runtime；这里仅是开发执行辅助。

---

# 16. Acceptance Tests

必须增加 deterministic coverage：

1. docs-only diff 不触发 package build；
2. storage shell diff 不触发 PUBG/Product Radar tests；
3. PUBG diff 只选择 PUBG targeted gate；
4. Product Radar diff 不触发 OpenClaw image build；
5. OpenClaw config-only diff 可以 no-build apply；
6. Dockerfile/dependency change 标记 build required；
7. shared contract change 会扩大 impacted package set；
8. release gate 仍包含 full test/typecheck/build；
9. successful check cache 在无相关 source change 时可复用；
10.相关 source change 会 invalidate cache；
11. compact runner 在成功时不回显完整 output；
12. failure 时保留 bounded diagnostic context；
13. fresh-clone rehearsal 不递归调用自身；
14. live acceptance 不重复 full local source gates。

---

# 17. Success Metrics

不硬编码虚假的 token 降幅承诺。

但是 release evidence 应能证明：

```text
FULL_TEST_RUNS <= 2
FULL_TYPECHECK_RUNS <= 2
FULL_BUILD_RUNS <= 2
```

理想路径：

```text
1 final local full gate
1 fresh-clone release rehearsal
```

Docker image build：

```text
只构建受影响 image
```

如果一个 Phase 出现额外 full gate，evidence 必须记录理由。

同时记录：

```text
executed targeted checks
reused checks
full gates
Docker builds
live deploy attempts
validation wall-clock time
```

---

# 18. Updated 1.4.5 Completion Boundary

原 Final Hardening Goal 的全部 acceptance 仍有效。

除此之外必须：

```text
DEVELOPMENT_WORKFLOW=scope-aware
TARGETED_VALIDATION=enabled
REDUNDANT_FULL_GATE=guarded
BUILD_SCOPE=affected-only
COMMAND_OUTPUT=bounded
EXECUTION_STATE=compact
FRESH_CLONE_REHEARSAL=non-recursive
VALIDATION_TELEMETRY=recorded
```

`OPERATION_SKULD=READY` 与 `AMADEUS_VERSION=1.4.5` 不得因为效率优化跳过任何原始安全 gate。

---

# 19. Combined `/goal`

执行 1.4.5 时两个文档共同构成 authoritative scope：

```text
docs/AMADEUS_1_4_5_OPERATION_SKULD_FINAL_HARDENING_GOAL.md
docs/AMADEUS_1_4_5_DEVELOPMENT_EFFICIENCY_ADDENDUM.md
```

建议命令：

```text
/goal Implement Amadeus 1.4.5 completely using both docs/AMADEUS_1_4_5_OPERATION_SKULD_FINAL_HARDENING_GOAL.md and docs/AMADEUS_1_4_5_DEVELOPMENT_EFFICIENCY_ADDENDUM.md as the authoritative scope. Re-audit main and the canonical host first. Preserve every safety and Operation Skuld acceptance gate, but use scope-aware targeted validation during development, compact command evidence, affected-only builds, and a single final full release gate instead of repeatedly running the entire test/build suite. Persist concise phase progress so the full Goal does not need to be reread on every iteration. Do not reclaim the retained Immich source and do not perform the Mac mini cutover. Release 1.4.5 only after the original hardening acceptance plus fresh-clone, validation-efficiency, backup, storage, secret, HomeLab and live readiness gates all pass; then commit/push deployment evidence.
```
