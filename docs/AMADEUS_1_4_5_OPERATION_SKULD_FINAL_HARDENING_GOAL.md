# Amadeus 1.4.5 — Operation Skuld Final Hardening Goal

更新时间：2026-09-21（北京时间）

## 0. Goal 状态与执行方式

这是 Amadeus 1.4.4 之后、Mac mini Operation Skuld 正式执行之前的最后一轮可靠性收口 Goal。

当前 `main` 根版本为 **1.4.4**。本 Goal 完成全部源码、测试、当前 canonical CasaOS host 的 live 变更、fresh-clone rehearsal、service-aware backup、storage health/GC、HomeLab migration coverage 和部署验证后发布 **Amadeus 1.4.5**。

本轮不再重构 Agent 架构，不新增新的业务 Plugin，不重新设计 Worldline Presentation。目标只有一个：

> 让未来的新 Mac mini 可以只依赖 Git-tracked source + Avalon 8TB + encrypted secrets + service-aware backup 重建目标 HomeLab，不依赖旧工作区里的 ignored 文件、隐式本地脚本、过期数据库快照或人工猜测。

建议 Codex 执行：

```text
/goal Implement docs/AMADEUS_1_4_5_OPERATION_SKULD_FINAL_HARDENING_GOAL.md completely. Re-audit current main and the live canonical CasaOS host before modifying anything. Fix fresh-clone reproducibility first, including tracking all required secret migration scripts without exposing secret values. Implement real storage warning/critical state evaluation, safe scheduled GC and release/checkpoint retention, service-aware SQLite/PostgreSQL backups, complete HomeLab migration classification and encrypted secret coverage, Manifest/Runbook consistency checks, and harden the Immich source-reclaim gate with a fresh one-way checksum verification before any future deletion. Do NOT reclaim the retained Immich source in this goal. Do NOT perform the Mac mini cutover. Finish with a true fresh-clone rehearsal that depends only on Git-tracked source plus fixtures/external artifacts, release as 1.4.5, commit/push, deploy to the current canonical host, run doctor/storage/readiness acceptance, and commit/push deployment evidence. OPERATION_SKULD=READY may only be emitted when every required gate passes.
```

本 Goal 授权：

- 修改源码、测试、脚本、文档、版本；
- commit / push；
- 当前 canonical CasaOS host 上部署 1.4.5；
- 修复 storage health、log policy、safe GC、scheduler、retention；
- 扩展 service-aware backup；
- 扩展 HomeLab service/secret migration inventory；
- 完善 encrypted secret export/import rehearsal；
- 更新 Operation Skuld manifest / runbook；
- 运行 fresh clone rehearsal；
- 生成部署证据。

本 Goal **禁止**：

- 实际执行 Mac mini cutover；
- 删除 `/DATA/Gallery/immich` 旧 Immich 源；
- 格式化/重分区 Avalon；
- 旋转真实 secrets，除非是修复 blocker 所需且有明确回滚；
- generic Docker volume prune；
- generic `docker system prune -a --volumes`；
- 对未知 owner 的 AppData / logs 做通用删除。

---

# 1. 审计结论与本轮必须修复的问题

1.4.4 live runtime 本身不需要回滚，Immich 外置迁移、受管日志轮转、9Router artifact、Worldline 通知和 post-deploy GC 均有有效 live evidence。

但 1.4.4 审计发现以下阻塞/缺口：

## P0

1. `scripts/secrets-inventory.sh`
2. `scripts/export-skuld-secrets.sh`
3. `scripts/import-skuld-secrets.sh`

被运行时、tests、architecture 和 backup 引用，但未进入 Git tracked source；fresh clone 后 Operation Skuld 能力不完整。

4. Storage thresholds 已定义，但 `storage-health.sh` 没有真正根据 free percent/free bytes 得出 warning/critical；当前外置盘处于低剩余空间时仍可能被写成 `healthy`。

## P1

5. weekly storage maintenance 当前实际是 read-only，不能自动执行 safe GC。
6. `DEPLOYMENT_IMAGE_RETENTION_COUNT` / `DEPLOYMENT_CHECKPOINT_RETENTION_COUNT` 已定义但没有真正落实。
7. `backup.sh` 仍以 raw AppData tar 为主，不能作为 PostgreSQL / SQLite 的最终一致性迁移策略。
8. Operation Skuld Runbook 落后于 Manifest，缺 9Router、Immich、changedetection、media adapter 等完整 restore flow。
9. 当前 HomeLab inventory 中大量 ACTIVE external service 仍只有 `manual restore path`，未形成完整迁移分类和 secret coverage。
10. Immich old-source reclaim gate 使用历史 equivalence state，不会在真正删除前再次做 fresh one-way checksum/equivalence。
11. reclaim 后 doctor/readiness 对 old source 的存在性假设会变成 false negative。

