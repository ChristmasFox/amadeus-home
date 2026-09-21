# Amadeus 1.4.4 — Operation Skuld Storage & Runtime Hygiene Goal

更新时间：2026-09-21（北京时间）

## 0. Goal 状态与执行方式

这是 Amadeus 1.4.3 之后、Mac mini Operation Skuld 正式执行之前的最后一轮“存储 / 日志 / GC / Secrets / 迁移准备”收口 Goal。

当前 `main` 根 `VERSION` 为 **1.4.3**；本 Goal 完成全部源码、测试、当前 canonical host live 变更、Immich 媒体迁移和部署验证后发布 **Amadeus 1.4.4**。

本轮与 1.4.2 不同：

- **允许并要求**在当前 canonical host 上把 live Immich 的照片 / 视频 / 缩略图 / 转码等大体量媒体存储迁移到已验证的 8TB 外接存储；
- **不允许**格式化、重分区或擦除外接盘；
- **不允许**在目标副本验证完成前删除、覆盖、原地移动源 Immich 媒体；
- **任何同步命令禁止使用 `--delete`**；
- 迁移完成后旧源媒体默认保留为 rollback 副本；释放旧媒体副本所占空间必须走单独的二次验证 / 显式 reclaim gate，不能作为普通 `/goal` 的无条件尾部动作；
- Docker logs / build cache / 旧镜像 / 临时文件可以按本 Goal 的明确分类和 retention policy 自动清理；
- Docker volumes、数据库、secrets、当前 release、上一个可回滚 release、未知归属路径绝不能被通用 GC 清理。

建议 Codex 执行：

```text
/goal Implement docs/AMADEUS_1_4_4_OPERATION_SKULD_STORAGE_RUNTIME_HYGIENE_GOAL.md completely. Re-audit the current main branch and live CasaOS host before changing anything. Stay within scope. This goal is authorized to migrate the live Immich media root to the verified external 8TB storage, apply safe Docker/log/storage hygiene, extend Operation Skuld secret and service coverage, release Amadeus 1.4.4, commit and push, deploy to the current canonical host, and record live evidence. NEVER format or repartition the external disk. NEVER use rsync --delete. NEVER delete or mutate the old Immich media source before destination copy, checksum/equivalence checks, DB backup, live cutover and post-cutover verification all pass. Do not reclaim the old Immich source copy unless the explicit source-reclaim gate defined by this goal is separately approved; otherwise leave SOURCE_RECLAIM_PENDING and report reclaimable bytes. Do not perform the Mac mini cutover in this goal.
```

用户已授权本 Goal 范围内的：

- 源码、测试、文档、版本更新；
- commit / push；
- 当前 canonical CasaOS host 上的 1.4.4 release；
- 当前 live Immich 的受控停写 / 备份 / 外接盘媒体复制 / mount 切换 / 重启验证；
- Docker logging policy、受保护的 GC、定时 storage health；
- 非 Git secrets 的 inventory、加密导出 / 恢复演练；
- Immich / 9Router / changedetection 等 Operation Skuld migration coverage 更新。

仍必须遵守根 `AGENTS.md`、现有 release gate、secrets、side-effect、rollback 和 owner notification 约束。

---

# 1. Objective

本轮完成六个相互关联的目标：

1. **Operation Skuld Readiness Sync**
   - 修复 1.4.2 readiness 对 `VERSION=1.4.2` 的硬编码；
   - 当前版本以后继续升级时 readiness 不能再次失效；
   - 修复 migration manifest 重复 JSON key、旧 LAN IP / host-specific 假设；
   - 把 Immich、9Router data、changedetection compatibility state、完整 secret inventory 纳入迁移边界。

2. **Immich External Media Migration**
   - 将 live Immich 大体量媒体根目录迁到 8TB 外接盘；
   - PostgreSQL / Redis / 小型状态继续放内置 SSD / CasaOS AppData；
   - 对外接盘身份 fail-closed 校验；
   - copy-first、verify-first、cutover-after-verification；
   - 源媒体不在本 Goal 中无条件删除。

3. **Runtime Storage Hygiene**
   - Docker stdout/stderr 有明确 rotation 上限；
   - 识别并阻止 unbounded logging；
   - 已存在的大日志通过安全 recreate / service-specific 方法处理，不直接 truncate Docker log internals；
   - 应用内部未知日志只报告，不通用删除。

4. **Safe Deployment GC**
   - 每次成功 release 后自动清理 dangling images、过期 build cache、明确可删除的旧 project images / checkpoints；
   - current + previous + rollback 保留；
   - volumes 和 protected data 永不进入通用 GC；
   - 清理前后记录容量并向 owner 推送释放空间结果。

5. **Storage Observability & Worldline Notification**
   - 定时观测 Mac 内置盘、OrbStack / CasaOS、8TB 外接盘、Docker、logs、images、build cache；
   - 磁盘压力、外接盘失联、清理成功 / 失败走 Worldline 结构化通知；
   - 正常状态不刷屏；真正发生异常或实际释放明显空间时才主动通知。

6. **Encrypted Secret Migration**
   - Git 只记录 secret metadata / logical id / restore target；
   - 所有 live service 的 API key / token / password / SSH key / runtime credential state 做 inventory；
   - export 为加密 bundle，而不是裸 `tar.gz`；
   - 新 Mac restore 前可 dry-run 验证完整性和权限；
   - secret value 永不进入 Git、普通日志、deployment report 或通知文本。

---

# 2. Non-negotiable Safety Invariants

