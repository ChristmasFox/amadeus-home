# Amadeus 1.4.6 — Operation Skuld Cutover Readiness Goal

更新时间：2026-09-22（北京时间）

## 0. Goal 状态与执行方式

这是 Amadeus 1.4.5 之后、Mac mini Operation Skuld 正式执行之前的最终切换就绪验证 Goal。
新 Mac mini（主机名：Amadeus-M204，macOS 用户：nyannyan）已到位。

当前 `main` 根版本为 **1.4.5**。本 Goal 完成全部审计修复、切换前准备工具链、全量备份/恢复
演练和 destination capacity planning，发布 **Amadeus 1.4.6**。

本 Goal 授权：
- 修改源码、测试、脚本、文档、版本；
- commit / push；
- 当前 canonical CasaOS host（旧 Mac）上部署 1.4.6；
- 修复 1.4.5 审计遗留问题；
- 新增切换准备工具链（destination bootstrap planner、clean guest creation planner、HomeLab clean-restore plan、Operation Skuld state machine、rollback plan）；
- 完成所有 MIGRATE service 的完整备份/恢复 artifacts；
- 完成所有 live service 的 secret/sensitive-state coverage；
- 实现 destination capacity planning for 512 GB Mac mini；
- 运行完整的 HomeLab backup rehearsal 和 sensitive-state bundle rehearsal；
- 生成部署证据和切换就绪证明。

本 Goal **禁止**：
- 实际执行 Mac mini cutover（MAC_MINI_CUTOVER=NOT_EXECUTED）；
- SSH 进入或修改真实目标 Mac（DESTINATION_MUTATED=NO）；
- 冻结或停止当前权威旧 Mac 运行时（SOURCE_FROZEN=NO）；
- 移动或卸载 Avalon 作为切换策略；
- 回收 `/DATA/Gallery/immich`（IMMICH_SOURCE_RECLAIM=PENDING）；
- 启用第二个 OpenClaw owner-channel 运行时；
- 导入/导出当前 OrbStack machine 作为迁移目标策略；
- generic Docker volume prune 或 system prune -a --volumes；
- 对未知 owner 的 AppData/logs 做通用删除。

---

## 1. 目标 Mac mini 身份（destination identity）

| 字段 | 值 |
|---|---|
| Mac 主机名 | Amadeus-M204 |
| macOS 用户 | nyannyan |
| macOS home | /Users/nyannyan |
| OrbStack machine 名称 | nyannyan |
| Ubuntu 版本 | Ubuntu 24.04 LTS / noble |
| Linux 用户 | nyannyan |
| Linux home | /home/nyannyan |
| 目标策略 | clean OrbStack Ubuntu guest（不依赖旧 guest 快照） |

所有切换准备工具链中的 destination host 路径必须基于 `nyannyan`；
`/Users/blacksidev`、`/home/blacksidev` 或旧 machine 名 `ubuntu` 不得成为 active destination
production dependency。

---

## 2. 必须修复的 1.4.5 审计问题

### P0

1. **Immich 远端 checksum 等价校验 bug**：`remote_equivalence` 使用 rsync `--checksum`
   但只计数行数，不验证 zero-changes（任何 file-level 差异都不会被阻断）。必须在
   `reclaim-immich-old-source.sh` 里修复：当 rsync 报告任何非空行（含 `>f` 传输行）时，
   必须 fail，不能只计数。

2. **存储增长遥测 bug**：`storage-health.sh` 中的 Python 内嵌代码使用字符串字面量
   `'${MACHINE}'` 而不是实际展开的变量，导致远程 `du` 命令始终发给名为 `'${MACHINE}'`
   的机器（shell-quoting 错误）。必须修复为传递实际 machine 变量。

### P1

3. **live service observation 与 migration contract 分离**：readiness 检查中
   `check_service_inventory` 仅检查 service inventory 文件存在和结构，但不区分"观测到的
   live 服务"与"tracked migration contract"的来源；需要明确分离。

4. **所有 MIGRATE service 的完整 backup/restore artifacts**：每个 MIGRATE 服务必须有
   可执行的备份脚本路径 + 恢复演练（fixture 级）。service-aware registry 必须记录每项的
   backup 覆盖状态。

5. **所有 live service 的 secret/sensitive-state coverage**：每个需要 secret 的 MIGRATE
   服务必须在 migration manifest 和加密 bundle 清单中有明确的 secret record，coverage 必须是
   `encrypted-bundle`、`external-only` 或 `none-required`，不允许空/未知状态。

6. **image/checkpoint retention 消费实际 protected rollback 集**：retention policy 的
   `PROTECTED_IMAGE_SET` 必须真正查询 checkpoint 文件中引用的 image tags，而不仅仅是
   预设的字符串描述。