## P2

12. backup manifest 的 Immich media stats 仍以旧 source 为来源，未来 source reclaim 后会失真。
13. daemon default log policy 只保证新建容器；当前 known-external / unknown containers 的日志治理还没有完整分类和长期策略。
14. 缺少存储增长历史，不利于观察 Avalon / Docker / media 的持续增长趋势。

---

# 2. 目标状态

1.4.5 完成后：

```text
Git tracked source
      +
Avalon 8TB
      +
Encrypted secret bundle
      +
Service-aware DB/state backup
      ↓
Fresh destination host
      ↓
Operation Skuld
      ↓
Worldline Convergence
```

必须具备：

```text
FRESH_CLONE_REHEARSAL=PASSED
ALL_REQUIRED_MIGRATION_SCRIPTS_TRACKED=yes
STORAGE_HEALTH_STATE=correct
SAFE_SCHEDULED_GC=enabled
RELEASE_RETENTION=enabled
CHECKPOINT_RETENTION=enabled
SERVICE_AWARE_BACKUP=passed
IMMICH_PG_DUMP=passed
SQLITE_SNAPSHOTS=passed
NINE_ROUTER_RESTORE_REHEARSAL=passed
HOMELAB_MIGRATION_CLASSIFICATION=complete
MANIFEST_RUNBOOK_CONSISTENCY=passed
IMMICH_SOURCE_RECLAIM=pending-and-hardened
OPERATION_SKULD=READY
```

---

# 3. Fresh Clone Reproducibility — P0

## 3.1 修复 `.gitignore`

当前 broad pattern 不能继续导致 migration implementation scripts 被误忽略。

必须保留 secret data 防护，但明确 allowlist 迁移脚本，例如：

```gitignore
**/secrets/
*.secret
*.secrets
*.token
*.key
*.pem
*.p12
*.pfx

!scripts/check-secrets.sh
!scripts/secrets-inventory.sh
!scripts/export-skuld-secrets.sh
!scripts/import-skuld-secrets.sh
```

具体实现可根据现有 `.gitignore` 调整，但必须同时满足：

- secret value 仍被忽略；
- secret migration source code 必须 tracked；
- architecture/test 不得依赖 ignored local implementation file。

## 3.2 三个核心 Secrets 工具必须进入 Git

必须 tracked：

```text
scripts/secrets-inventory.sh
scripts/export-skuld-secrets.sh
scripts/import-skuld-secrets.sh
```

验收：

```bash
git ls-files scripts/secrets-inventory.sh
git ls-files scripts/export-skuld-secrets.sh
git ls-files scripts/import-skuld-secrets.sh
```

三者均必须返回。

## 3.3 Fresh Clone Test

新增：

```text
scripts/test-fresh-clone-readiness.sh
```

测试必须从新的临时工作区开始，并至少证明：

```text
source = git tracked files only
no original ignored files
no original node_modules
no original .env
no original infra/host-profile.env
no original migration helper scripts
```

可使用 fixture 替代真实 OrbStack/live secrets。