## 2.1 Immich 媒体零丢失边界

以下条件全部为硬约束：

```text
NO FORMAT
NO REPARTITION
NO rsync --delete
NO in-place source move before verification
NO source cleanup before verified cutover
NO generic rm -rf on media roots
NO destructive recovery guess
```

实施必须遵守：

```text
Source Media
   ↓ read-only / copy
Destination on verified 8TB
   ↓
Equivalence Verification
   ↓
Fresh DB Backup
   ↓
Live Mount Cutover
   ↓
Health + Asset Verification
   ↓
Source Retained
   ↓
SOURCE_RECLAIM_PENDING
```

如果外接盘容量、文件系统、挂载、权限、volume identity、目标路径、checksum、数据库备份、Immich health 任一项无法确认：

> **停止迁移并报告 blocker；绝不为了“完成 Goal”猜测、格式化、强行修复或删除。**

## 2.2 External disk fail-closed

禁止只判断 `/Volumes/Avalon` 或目标目录“存在”就认为外接盘已经挂载。

必须至少验证：

- macOS 看到真实外接 volume；
- host profile 中的 expected volume identity / sentinel 与实际一致；
- OrbStack / CasaOS 看到的路径与 host 指向同一外接存储；
- 目标 path 的 filesystem/device 与 macOS 内置系统盘不同；
- 目标可读写；
- 目标剩余容量满足当前 media bytes + safety margin；
- 如果路径只是因为 volume 未挂载而在本机 SSD 上出现的普通目录，必须 hard fail。

建议同时使用：

```text
EXTERNAL_STORAGE_ROOT
EXTERNAL_STORAGE_VOLUME_UUID
EXTERNAL_STORAGE_SENTINEL_ID
IMMICH_MEDIA_ROOT
```

本地真实值进入 `infra/host-profile.env`，模板只保留变量名和示例，不提交机器特定 UUID / secret。

可在外接盘根写入非 secret sentinel，例如：

```json
{
  "schemaVersion": 1,
  "storageId": "avalon-primary-8tb",
  "purpose": "amadeus-homelab-storage"
}
```

该 sentinel 是身份检查，不是凭据。

## 2.3 Protected vs disposable

正式定义：

```text
PROTECTED
- user media
- PostgreSQL / SQLite / state DB
- secrets / API keys / session credentials
- owner outbox
- active compose / config
- current image
- previous known-good image
- explicit rollback image/tag
- current + protected deployment checkpoints

REBUILDABLE
- model cache
- Docker build cache
- downloaded package caches
- generated runtime artifacts

ROTATABLE
- Docker stdout/stderr logs
- explicitly registered application logs

DISPOSABLE
- dangling images
- old unprotected project release images
- expired build cache
- temp build files
- expired generated artifacts

UNKNOWN
- anything not classified above
```

通用 GC **只允许**处理 `REBUILDABLE / ROTATABLE / DISPOSABLE` 中有明确规则的对象。

`UNKNOWN` 永远是 report-only。

---

# 3. Baseline Re-audit

实施第一步重新读取最新 `main` 和 live runtime，不允许只依据本计划中的 2026-09-21 快照。

当前已知基线：

```text
VERSION = 1.4.3
OpenClaw = single Agent runtime
Product Radar = structured Worldline owner notifications
9Router live = local/9router:0.5.81
Immich live = v3.2.2 + VectorChord PostgreSQL
Operation Skuld 1.4.2 evidence = previously READY
```

但当前 readiness 已产生漂移：

- `scripts/migration-readiness.sh` 仍硬编码 `1.4.2`；
- current `VERSION` 已经是 `1.4.3`；
- 1.4.2 manifest 没有完整覆盖 Immich / 9Router protected data；
- `backup.sh` 默认范围不包含 Immich / 9Router；
- doctor 对 Immich 和 9Router 只覆盖不足或没有覆盖；
- OpenClaw template 仍存在旧 host LAN IP 假设；
- migration manifest `currentHost.machine` 存在重复 key；
- 8TB media root 尚未成为 Immich live source of truth。

因此实施前：

> 不得沿用旧的 `OPERATION_SKULD=READY` 作为 1.4.4 的验收证据。

必须重新生成新的 readiness evidence。

---

# 4. Desired Runtime Topology

完成 1.4.4 后：

```text
Mac internal SSD
├── OrbStack / CasaOS runtime
├── OpenClaw
├── Product Radar SQLite
├── PUBG / Identity SQLite
├── 9Router small runtime/data
├── Immich PostgreSQL / Redis
├── configs / secrets
└── bounded logs / bounded build state

8TB external storage (verified volume)
├── immich/
│   └── data/                 # Immich managed media root
├── media/...                 # existing Homelab media if applicable
└── backups/
    └── operation-skuld/
        ├── encrypted secrets bundle
        ├── DB/config backups
        ├── manifests/checksums
        └── optional exact 9Router image export
```

核心原则：

> **大文件媒体走外接 8TB；数据库和高频小文件状态留内置 SSD；备份和 migration artifact 与 live media 分目录；日志 / cache 有上限。**

---

# 5. Phase 1 — Fix Operation Skuld Version / Host Drift

## 5.1 Dynamic readiness version check

删除：

```bash
check_version() { [[ "$(... show)" == '1.4.2' ]]; }
```

改为验证：

- `VERSION` 是合法 Amadeus version；
- readiness 读取的版本等于根 `VERSION`；
- 当前 release notes headline 与根版本一致；
- 不硬编码具体 release number；
- 如需要与 live 比较，比较 live image source commit 对应版本与当前 repo version，而不是常量。