7. **安全的预迁移垃圾清理**：safe pre-migration GC 必须在不通用 prune 的前提下，
   计划性清理 dangling images、过期 build cache 和无主 AppData；需要 dry-run + apply 模式。

### P2

8. **目标容量规划**：512 GB Mac mini SSD 的 destination capacity planning 必须根据当前
   source 实际已用空间给出 fit/warning/blocker 判断，涵盖 OrbStack guest、Docker images、
   AppData 和 Avalon 媒体（Avalon 不迁移，只确认挂载需求）。

---

## 3. 新增切换准备工具链

### 3.1 destination bootstrap planner

文件：`scripts/plan-destination-bootstrap.sh`

功能：
- 打印完整的 destination 准备步骤（仅 plan，不执行）；
- 验证 destination identity（Amadeus-M204 / nyannyan）；
- 输出 macOS 依赖清单（Homebrew、OrbStack、pnpm、Python 等）；
- 输出 `HOST_IDENTITY=Amadeus-M204` 等结构化 plan 键值；
- 支持 `--fixture` 模式（使用 fake SSH target，不 SSH 真实目标）；
- 输出 `DESTINATION_BOOTSTRAP_PLAN=ready`。

### 3.2 clean OrbStack guest creation planner

文件：`scripts/plan-clean-orbstack-guest.sh`

功能：
- 打印在 destination Mac 创建全新 OrbStack Ubuntu 24.04 guest 的步骤；
- guest 名称：`nyannyan`，Linux user：`nyannyan`；
- 强调 source OrbStack machine 导入/导出不是目标策略；
- 输出 `GUEST_PLAN_STRATEGY=clean-ubuntu-24.04`；
- 支持 `--fixture` 模式；
- 输出 `CLEAN_GUEST_CREATION_PLAN=ready`。

### 3.3 HomeLab clean-restore plan

文件：`scripts/plan-homelab-clean-restore.sh`

功能：
- 以 manifest 顺序列出每个 MIGRATE 服务的 restore 步骤；
- 每步包含：restore 来源类型、restore 命令格式（fixture 级）、verify 命令格式；
- 强调 clean-restore path 不依赖旧 OrbStack guest 快照；
- 所有 destination path 使用 `nyannyan` 而非 `blacksidev`；
- 输出 `HOMELAB_CLEAN_RESTORE_PLAN=ready`。

### 3.4 Operation Skuld state machine

文件：`scripts/skuld-state-machine.sh`

功能：
- 记录并查询 Operation Skuld 当前阶段状态（source side preparation phases）；
- 状态定义见第 5 节；
- 支持 `--status`、`--advance PHASE`、`--reset`；
- 阶段转换要求前置 gate 通过；
- 状态存储在外部 state 文件（不进 Git）；
- 输出 `SKULD_PHASE=<current>`。

### 3.5 rollback plan

文件：`scripts/plan-skuld-rollback.sh`

功能：
- 描述切换失败时的回滚路径（与 runbook Phase Rollback 对应）；
- 输出 `ROLLBACK_PLAN=ready`；
- 支持 `--fixture` 模式；
- 强调回滚不自动安全（需要人工检查），打印检查清单。

---

## 4. Operation Skuld 阶段状态机

```text
SKULD_PHASE_0  source-side preparation complete (1.4.5 readiness)
SKULD_PHASE_1  1.4.6 audit fixes and tooling complete (this goal)
SKULD_PHASE_2  full HomeLab backup rehearsal passed
SKULD_PHASE_3  sensitive-state bundle rehearsal passed
SKULD_PHASE_4  destination capacity plan passed
SKULD_PHASE_5  destination bootstrap plan ready
SKULD_PHASE_6  clean guest creation plan ready
SKULD_PHASE_7  HomeLab clean-restore plan ready
SKULD_PHASE_8  rollback plan ready
SKULD_PHASE_9  safe pre-migration GC executed
SKULD_PHASE_10 source-side final readiness (OPERATION_SKULD_1_4_6=READY)

-- CUTOVER GATE (not executed in this goal) --

SKULD_PHASE_11 destination bootstrap executed
SKULD_PHASE_12 destination data restore completed
SKULD_PHASE_13 destination preflight passed
SKULD_PHASE_14 cutover window active
SKULD_PHASE_15 cutover validated and complete
```

本 Goal 只执行到 `SKULD_PHASE_10`；phase 11+ 不在本 Goal 授权范围内。

---

## 5. 目标状态证明

本 Goal 最终证明必须包含：