至少运行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm check:secrets
```

并验证 required migration scripts 均存在。

如果完整 clone 由于 connector/test 环境限制无法做网络 install，可以拆为：

```text
git archive / fresh checkout fixture
+
tracked-file completeness gate
+
local fixture tests
```

但最终 release evidence 必须有一次真实 fresh clone rehearsal。

---

# 4. Storage Health State — P0

## 4.1 真正消费 Host Profile 阈值

现有：

```text
STORAGE_WARN_FREE_PERCENT
STORAGE_CRITICAL_FREE_PERCENT
STORAGE_WARN_FREE_BYTES
```

必须真正进入判定。

至少观测：

```text
mac_internal_root
external_storage
OrbStack guest /
OrbStack /DATA
```

每个 target 记录：

```text
totalBytes
usedBytes
freeBytes
usedPercent
freePercent
```

## 4.2 状态机

正式状态：

```text
healthy
warning
critical
missing
policy_violation
```

优先级建议：

```text
missing
> critical bytes
> critical percent
> warning bytes
> warning percent
> policy_violation / warning aggregation
> healthy
```

不要把 severity 逻辑写死到 presentation。

## 4.3 Aggregated state

storage state 至少：

```json
{
  "status": "warning",
  "components": {
    "externalStorageIdentity": "healthy",
    "externalCapacity": "critical",
    "internalCapacity": "healthy",
    "guestCapacity": "healthy",
    "dockerLogPolicy": "healthy"
  },
  "updatedAt": "..."
}
```

任何 component violation 都不能最后无条件写 `healthy`。

## 4.4 Worldline 通知

状态转换时通知，不重复刷屏。

建议映射：

```text
warning/critical → 世界线偏移
external missing → IBN 5100
repeated warning/critical → 吸引子场
recovered → 世界线收束
```

必须支持：

```text
healthy -> warning
warning -> critical
critical -> healthy
missing -> healthy
policy_violation -> healthy
```

相同状态 daily run 不重复发送。

---

# 5. Storage Growth History

新增轻量 history state，例如：

```text
$OPENCLAW_DATA_DIR/data/storage-growth-history.jsonl
```

每日追加：

```text
timestamp
internalFreeBytes
externalFreeBytes
immichMediaBytes
mediaBytes
downloadsBytes
dockerBytes
```

保留 90 天（或 profile 化）。

输出可计算：

```text
7d growth
30d growth
```

不需要做虚假精确“几天后必满”的预测；只做事实趋势和粗略 operator information。

---

# 6. Weekly Safe GC — P1

## 6.1 Scheduler 语义修复

当前目标：

```text
daily health → read-only
weekly maintenance → safe apply
```

`--scheduled` 必须走 safe apply，而不是 plan-only。

执行前 hard gate：

```text
verified external storage
host profile loaded
protected image set generated
protected checkpoint set generated
no unknown destructive target
```

任何 gate 失败：

```text
GC=BLOCKED
```

并走 owner notification。

## 6.2 Allowed GC

允许：

```text
dangling project images
expired project release images
expired build cache
expired disposable checkpoints
known temporary build artifacts
```

禁止：

```text
Docker volumes
Immich media
PostgreSQL
SQLite
secrets
owner outbox
unknown AppData
unknown image
current image
previous known-good image
rollback image
checkpoint referenced image
```

---

# 7. Release Image Retention — P1

真正实现：

```text
DEPLOYMENT_IMAGE_RETENTION_COUNT
```

适用：

```text
local/openclaw-amadeus:git-*
local/product-radar:git-*
```

Protected set：

```text
all running images
current release
previous known-good
rollback-* tags
checkpoint referenced images
last N release images
```

其余 project-tagged old release 才允许删。

非项目 image：

```text
REPORT_ONLY
```

9Router exact image 由独立 artifact/restore policy 保护。

---

# 8. Deployment Checkpoint Retention — P1

真正实现：

```text
DEPLOYMENT_CHECKPOINT_RETENTION_COUNT
```

分类：

```text
PROTECTED
DISPOSABLE
MIGRATION_CRITICAL
UNKNOWN
```

必须长期保护：

```text
current release evidence
previous known-good evidence
explicit rollback checkpoint
Operation Skuld migration checkpoints
Immich migration/cutover DB dumps
source reclaim evidence
encrypted secret bundles
```

普通 post-deploy evidence / maintenance report 可以按 count/age 清理。

未知路径只报告。

---

# 9. Service-aware Backup Registry — P1

不要继续把所有 runtime data 等价成 raw tar。

引入明确 registry，可用 JSON/YAML/TS/bash metadata 实现，但必须 tracked。

最低覆盖：

```text
OpenClaw:
  pubg.sqlite
  identity.sqlite
  vps-usage-state.json
  workspace
  notifications

Product Radar:
  product-radar.sqlite

Immich:
  PostgreSQL logical dump
  external media reference (not tarred)

9Router:
  protected data
  exact image artifact

changedetection:
  datastore

media-organizer-adapter:
  state