测试必须包含：

```text
1.4.3 -> passes when root is 1.4.3
1.4.4 -> passes when root is 1.4.4
arbitrary stale hardcoded value -> test must catch
```

## 5.2 Host-neutral addresses

把 runtime template 中旧 LAN IP / 当前 Mac 假设迁入 host profile。

至少评估并变量化：

```text
HOME_LAB_HOST
HOME_LAB_BASE_URL
HOME_LAB_GLANCES_URL
HOME_LAB_UPTIME_URL
CONTROL_UI_LAN_ORIGIN
EXTERNAL_STORAGE_ROOT
IMMICH_MEDIA_ROOT
```

不要把新 Mac 未来 IP 写死在 source。

## 5.3 Fix migration manifest schema

- 删除重复 `currentHost.machine` key；
- schema 明确 `defaultMachine` 与 `profileResolvedMachine` 的差异；
- JSON fixture 测试拒绝 duplicate-key manifest；
- 增加 `storage`, `serviceInventory`, `secretInventory`, `protectedArtifacts` sections。

---

# 6. Phase 2 — Track Immich as First-class Infrastructure

当前 Immich 只有 live CasaOS compose / deployment evidence，不足以完成 Operation Skuld。

1.4.4 必须新增一个不含 secrets 的 tracked Immich template，例如：

```text
infra/docker/homelab/immich/docker-compose.example.yml
```

或在现有 repo 规范更适合的位置建立等价 source。

要求：

- 从 **live compose re-audit** 生成，不凭记忆重写；
- server / machine-learning / PostgreSQL / Redis 版本与 live 一致；
- PostgreSQL VectorChord 设置与 live 一致；
- Immich media root 由 env / host profile 注入；
- PostgreSQL data 保持 AppData / internal SSD；
- secrets 只引用外部 env / secret file；
- 加入 bounded logging policy；
- CasaOS metadata 如需要可保留；
- source template 不包含真实 DB password / API key。

## 6.1 Immich data classification

明确区分：

```text
IMMICH_MEDIA                PROTECTED / EXTERNAL
IMMICH_POSTGRES             PROTECTED / INTERNAL
IMMICH_REDIS                REBUILDABLE unless current install proves durable state is required
IMMICH_MODEL_CACHE          REBUILDABLE
IMMICH_ENV/DB_PASSWORD      PROTECTED SECRET
IMMICH_COMPOSE              TRACKED TEMPLATE + live rendered copy in backup
```

不要把 PostgreSQL 放到外接 8TB 媒体盘，除非未来另有专门 Goal。

---

# 7. Phase 3 — External 8TB Storage Profile & Preflight

新增 storage profile / helper，例如：

```text
scripts/storage-profile.sh
scripts/storage-preflight.sh
```

或者融入 `host-profile.sh`，但必须保持职责清晰。

建议 host profile 新增：

```text
EXTERNAL_STORAGE_ROOT=/Volumes/Avalon
EXTERNAL_STORAGE_VOLUME_UUID=
EXTERNAL_STORAGE_SENTINEL_ID=avalon-primary-8tb
IMMICH_MEDIA_ROOT=/Volumes/Avalon/immich/data
SKULD_BACKUP_ROOT=/Volumes/Avalon/backups/operation-skuld
STORAGE_WARN_FREE_PERCENT=20
STORAGE_CRITICAL_FREE_PERCENT=10
STORAGE_WARN_FREE_BYTES=
DOCKER_LOG_MAX_SIZE=20m
DOCKER_LOG_MAX_FILE=5
DOCKER_BUILD_CACHE_RETENTION_HOURS=168
DEPLOYMENT_IMAGE_RETENTION_COUNT=2
DEPLOYMENT_CHECKPOINT_RETENTION_COUNT=3
```

实际变量名可按 repo 风格调整，但不要写死散落常量。

## 7.1 Preflight hard blockers

至少检查：

- volume mounted；
- volume identity；
- target not on internal root device；
- target is not symlink escaping to internal disk；
- readable / writable；
- expected sentinel；
- free space >= current Immich source bytes + configured safety margin；
- no existing conflicting destination tree unless it belongs to previous resumable migration；
- Immich DB backup target writable；
- CasaOS / OrbStack path sees same content；
- current source and destination are not same filesystem/path by accident；
- source is readable and not already partially replaced by bind mount。

如 filesystem / mount capability 不适合当前 setup：

- 不格式化；
- 不擦盘；
- 不迁移；
- 输出 blocker 和建议人工处理步骤。

---

# 8. Phase 4 — Immich Media Migration Tooling

新增一个专用、可恢复、默认 dry-run 的 migration script，例如：

```text
scripts/migrate-immich-media.sh
```

必须支持：

```text
--plan
--precopy
--cutover
--verify
--status
```

旧源回收必须是不同命令 / 不同脚本，例如：

```text
scripts/reclaim-immich-old-source.sh
```

不能把“迁移”和“删除旧副本”做成同一个默认动作。

## 8.1 Source discovery

脚本必须从 live compose / mounted container / config 中确认实际 source path。

不要假设文档中的 `/DATA/Gallery/immich` 永远正确。

输出只允许显示路径 / 大小 / file counts，不打印 secrets。

## 8.2 Pre-copy while live

为了缩短停机：

1. Immich 保持运行；
2. destination 为空或属于 resumable checkpoint；
3. 进行第一轮 copy；
4. **禁止 `--delete`**；
5. 保留 timestamps / directory structure；
6. 记录：
   - file count
   - total bytes
   - source path
   - destination path
   - startedAt / completedAt
   - rsync exit status