```text
VERSION=1.4.6
OPERATION_SKULD_SOURCE_READY=yes
DESTINATION_PLAN_READY=yes
CLEAN_GUEST_PLAN_READY=yes
FULL_HOMELAB_BACKUP_READY=yes
SENSITIVE_STATE_COVERAGE=complete
DESTINATION_HOST_IDENTITY=Amadeus-M204
DESTINATION_MACOS_USER=nyannyan
DESTINATION_ORBSTACK_MACHINE=nyannyan
DESTINATION_LINUX_USER=nyannyan
SOURCE_FROZEN=NO
DESTINATION_MUTATED=NO
IMMICH_SOURCE_RECLAIM=PENDING
MAC_MINI_CUTOVER=NOT_EXECUTED
```

---

## 6. Tests / Release Gate

所有新增 shell 脚本必须通过：
```bash
bash -n <script>
```

新增测试脚本：
- `scripts/test-skuld-preparation-tooling.sh`：测试所有切换准备工具链（fixture 模式）；
- `scripts/test-immich-checksum-equivalence.sh`：测试 remote_equivalence 的 zero-changes 验证。

完整 release gate：
```text
pnpm test:architecture
pnpm test:migration-readiness
pnpm test:storage-runtime
pnpm test:fresh-clone-readiness
pnpm test:skuld-consistency
pnpm test:notify-owner
pnpm test
pnpm typecheck
pnpm build
pnpm check:secrets
```

---

## 7. Release / Deployment Flow

```text
Phase 0  re-audit main and canonical CasaOS host
Phase 1  fix Immich remote checksum equivalence bug
Phase 2  fix storage growth telemetry bug
Phase 3  implement destination bootstrap planner (nyannyan)
Phase 4  implement clean OrbStack guest creation planner
Phase 5  implement HomeLab clean-restore plan
Phase 6  implement Operation Skuld state machine
Phase 7  implement rollback plan
Phase 8  implement safe pre-migration GC
Phase 9  implement destination capacity planning (512 GB)
Phase 10 update migration manifest with destination identity (nyannyan)
Phase 11 update runbook with destination identity (nyannyan)
Phase 12 add test coverage for preparation tooling and checksum fix
Phase 13 update migration-readiness.sh for 1.4.6 gates
Phase 14 full tests / build / typecheck / secrets / architecture
Phase 15 bump 1.4.5 -> 1.4.6, commit + push
Phase 16 deploy canonical CasaOS host (old Mac)
Phase 17 run source-side final readiness and preparation rehearsals
Phase 18 commit + push deployment evidence
```

---

## 8. Required Evidence

```text
VERSION=1.4.6

Git:
  immich remote checksum fix present and tested
  storage growth telemetry fix present
  destination identity = Amadeus-M204 / nyannyan (no blacksidev active dependency)
  preparation tooling scripts all pass bash -n and fixture tests

Preparation:
  destination bootstrap plan = ready
  clean guest creation plan = ready
  HomeLab clean-restore plan = ready
  Operation Skuld state machine = functional
  rollback plan = ready

HomeLab backup rehearsal:
  all MIGRATE services have backup artifacts
  service-aware manifest records coverage status

Sensitive-state:
  all live services with secrets have encrypted-bundle or explicit coverage
  coverage = complete (no unknown states)

Capacity:
  destination 512 GB capacity plan = fit/warning/blocker

Skuld:
  manifest updated with destination identity
  runbook updated with destination identity
  OPERATION_SKULD_SOURCE_READY=yes
  MAC_MINI_CUTOVER=NOT_EXECUTED
  IMMICH_SOURCE_RECLAIM=PENDING
  DESTINATION_MUTATED=NO
  SOURCE_FROZEN=NO
```

---

## 9. Completion Criteria

```text
VERSION=1.4.6
All 1.4.5 P0/P1 audit issues fixed.
Production Immich remote checksum equivalence bug verified by fixture test.
Storage growth telemetry bug fixed.
Destination identity = Amadeus-M204 / nyannyan in all tooling.
No /Users/blacksidev or /home/blacksidev in active destination tooling.
Clean-restore path independent from old OrbStack guest snapshot.
All preparation planners produce deterministic plan output.
Operation Skuld state machine tracks phases 0-10.
Safe pre-migration GC implemented with dry-run/apply.
Destination 512 GB capacity plan complete.
All MIGRATE services covered in service-aware registry.
All live service secrets have coverage classification.
Full release gate passed on source Mac.
1.4.6 deployed to canonical old-Mac CasaOS host.
Source-side final readiness = OPERATION_SKULD_SOURCE_READY=yes.
Mac mini cutover NOT EXECUTED.
Immich source reclaim PENDING.
Destination NOT MUTATED.
Source NOT FROZEN.
```