```

每个 entry 包含：

```text
backupMethod
restoreMethod
integrityCheck
classification
```

---

# 10. SQLite Consistent Snapshot

不得把 live SQLite raw file copy 作为唯一 portable backup。

优先：

```text
Python sqlite3 backup API
```

或：

```sql
VACUUM INTO
```

至少覆盖：

```text
pubg.sqlite
identity.sqlite
product-radar.sqlite
```

完成后：

```text
PRAGMA integrity_check = ok
sha256
file size
schema/table inventory
```

必要时可记录非敏感 row counts，不能输出敏感数据内容。

---

# 11. Immich PostgreSQL Final Migration Backup

Operation Skuld Phase 0 必须创建新的 latest logical dump：

```bash
pg_dump -Fc
```

并：

```bash
pg_restore --list
```

通过。

建议输出：

```text
$SKULD_BACKUP_ROOT/immich/postgres-<timestamp>.dump
$SKULD_BACKUP_ROOT/immich/postgres-<timestamp>.dump.sha256
$SKULD_BACKUP_ROOT/immich/postgres-manifest.json
```

明确：

```text
live pgdata copy != portable canonical restore source
```

raw pgdata 可作为 emergency artifact，但 Mac mini restore 必须优先 logical restore。

---

# 12. 9Router Full Restore Rehearsal

已有 exact image artifact 不等于 restore 完成。

必须至少通过 fixture / isolated rehearsal：

```text
docker load exact image
restore runtime env
restore /DATA/AppData/9router/data
start isolated 9Router
GET /dashboard → healthy
GET /v1/models no auth → 401
GET /v1/models with fixture auth → success or expected authenticated boundary
```

不允许 rehearsal 调用 production provider key /产生真实计费请求。

---

# 13. HomeLab Migration Classification — P1

当前 service inventory 中的所有 running service 必须正式归类为：

```text
MIGRATE
REBUILD
EXTERNAL_DATA
DROP
MANUAL_BLOCKER
```

不能继续只写泛化 `manual restore path`。

至少审计当前 inventory 中：

```text
frpc
xiaoya
Homarr
Emby
qBittorrent
Nginx Proxy Manager
Filebrowser
Aria2
Jellyfin
Alist
v2rayA
xiaoyakeeper
dashdot
```

分类必须依据 live compose / mounts / persistence，不得仅凭服务名字猜测。

对每个 service 记录：

```text
classification
persistentData
secretRefs
backupMethod
restoreMethod
verification
cutoverDependency
```

例如媒体目录本身应标 `EXTERNAL_DATA`；配置目录可为 `MIGRATE`；纯监控服务可 `REBUILD`。

---

# 14. Whole HomeLab Secret Inventory

当前 encrypted bundle 必须扩展到最终分类为 `MIGRATE` 且确有 secret/runtime credential 的服务。

只记录 metadata / logical id，不把值放 Git。

需要审计的典型类别：

```text
frpc token/auth
qBittorrent credential state
NPM DB/certificate-related runtime secrets
Alist credential/config state
Aria2 RPC secret
v2rayA state
Filebrowser credential DB
xiaoya credential/config state
```

是否实际存在必须从 live runtime/compose 判断。

secret value 只能出现在：

```text
encrypted Skuld bundle
```

不得进入：

```text
Git
service inventory
migration manifest
logs
notifications
release report
```

---

# 15. Manifest / Runbook Convergence — P1

## 15.1 Runbook Phase 2 补齐

Runbook 必须显式恢复：

```text
OpenClaw workspace/config
OpenClaw encrypted secrets
Identity SQLite
PUBG SQLite
Product Radar SQLite
VPS state
Owner outbox

9Router:
  exact image
  env/secrets
  provider state

Immich:
  attach Avalon
  UUID/sentinel check
  latest PostgreSQL logical restore
  Redis policy
  model cache policy
  external media verification

changedetection datastore
media adapter state
FashionSigLIP LaunchAgent
HomeLab classified external services
```

## 15.2 Contract Test

新增自动检查：

- 每个 `criticalPersistentData.id` 必须在 Runbook 有 restore step；
- 每个 required secret 必须有 restore target / restore method；
- 每个 ACTIVE service 必须属于 MIGRATE / REBUILD / EXTERNAL_DATA / DROP / MANUAL_BLOCKER；
- manifest 中不能出现 duplicate key；
- runbook 不能遗漏 manifest 的 critical service。

可以新增：

```text
scripts/test-skuld-manifest-runbook-consistency.sh
```

并进入 `pnpm test`。

---

# 16. Immich Source Reclaim Hardening — P1

1.4.5 **不执行 reclaim**。

旧：

```text
/DATA/Gallery/immich
```

继续：

```text
SOURCE_RECLAIM_PENDING
```

但未来 reclaim tool 必须强化为 fresh gate。

真正 `--apply` 之前必须重新：

```text
verify Avalon UUID
verify sentinel
verify current live mount == IMMICH_MEDIA_ROOT
verify Immich health
create fresh PostgreSQL logical dump
verify old-source → live-destination one-way equivalence
```

one-way equivalence 规则：

```text
旧 source 中每一个文件
必须在 live destination 中存在
size/content checksum 必须一致