7. copy failure 不影响 source。

优先使用可 resume 的 rsync 方案，实际 flags 需针对 live filesystem 兼容性验证。

禁止使用会导致 partial destination 覆盖 source 的反向命令。

## 8.3 Quiesce / final sync

进入短 maintenance window：

1. 对 Immich 创建 fresh DB dump；
2. 记录 live compose；
3. 停止会写 media 的 Immich server/jobs；
4. PostgreSQL 保持可用于 dump / integrity；
5. final incremental sync；
6. 再进行 source/destination equivalence verification；
7. 只有验证通过后才允许修改 mount；
8. 任何失败立即恢复旧 compose / source mount 并重新启动。

## 8.4 Required equivalence checks

迁移不能只用“文件数量差不多”。

至少要求：

```text
source file count == destination file count
source total logical bytes == destination total logical bytes
rsync checksum dry-run reports no content differences
all expected Immich top-level storage subtrees present
no zero-byte unexpected truncation introduced by migration
no unresolved copy errors
fresh DB dump exists and is readable
```

可额外使用 SHA-256 / BLAKE3 manifest；若整个媒体库 hash 成本过高，至少 `rsync --checksum --dry-run` 作为内容 equivalence gate。

checksum 过程只读。

## 8.5 Cutover

验证后：

1. 修改 live compose media mount 指向 `IMMICH_MEDIA_ROOT`；
2. 不改变 PostgreSQL media references / DB 内容；
3. recreate/start Immich；
4. health 等待；
5. 检查 server / ML / PostgreSQL / Redis；
6. 检查 public ping / API；
7. 抽样验证历史 image / video / thumbnail / encoded video；
8. 验证 destination 实际收到新的 runtime reads/writes；
9. old source path 不删除。

## 8.6 Post-cutover source retention

1.4.4 默认结束状态：

```text
IMMICH_LIVE_MEDIA=EXTERNAL_8TB
IMMICH_DESTINATION_VERIFIED=yes
IMMICH_OLD_SOURCE=retained
SOURCE_RECLAIM_PENDING=yes
```

部署报告必须包含：

```text
旧源占用字节
预计可回收空间
旧源路径
目标路径
等价校验结果
是否已 reclaim
```

不得伪装成“已经释放媒体空间”，如果旧副本仍存在。

## 8.7 Explicit old-source reclaim gate

提供以后可执行的 source reclaim 工具，但 1.4.4 `/goal` 默认不调用。

reclaim 前必须重新执行：

- external volume identity；
- destination health；
- file count / bytes；
- checksum equivalence；
- fresh DB backup；
- Immich health；
- old path 确认不是当前 bind source；
- explicit operator approval token / flag。

只允许删除 **旧 duplicate source tree**，不得删除 external live media。

删除后执行：

- guest filesystem trim（如适用）；
- supported OrbStack sparse disk reclaim / compaction only if officially supported and discovered；
- 重新测量 macOS host free space。

禁止手工修改 OrbStack VM disk image 来“压缩”。

---

# 9. Phase 5 — Docker Logging Policy

## 9.1 Desired policy

受项目管理 / 新增的 compose 默认：

```yaml
logging:
  driver: local
  options:
    max-size: "20m"
    max-file: "5"
```

具体数值由 host profile / retention policy 提供；不要散落硬编码。

目标：单 container stdout/stderr 可控，不再出现十几 GB 无界增长。

## 9.2 Global default

评估 CasaOS Docker daemon 当前 `/etc/docker/daemon.json`：

- 先备份；
- preserve unrelated keys；
- 不覆盖用户已有有效 log policy；
- 如果可安全 merge，则设置 new container default；
- daemon config 必须 JSON validate；
- 任何 Docker daemon restart 之前记录 active containers / compose / health；
- restart 后逐项确认恢复。

注意：修改 daemon default 不会自动改变已存在 container 的 log driver。

## 9.3 Existing containers

新增 audit：

```text
container
log driver
rotation options
current log size
compose owner
safe-to-recreate?
```

分类：

```text
COMPLIANT
UNBOUNDED_RECREATABLE
UNBOUNDED_UNKNOWN
CUSTOM_POLICY
```

处理：

- managed + safely recreatable → controlled recreate 后验证；
- unknown → notify / report only；
- 不直接 truncate Docker private log files；
- 不删除 container filesystem 来“清日志”。

## 9.4 Application-owned logs

扫描大文件：

```text
/DATA/AppData/*/**/logs
*.log
*.log.*
```

但只允许对 registered service policy 执行 rotate/delete。

未知应用日志：

```text
UNKNOWN -> report-only
```

新增 `docs/STORAGE_RETENTION_POLICY.md` 或等价 source，记录每类日志 owner / retention / cleanup action。

---

# 10. Phase 6 — Safe Storage Maintenance / GC

新增：

```text
scripts/storage-maintenance.sh
```

默认 dry-run。

推荐模式：

```text
--status
--plan
--post-deploy
--scheduled
--apply
```

## 10.1 Protected image set

每次 cleanup 前建立 protect set：

```text
image IDs used by running containers
current Amadeus image
previous known-good Amadeus image
current Product Radar image
previous known-good Product Radar image
current 9Router image
explicit rollback-* image/tag
images referenced by latest protected checkpoints
```

不能只按 age 删除镜像。

## 10.2 Allowed cleanup

可以自动清理：

- dangling images；
- unreferenced project images beyond retention count；
- BuildKit cache older than configured age；
- completed temporary build artifacts；
- expired deployment checkpoints beyond policy；
- registered rotated logs beyond retention。

## 10.3 Forbidden cleanup

任何模式下禁止：

```text
docker system prune --volumes
docker volume prune
blind docker system prune -a
generic rm -rf /DATA/AppData/*
generic deletion under /Volumes/Avalon/immich
unknown log deletion
secret archive deletion without retention policy
```

## 10.4 Deployment integration

成功部署流程变为：

```text
version gate
→ backup/checkpoint
→ build/deploy
→ health/preflight
→ owner release sent
→ mark current/previous protected
→ conservative post-deploy maintenance
→ storage delta report
```

post-deploy maintenance 失败：

- 不把已经健康的 release 自动 rollback；
- 标记 `POST_DEPLOY_MAINTENANCE=warning|failed`；
- 发送 structured owner warning；
- 保留清理 plan / evidence。

如果 storage 已 critical 到可能影响运行，则明确提升 incident severity。

---

# 11. Phase 7 — Storage Health & Worldline Events

新增 storage producer / adapter coverage。

`WORLDLINE_PRODUCER_REGISTRY` 增加：

```text
storage
```

建议事件：

```text
storage_health
storage_pressure
storage_maintenance_completed
storage_maintenance_failed
external_storage_missing
external_storage_recovered
log_policy_violation
docker_cache_pressure
```

映射：

```text
storage_pressure             -> 世界线偏移
storage_maintenance_completed -> 世界线收束
external_storage_missing      -> IBN 5100 / critical dependency
external_storage_recovered    -> 世界线收束
repeated storage pressure >= 3 -> 吸引子场
log_policy_violation          -> 世界线偏移
```

禁止把普通磁盘告警映射为 SERN。

## 11.1 Metrics

至少采集：

```text
Mac internal total/free/used
external 8TB total/free/used
OrbStack /DATA usage
Docker images usage
Docker build cache usage
container logs usage
largest AppData dirs
largest registered logs
protected checkpoint usage
Immich media bytes
```

不读取/发送 media filenames 作为日常通知。

## 11.2 Notification behavior

正常健康：默认不主动刷屏。

触发主动通知：

- crossing warning / critical threshold；
- external storage missing / recovered；
- cleanup actually frees meaningful space；
- cleanup fails；
- unbounded log > threshold；
- recurrent pressure enters attractor field。

成功清理示例事实：

```text
释放前可用空间
释放后可用空间
释放空间总量
旧镜像释放量
build cache 释放量
rotated logs 释放量
protected objects count
```

通知文案走现有 deterministic Worldline Presentation；不让 shell script 自己拼 Steins;Gate prose。

---

# 12. Phase 8 — Scheduled Maintenance

在 current Mac 和未来 Mac mini 使用可迁移的 scheduler。

优先方案：tracked macOS LaunchAgent / install script，因为需要同时观察：

- macOS internal SSD；
- external volume；
- OrbStack Docker；
- owner notification outbox。

可建立：

```text
com.amadeus.storage-health
com.amadeus.storage-maintenance
```

建议：

```text
health: daily
maintenance: weekly + post-deploy
```

具体时间不要硬编码进业务逻辑，可由 host profile / installer 配置。

安装器必须：

- idempotent；
- 可 `--check` / `--apply` / `--uninstall`；
- 不把 secret value 放 plist；
- 日志自身也有 rotation；
- Mac mini migration runbook 明确重新安装。

如 repo 当前更适合在 OrbStack 内运行定时器，可选择等价实现，但必须解释为什么能同时正确验证 macOS external volume identity。

---

# 13. Phase 9 — Complete Service & Secret Inventory

## 13.1 Discover active services

不要只列 OpenClaw。

从 current CasaOS re-audit：

```text
/var/lib/casaos/apps/*/docker-compose.yml
running containers
bind mounts
named volumes
env_file
secret files
environment variable names
```

生成 sanitized service inventory，例如：

```text
docs/OPERATION_SKULD_SERVICE_INVENTORY.md
```

内容允许：

- service name；
- compose path；
- persistent data paths；
- secret variable names；
- rebuild / restore strategy；
- migration classification。

内容禁止：

- password value；
- token value；
- API key value；
- private key content。

## 13.2 Minimum protected service coverage

至少完整覆盖：

```text
OpenClaw
Product Radar
PUBG / Identity data
9Router
Immich
changedetection (while compatibility is ACTIVE)
Media adapter persistent state if any
Telegram / WhatsApp / KOOK credential state
VPS / NAS SSH credentials
KiwiVM credentials
```

对 aria2 / Jellyfin / qBittorrent / Emby / alist / other active CasaOS apps：

- 如 live host 当前运行，inventory 必须发现；
- 如果不属于本 repo 的 restore automation，也必须列为 external service with explicit manual/automated restore path；
- 不允许因为不在 Git 就被 Operation Skuld 忽略。

---

# 14. Phase 10 — Secret Inventory

新增：

```text
scripts/secrets-inventory.sh
```

输出只能是 metadata：

```text
PASS 9router JWT secret
PASS Immich DB password
PASS Telegram bot token
PASS WhatsApp runtime credential state
...
```

允许检查：

- exists；
- non-empty；
- owner / mode；
- source type；
- restore destination；
- whether included in encrypted bundle。

禁止：

```text
cat secret
print first/last characters
checksum secret value into Git report
send secret length if it leaks semantics
include secret in exception message
```

## 14.1 Inventory model