live destination 允许有旧 source 不包含的新文件
```

推荐使用：

```text
rsync --checksum --dry-run
```

但绝不能 `--delete`。

完成 fresh verification 后，再要求 explicit approval token 才可删除。

---

# 17. Reclaim State Machine

正式支持：

```text
SOURCE_RETAINED
SOURCE_RECLAIM_READY
SOURCE_RECLAIMED
```

当 `SOURCE_RECLAIMED`：

readiness / doctor 不得再要求 `/DATA/Gallery/immich` 存在。

改为验证：

```text
live destination identity valid
Immich health valid
reclaim evidence valid
migration checkpoint valid
fresh DB backup valid
```

这样未来释放 130GB 后 `OPERATION_SKULD=READY` 不会错误变成 BLOCKED。

---

# 18. Backup Manifest Immich Stats — P2

backup manifest 当前的 media stats 必须改为读取：

```text
IMMICH_MEDIA_ROOT
```

而不是固定旧 source。

可以额外记录：

```json
{
  "immichMedia": {
    "liveRoot": "...",
    "legacySource": "... or null",
    "sourceReclaimState": "..."
  }
}
```

reclaim 后 manifest 仍正确。

---

# 19. Known External / Unknown Container Log Policy — P2

建立 live container log inventory：

```text
container
ownerClass
composePath
logDriver
maxSize
maxFile
currentLogBytes
```

分类：

```text
MANAGED
KNOWN_EXTERNAL
UNKNOWN
```

`MANAGED`：必须 bounded。

`KNOWN_EXTERNAL`：若能确认 compose owner，可逐服务补 bounded logging 并安全 recreate。

`UNKNOWN`：report-only。

禁止：

```text
truncate Docker internal log file
rm Docker log file
generic unknown-container recreate
```

---

# 20. Storage Notifications

至少定义：

```text
storage_warning
storage_critical
storage_recovered
external_storage_missing
external_storage_recovered
storage_maintenance_completed
storage_maintenance_failed
log_policy_violation
repeated_storage_pressure
```

Worldline mapping：

```text
warning/critical → 世界线偏移
external missing → IBN 5100
repeated pressure → 吸引子场
maintenance/recovery → 世界线收束
```

所有通知必须保留真实 facts：

```text
target
freeBytes
freePercent
usedBytes
threshold
observedAt
```

正常 daily check 不通知。

---

# 21. Scheduler Acceptance

storage health LaunchAgent：

```text
loaded
runs >= 1
last exit code = 0
state file updated
```

weekly maintenance LaunchAgent：

```text
loaded
safe apply path exercised
last exit code = 0
protected objects untouched
maintenance evidence stored
```

不能只检查 plist 文件存在。

---

# 22. GC Safety Tests

fixture 必须验证：

```text
current image            KEEP
previous image           KEEP
rollback image           KEEP
checkpoint image         KEEP
running image            KEEP
last N project releases  KEEP
old project release      REMOVE
old dangling image       REMOVE
old build cache          REMOVE
unknown image            REPORT_ONLY
volume                   NEVER DELETE
Immich media             NEVER DELETE
DB                       NEVER DELETE
secrets                  NEVER DELETE
```

源码 guard 必须禁止：

```text
docker volume prune
docker system prune --volumes
docker system prune -a
rm -rf $IMMICH_MEDIA_ROOT
rsync --delete
```

---

# 23. Encrypted Secret Bundle Rehearsal

Fresh clone fixture 必须能：

```text
read metadata manifest
decrypt into temporary directory
validate expected logical ids
validate required file modes
validate restore targets
never print secret
remove plaintext temporary directory
```

fixture 使用：

```text
FIXTURE_SECRET_VALUE
```

并证明 marker 不出现在：

```text
stdout/stderr
Git tracked files
bundle metadata
notifications
release report
```

---

# 24. Fresh Machine Rehearsal

这是 1.4.5 最重要的 acceptance。

至少模拟：

```text
fresh git clone
↓
tracked source only
↓
sanitized host profile fixture
↓
restore fixture encrypted secrets
↓
restore fixture SQLite snapshots
↓
validate fixture PostgreSQL logical dump
↓
load fixture / isolated 9Router artifact path
↓
validate migration registry
↓
manifest/runbook consistency
```

证明：

> 系统的可恢复性不依赖旧工作区任何 ignored implementation file。

---

# 25. Operation Skuld Readiness 新定义

只有以下全部通过才允许：

```text
OPERATION_SKULD=READY
```

Gates：

```text
clean Git worktree
VERSION/release notes consistent
fresh clone rehearsal passed
architecture passed
all required migration scripts tracked
secret inventory passed
encrypted secret bundle valid
secret restore rehearsal passed
service inventory complete
HomeLab migration classifications complete
SQLite consistent snapshots valid
latest Immich PostgreSQL logical backup valid
9Router exact artifact and restore rehearsal valid
Avalon identity valid
Immich live media valid
storage health correctly evaluated
capacity state correctly evaluated
managed logs bounded
scheduled safe GC functioning
image retention functioning
checkpoint retention functioning
reclaim state valid
manifest/runbook consistency passed
```

任何一项失败：

```text
OPERATION_SKULD=BLOCKED
```

必须列 blocker，不得为了通过 readiness 降级标准。

---

# 26. Tests / Release Gate

至少进入总测试：

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

可以根据实际 package scripts 命名，但这些语义必须都覆盖。

所有 changed shell scripts：

```bash
bash -n
```

必要脚本运行 ShellCheck 若环境可用；不能把缺少 shellcheck 当 blocker，除非 repo 当前 CI 已要求。

---

# 27. Release / Deployment Flow

执行顺序：

```text
Phase 1
Fix Git tracked secret migration tools