扩展 migration manifest，例如：

```json
{
  "id": "9router-jwt-secret",
  "service": "9router",
  "sourceType": "environment-or-env-file",
  "required": true,
  "restoreTarget": "9router runtime env",
  "contentsInGit": false,
  "encryptedBundle": true
}
```

同样覆盖：

```text
9Router API_KEY_SECRET
9Router JWT_SECRET
9Router INITIAL_PASSWORD
9Router MACHINE_ID_SALT
9Router provider/account state in data dir
Immich DB password / env
OpenClaw gateway token
OpenClaw 9Router API key
PUBG API key
Telegram token
KOOK token
WhatsApp owner / runtime credential state
SSH private keys / known_hosts
KiwiVM credentials
other active service env secrets
```

9Router provider keys如果存于 `/DATA/AppData/9router/data` 内，不尝试把 value 提取成文本；把其 data directory 本身视为 encrypted protected state。

---

# 15. Phase 11 — Encrypted Secret Bundle

当前 `backup.sh --include-secrets` 的独立 `tar.gz` 只有 filesystem permission，不等于静态加密。

1.4.4 新增真正 encrypted export。

建议：

```text
scripts/export-skuld-secrets.sh
scripts/import-skuld-secrets.sh
```

使用 `age` 或 repo 允许的等价现代加密工具。

## 15.1 Encryption modes

支持至少一种：

```text
age recipient public key
```

可选支持 interactive passphrase：

```text
age -p
```

约束：

- private identity / passphrase 永不进 Git；
- private identity 不和 encrypted bundle 放在同一个唯一介质上；
- public recipient 可以进入 local host profile；
- export script 不把 plaintext secret archive 留在磁盘；
- 如必须创建 temp plaintext，使用 0700 temp dir / 0600 file，并在成功或失败时 cleanup；
- shell tracing 必须关闭；
- bundle checksum 只针对 encrypted artifact。

建议输出：

```text
/Volumes/Avalon/backups/operation-skuld/<timestamp>/
  secrets.age
  secrets.manifest.json
  secrets.age.sha256
```

manifest 只含 logical ids / paths / modes / encrypted file metadata。

## 15.2 Restore rehearsal

在 temporary directory：

1. 解密；
2. 验证 required logical ids；
3. 验证 target modes；
4. 不写入 production；
5. 删除 plaintext temp；
6. 输出 `SECRET_RESTORE_REHEARSAL=passed`。

不得在 CI / report 中暴露内容。

---

# 16. Phase 12 — Expand Backup Strategy

修改 `scripts/backup.sh` 或拆分出 service-aware backup。

默认 Operation Skuld backup 至少包含：

```text
openclaw
product-radar
9router
immich AppData / DB config
changedetection state while compatibility-required
media adapter state if persistent
```

Immich 外接大媒体 **不再 tar 进 migration archive**；它通过外接盘直接作为 portable protected storage。

但 backup metadata 必须记录：

```text
IMMICH_MEDIA_ROOT
volume identity
file count
bytes
verification timestamp
```

backup manifest 增加：

- repo commit；
- release version；
- service inventory version；
- image refs；
- protected paths；
- encrypted secret bundle ref；
- Immich media external identity；
- 9Router data archive；
- fresh Immich DB dump。

## 16.1 Exact 9Router runtime artifact

由于当前 9Router 为自建 `local/9router:0.5.81`，Operation Skuld 应避免未来 npm dependency drift。

至少完成其中一种：

A. export 当前 live exact image：

```text
docker save -> compressed artifact -> SHA-256
```

并在新 Mac import；

或 B. 把 build dependency tree 变为真正可重复并验证。

优先 A 作为 migration safety net；tracked Dockerfile 仍作为 rebuild path。

记录：

```text
image ID
digest if available
package version
artifact checksum
```

---

# 17. Phase 13 — Doctor Expansion

`doctor.sh` 必须从“核心 Agent health”升级为“Operation Skuld runtime health”。

至少增加：

## Immich

```text
expected containers running/healthy
local /api/server/ping
PostgreSQL available
VectorChord / vector extension state as appropriate
media root identity == verified external volume
media root readable
```

不要把 public internet endpoint 作为唯一 health。

## 9Router

```text
container running
expected package/image version
/dashboard health
/v1/models no-key auth boundary
optionally authenticated bounded smoke without printing key
```

## Storage

```text
external volume identity
internal disk threshold
external disk threshold
log policy compliance summary
Docker storage pressure
```

Doctor 仍保持 read-only。

---

# 18. Phase 14 — Migration Readiness Expansion

新的 `migration-readiness.sh` 必须包含：

```text
clean Git worktree
current dynamic VERSION
tracked Skuld source files
no retired runtime
host profile resolved
external storage identity
Immich media on external volume
Immich DB backup path available
Immich media verification checkpoint
9Router protected data
9Router exact runtime artifact/rebuild evidence
changedetection compatibility data
complete secret inventory
encrypted secret bundle exists
secret restore rehearsal
SQLite integrity
Immich PostgreSQL backup validation
owner outbox contract
expected cron/jobs
FashionSigLIP health
Docker log policy status
backup manifest
service inventory
```

只有 0 failure 时：

```text
OPERATION_SKULD=READY
```

如 old Immich source still retained：

```text
IMMICH_SOURCE_RECLAIM=READY_BUT_PENDING
```

这不是 migration blocker；它只是提醒当前内置盘还有可回收 duplicate bytes。

---

# 19. Phase 15 — Tests

本 Goal 必须增加真实负例，不接受只有 happy path。

## 19.1 Version readiness tests

- current version dynamic pass；
- stale hardcoded version fixture fail；
- release notes mismatch fail。

## 19.2 External storage tests

fixtures：

```text
volume missing -> fail
sentinel mismatch -> fail
path exists on wrong device -> fail
insufficient free space -> fail
valid storage -> pass
```

测试不得真的格式化 / mount / unmount production disk。

## 19.3 Immich migration tests

在 temp fixture：

- source media tree；
- destination tree；
- first copy；
- resumed copy；
- changed file final sync；
- count/bytes equivalence；
- checksum mismatch -> block cutover；
- copy error -> source untouched；
- verify source still exists after normal migration flow；
- source reclaim command refuses without explicit gate；
- static check forbids `rsync --delete` in migration scripts。

## 19.4 GC tests

fake image inventory：

```text
running current -> KEEP
previous known-good -> KEEP
rollback tag -> KEEP
checkpoint referenced -> KEEP
old unreferenced project image -> REMOVE
unrelated user image -> KEEP unless dangling-only policy says safe
volume -> NEVER TOUCHED
```

测试脚本中如果出现：

```text
docker volume prune
docker system prune --volumes
```

直接失败。

## 19.5 Logging tests

- compose templates have bounded logging；
- audit identifies unbounded container；
- UNKNOWN service does not auto-delete logs；
- current policy parsing works。

## 19.6 Secret tests

- required secret missing -> readiness fail；
- wrong file permissions -> fail；
- inventory output contains no known fixture secret values；
- encrypted export contains no plaintext marker；
- decrypt rehearsal restores expected fixture files；
- temp plaintext removed；
- Git source scan catches fixture secret leakage。

## 19.7 Manifest tests

- JSON duplicate key detector；
- Immich / 9Router / storage / secrets coverage required；
- no secret values；
- external media root is not archived as ordinary AppData。

---

# 20. Phase 16 — Architecture Fitness

扩展 `check-architecture.mjs` / fixtures：

必须守住：

- Worldline terms only in Presentation / notification boundary；
- `storage` producer registered；
- Product Radar core 仍 transport/theme neutral；
- Immich template contains no secret values；
- no retired LangBot/n8n runtime reintroduced；
- no `/Users/blacksidev` host path；
- no hardcoded old LAN IP in runtime templates；
- no `rsync --delete` in Immich migration source；
- no dangerous Docker volume prune in maintenance source；
- no generic `/DATA/AppData/*` delete path；
- no media-root generic deletion；
- secret export source never logs values。

---

# 21. Phase 17 — Source / Docs Update

至少同步：

```text
VERSION
RELEASE_NOTES.md
.agent/state.md
docs/CURRENT_TASK.md
docs/PROJECT_STATE.md
docs/DEVELOPER_WORKFLOW.md
docs/INFRASTRUCTURE_CLASSIFICATION.md
docs/PROACTIVE_NOTIFICATION_PRODUCERS.md
docs/OPERATION_SKULD_MIGRATION_MANIFEST.json
docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md
docs/OPERATION_SKULD_SERVICE_INVENTORY.md
docs/STORAGE_RETENTION_POLICY.md
infra/host-profile.env.example
```

`CURRENT_TASK` 顶部只描述当前 1.4.4，不把历史 release 混成 current state。

---

# 22. Phase 18 — Release Order

为了避免 live migration 与 source commit 混乱，推荐严格顺序：

```text
1. Re-audit source/live
2. Implement source + tests
3. Run full source validation
4. Bump VERSION -> 1.4.4
5. Commit implementation
6. Push implementation
7. Create fresh pre-change Operation Skuld checkpoint
8. Create fresh Immich DB dump
9. Export encrypted secrets + restore rehearsal
10. Export/record exact 9Router runtime artifact
11. External storage preflight
12. Immich precopy
13. Controlled Immich quiesce + final sync
14. Equivalence verification
15. Immich live media mount cutover
16. Immich live health / asset verification
17. Apply logging/storage policy
18. Deploy/recreate Amadeus-managed services as required
19. Post-deploy conservative GC
20. Doctor + migration-readiness
21. Owner Worldline notifications confirmed
22. Write deployment/migration evidence
23. Commit evidence
24. Push evidence
```

如果步骤 7-16 任一 Immich migration gate 失败：

- 不继续到 source reclamation；
- restore old compose / old source mount；
- keep source untouched；
- record failure evidence；
- Amadeus release source 可以存在，但 live migration 状态必须准确标记 `BLOCKED/ROLLED_BACK`。

---

# 23. Rollback — Immich 时间跳跃

## 23.1 Before cutover

最简单：

- source 未动；
- stop migration；
- discard / retain partial destination as resumable staging；
- do not delete source。

## 23.2 After mount cutover but before source reclaim

1. stop Immich writes；
2. restore pre-cutover compose；
3. remount old source；
4. start Immich；
5. health verify；
6. preserve external copy for forensic comparison；
7. no destructive reverse rsync。

## 23.3 After source reclaim

本 Goal 默认不执行该阶段。

未来如果 operator explicitly reclaimed old source，rollback 只能依赖：

- verified external live media；
- DB backup；
- other independent backup if present。

因此 source reclaim 必须视为单独高风险 operation。

---

# 24. Rollback — Logging / Docker Maintenance

- daemon.json 修改前留 timestamped backup；
- Docker restart failure → restore daemon config / restart / verify；
- project image GC 永不删除 current/previous/rollback；
- 如果错误删除 rebuildable cache，不进行“恢复”，让 cache 重建；
- 如果工具无法证明对象 classification，停止清理。