Phase 2
Storage health state + threshold notifications

Phase 3
Safe scheduled GC + image/checkpoint retention

Phase 4
Service-aware backup + SQLite snapshots + latest Immich pg_dump

Phase 5
9Router isolated restore rehearsal

Phase 6
HomeLab migration/service/secret classification

Phase 7
Immich reclaim hardening + reclaim state machine

Phase 8
Manifest/Runbook convergence + contract tests

Phase 9
Fresh clone rehearsal

Phase 10
Full tests / build / typecheck / secrets / architecture

Phase 11
bump 1.4.4 -> 1.4.5
commit + push

Phase 12
Deploy canonical CasaOS host

Phase 13
Run doctor / storage health / safe maintenance / migration-readiness

Phase 14
Owner release notification

Phase 15
Commit + push deployment evidence
```

本 Goal 不执行 Mac mini cutover，也不执行 Immich source reclaim。

---

# 28. Required Live Evidence

最终报告至少记录：

```text
VERSION=1.4.5

Git:
  required migration scripts tracked
  fresh clone rehearsal passed

Immich:
  live media root = Avalon
  media health passed
  old source retained
  source reclaim pending
  latest pg_dump valid

Storage:
  internal capacity state
  external capacity state
  log policy passed
  daily health scheduler passed
  weekly safe GC scheduler passed
  image retention passed
  checkpoint retention passed

Backup:
  SQLite consistent snapshots passed
  PostgreSQL logical backup passed
  9Router artifact restore rehearsal passed

Secrets:
  inventory passed
  encrypted bundle passed
  restore rehearsal passed

HomeLab:
  service inventory current
  migration classification complete
  secret coverage complete or explicit MANUAL_BLOCKER

Skuld:
  manifest/runbook consistency passed
  OPERATION_SKULD=READY
```

如果 Avalon 当前真实容量已进入 warning/critical，部署 evidence 必须忠实记录真实状态；不能为了让 doctor/readiness 全绿而伪造 healthy。

Readiness 可以接受“已知容量 warning/critical 且 operator 已被通知”的 operational state，前提是空间仍满足迁移/运行所需 hard minimum；是否构成 Skuld blocker 应按明确阈值和 migration requirement 定义，不能隐式处理。

---

# 29. Completion Criteria

1.4.5 完成必须达到：

```text
No hidden local implementation dependency.
No ignored migration implementation script.
No fake healthy storage state.
No unbounded managed log.
No read-only fake weekly maintenance.
No unused retention configuration.
No live PostgreSQL raw-copy-only migration backup.
No undocumented active HomeLab service.
No required migration secret without restore coverage.
No stale hardcoded Immich source requirement after reclaim.
No unsafe future Immich source reclaim.
No manifest/runbook drift.
No generic destructive GC.
```

最终状态：

```text
Amadeus 1.4.5
Operation Skuld: READY
Mac mini cutover: NOT EXECUTED
Immich source reclaim: PENDING
```

完成 1.4.5 后暂停迁移架构改造。下一步只在新 Mac mini 到达后按照 Operation Skuld runbook 执行真实迁移。