---

# 25. Rollback — Secret Migration

- old Mac secrets remain canonical until Mac mini cutover completes；
- encrypted export does not rotate credentials；
- 1.4.4 不因为创建 bundle 就删除旧 secret files；
- import rehearsal only targets temp；
- Mac mini future restore succeeds before any old-host secret cleanup；
- rotation is a separate post-cutover security operation。

---

# 26. Owner Notification Acceptance

1.4.4 应至少产生以下真实 owner events（不向群聊发测试垃圾）：

## Release success

```text
世界线收束
Amadeus 1.4.4 deployed
```

## Immich storage cutover

```text
世界线收束
Immich 媒体存储已切换至 8TB 外接盘
```

facts 至少：

```text
source bytes
destination bytes
file count
external storage free bytes
old source retained yes/no
reclaimable bytes
```

不要发文件名列表。

## Storage cleanup

如实际释放 > configured threshold：

```text
世界线收束 · 存储维护完成
```

## External storage missing

```text
IBN 5100 · 关键存储节点失联
```

## Cleanup failure

```text
世界线偏移
```

不允许普通 cleanup failure 升级成 SERN。

---

# 27. Definition of Done

以下全部满足才能标记 1.4.4 完成：

## Source

- `VERSION=1.4.4`；
- all tests pass；
- build/typecheck pass；
- architecture / secret scan pass；
- no dangerous forbidden cleanup/migration patterns；
- docs/current state synced。

## Immich

- external 8TB identity verified；
- live Immich media root is external 8TB；
- PostgreSQL remains internal/AppData；
- fresh DB backup exists；
- file count / bytes equivalence passes；
- checksum equivalence passes；
- Immich containers healthy；
- API ping works；
- sampled historical media accessible；
- old source state accurately recorded；
- no media deletion performed before acceptance gates。

## Storage / Logs

- managed compose logging bounded；
- existing unbounded logs inventoried；
- safe top offenders remediated；
- global/new-container policy documented/applied if safe；
- storage maintenance dry-run + apply tested；
- current/previous/rollback images protected；
- post-deploy storage delta measured；
- scheduled storage health installed and healthy。

## Secrets

- service inventory complete for active CasaOS apps；
- required secret inventory complete；
- no secret value in Git；
- encrypted bundle created；
- restore rehearsal passed；
- 9Router data + env secret coverage confirmed；
- Immich DB credential coverage confirmed；
- WhatsApp/Telegram/KOOK/OpenClaw credentials covered without printing values。

## Operation Skuld

- migration manifest valid with no duplicate keys；
- dynamic version readiness；
- Immich / 9Router / changedetection / storage / secrets covered；
- host-neutral address/profile fixes complete；
- doctor 0 failure；
- `migration-readiness.sh` reports:

```text
OPERATION_SKULD=READY
```

If old Immich source is intentionally retained:

```text
IMMICH_SOURCE_RECLAIM=READY_BUT_PENDING
```

This is acceptable and safer than deleting the source inside the unattended goal.

## Live evidence

- current canonical CasaOS host healthy；
- owner release notification `.sent.json` confirmed；
- storage / Immich cutover notification confirmed；
- deployment report committed/pushed；
- git clean after evidence commit。

---

# 28. Explicit Non-goals

本 Goal 不做：

- Mac mini 实际 cutover；
- DNS / Cloudflare route 切换到新 Mac；
- 新 Mac provisioning；
- 8TB disk 格式化 / 重分区；
- RAID / ZFS redesign；
- Immich PostgreSQL 迁到外接盘；
- 删除旧 Mac 上的 secrets；
- secret rotation；
- 删除旧 Immich source without explicit reclaim approval；
- 把所有 Homelab app 重新架构；
- 引入 Kubernetes / message queue / second agent runtime；
- 恢复 LangBot / n8n；
- 自动删除 UNKNOWN 数据。

---

# 29. Expected End State

1.4.4 完成后的世界线：

```text
                        ┌────────────────────────────┐
                        │ Mac internal SSD           │
                        │ OpenClaw / DB / runtime    │
                        │ bounded logs / small state │
                        └─────────────┬──────────────┘
                                      │
                                      │ managed runtime
                                      ▼
                            Amadeus / OpenClaw
                                      │
                  ┌───────────────────┼───────────────────┐
                  │                   │                   │
                  ▼                   ▼                   ▼
           Product Radar          9Router             Immich DB
                                                          │
                                                          │ media root
                                                          ▼
                                      ┌──────────────────────────────┐
                                      │ Verified 8TB external volume │
                                      │ Immich photos/videos/thumbs  │
                                      │ media + encrypted Skuld      │
                                      │ migration artifacts          │
                                      └──────────────────────────────┘

Runtime hygiene:
Docker logs bounded
Build cache retained by policy
Old project images GC safely
Volumes protected
Storage health scheduled
Cleanup results -> Worldline owner notification

Migration state:
Git tracked source/template
+ encrypted secrets
+ small-state backup
+ exact/verified service artifacts
+ portable 8TB media
= Operation Skuld READY
```

这轮完成后，Mac mini 到手后的 Operation Skuld 应尽可能变成“执行型迁移”，而不是继续发现旧 Mac 上还有 TB 级媒体、散落 secrets、无界日志和不可重建 runtime。

> **事实受保护，缓存可重建，日志有边界，密钥可迁移，媒体先验证再切换。**

El Psy Kongroo.
