# Amadeus 1.4.6 — Operation Skuld Cutover Readiness Goal

更新时间：2026-09-22（北京时间）

## 0. 目标与执行边界

这是 Mac mini 实际到货前的最后一个迁移准备版本。

Amadeus 1.4.6 的目标不是继续扩展业务能力，而是把当前旧 Mac 上的 Amadeus / CasaOS / OrbStack / Immich / 9Router / HomeLab 收敛成一个**可验证、可恢复、可暂停、可回滚、今晚即可执行的 Operation Skuld 迁移系统**。

最终目标：

```text
旧 Mac = 当前权威运行节点 + 临时迁移控制端
新 Mac mini = 目标节点
Avalon 8TB = 外部数据与迁移工件载体
Git = tracked source / migration contract
Encrypted Bundle = secret / sensitive state
OrbStack Export = 整机 Linux/CasaOS 快速迁移工件
Service-aware Backup = 独立恢复与一致性兜底
```

1.4.6 实施完成后应达到：

```text
VERSION=1.4.6
OPERATION_SKULD_SOURCE_READY=yes
OPERATION_SKULD_DESTINATION_BOOTSTRAP_READY=yes
OPERATION_SKULD_FULL_HOMELAB_BACKUP_READY=yes
OPERATION_SKULD_ORBSTACK_EXPORT_READY=yes
OPERATION_SKULD_SSH_CONTROLLER_READY=yes
OPERATION_SKULD_CUTOVER_RUNBOOK_READY=yes
IMMICH_SOURCE_RECLAIM=still-pending
MAC_MINI_CUTOVER=NOT_EXECUTED
```

本 Goal **允许**：

- 修复 1.4.5 审计出的所有迁移 blocker；
- 修改源码、脚本、测试、文档、版本；
- commit / push；
- 在当前 canonical old-Mac/CasaOS host 上部署 1.4.6；
- 执行安全的 runtime cleanup / GC；
- 生成完整 migration artifacts、encrypted bundles、service-aware backups；
- 生成/测试 OrbStack export 流程，但不要求在新 Mac 尚未到货时完成最终 cutover；
- 创建 SSH destination bootstrap / controller；
- 清理当前工作树中已经失去 active value 的 agent context / stale migration-only clutter，Git history 继续保存历史。

本 Goal **禁止**：

- 实际执行 Mac mini cutover；
- 删除 `/DATA/Gallery/immich` retained source；
- 格式化或重新分区 Avalon；
- generic `docker volume prune`；
- generic `docker system prune -a --volumes`；
- 在 Git、日志、通知中写 secret value；
- 在旧 Mac 和新 Mac 同时启动 OpenClaw owner-channel runtime；
- 在迁移验证完成前停止旧 Mac 的长期可回滚能力。

---

# 1. 当前 1.4.5 基线

1.4.5 已经完成：

- Immich live media -> `/Volumes/Avalon/immich/data`；
- retained source `/DATA/Gallery/immich` 仍存在；
- Docker bounded logging；
- scheduled safe GC；
- service-aware SQLite/PostgreSQL backup；
- encrypted core secret bundle；
- exact 9Router artifact + isolated restore rehearsal；
- fresh-clone rehearsal；
- scope-aware validation / affected-only Docker build；
- HomeLab migration classification；
- Operation Skuld manifest/runbook；
- `OPERATION_SKULD=READY` source-side evidence。

但 1.4.5 最终审计仍发现：

## P0

1. Immich production reclaim gate 的 remote `rsync --checksum --dry-run` 只检查 exit code；有差异时 rsync 可 exit 0，当前实现仍可能错误写入 `FRESH_ONE_WAY_EQUIVALENCE=passed`。

## P1

2. `storage-health.sh` 的 storage growth Python heredoc 使用 literal `${MACHINE}`，导致 media/docker growth facts 可被吞成 `null`。
3. `service-inventory.sh --write` 是旧版 generator，会覆盖当前人工/合同化的 MIGRATE/REBUILD、secret refs、backup/restore/verification contract。
4. HomeLab 已完成分类，但默认 migration backup 仍没有自动收集全部 MIGRATE 服务的 config/state/named volumes。
5. HomeLab 非核心 secrets/sensitive state 很多仍只是 metadata coverage。
6. image retention 的注释/合同声称保护 running/current/previous/rollback/checkpoint，但实际删除逻辑主要依赖 last-N release tags。

## P2

7. secret bundle manifest 对 plaintext staging 的描述不准确。
8. validation cache 需要 source fingerprint 才能安全复用。
9. 当前 `.agent/checkpoints` 仍含大量 retired LangBot/HomeHub/历史阶段 checkpoint，会增加 Agent 搜索与上下文噪声。
10. 缺少一条真正可执行的“旧 Mac SSH 控制新 Mac -> bootstrap -> import -> cutover -> rollback”状态机。

1.4.6 必须将上述问题全部收口。

---

# 2. Operation Skuld 最终迁移策略

1.4.6 必须支持两条恢复路径，但只维护一个 source-of-truth contract。

## Strategy A — OrbStack 整机 export/import（今晚首选快速路径）

官方 OrbStack 支持：

```text
orb export ubuntu ubuntu.tar.zst
orb import -n ubuntu ubuntu.tar.zst
```

该路径的目的：保留当前 Ubuntu/CasaOS/Docker/AppData/compose/runtime state，避免今晚手工重建几十个 HomeLab 服务。

设计：

```text
old Mac
  OrbStack ubuntu
      ↓ final freeze
      ↓ safe cleanup
      ↓ service-aware backup
      ↓ encrypted sensitive state backup
      ↓ stop containers / stop machine
      ↓ orb export
Avalon/operation-skuld/orbstack/ubuntu-<stamp>.tar.zst
      ↓ physical disk move
new Mac mini
      ↓ verify Avalon UUID/sentinel
      ↓ orb import -n ubuntu
      ↓ ingress disabled validation
      ↓ host LaunchAgents restore
      ↓ doctor/readiness
      ↓ cutover
```

## Strategy B — Clean rebuild + service-aware restore（独立兜底）

若以下任一条件阻止 Strategy A：

- OrbStack export artifact 太大，无法安全放入 512GB 新 Mac 的目标容量；
- export/import rehearsal 失败；
- imported machine health 不一致；
- Operator 明确选择 clean rebuild；

则必须能够使用：

```text
Git tracked source
+ Avalon external media
+ full HomeLab state backup
+ encrypted sensitive-state bundle
+ exact 9Router artifact
+ service-aware DB backups
```

重建目标 HomeLab。

**Strategy A 是速度优化，不得成为唯一恢复能力。**

---

# 3. 修复 Immich reclaim P0

文件：

```text
scripts/reclaim-immich-old-source.sh
```

production remote equivalence 必须满足：

```text
rsync -a --checksum --dry-run --itemize-changes source/ destination/
```

不仅要求 exit code 0，还必须要求**零 source->destination 差异**。

允许：

```text
destination-only files
```

禁止通过：

```text
source file missing on destination
same-size different-content
source newer/different file
type/mode/path mismatch that would require rsync mutation
```

任何实际 change line：

```text
FRESH_ONE_WAY_EQUIVALENCE=blocked
```

不得写 `SOURCE_RECLAIM_READY`。

新增 production-style rsync fixture，至少覆盖：

```text
identical                         PASS
destination has extra files      PASS
destination missing source file  FAIL
same-size changed content        FAIL
source has new file              FAIL
```

1.4.6 本 Goal 修复并验证 gate，但仍：

```text
DO NOT reclaim /DATA/Gallery/immich
```

保留它作为实际 cutover 前的额外 rollback copy。

---

# 4. 修复 Storage Growth

`storage-health.sh` 中所有 Python subprocess 不能依赖 quoted heredoc 中的 shell interpolation。

将 `ORBSTACK_MACHINE` 显式通过 argv/env 传入 Python。

必须实际产生非 null 的：

```text
immichMediaBytes
mediaBytes
downloadsBytes
dockerBytes
```

如果某目录不存在，应记录：

```text
status=not-present
```

而不是静默吞成无法区分的 `null`。

新增 fixture / live sanity：

- machine name 正确传递；
- history JSONL 正常 append/retention；
- 7d/30d growth 可以在至少有足够 history 时计算；
- storage health 状态仍独立于 growth 统计，不因 du failure 伪造 healthy。

---

# 5. Service Inventory：Observation 与 Contract 分离

禁止 `service-inventory.sh --write` 直接覆盖：

```text
docs/OPERATION_SKULD_SERVICE_INVENTORY.md
```

重新设计为：

```text
Live Observation
  scripts/service-inventory.sh --scan
        ↓
  external/sanitized JSON or temp artifact

Tracked Contract
  docs/OPERATION_SKULD_SERVICE_INVENTORY.md
  docs/OPERATION_SKULD_MIGRATION_MANIFEST.json
        ↓
  compare/validate
```

建议接口：

```text
scripts/service-inventory.sh --scan --output PATH
scripts/service-inventory.sh --check
scripts/service-inventory.sh --diff-contract
```

`--scan` 只能生成 live observation，不能修改 tracked contract。

`--check` 必须验证：

- 所有当前 running CasaOS service 都在 contract 中；
- 所有 contract `MIGRATE/REBUILD/EXTERNAL_DATA` service 有 restore policy；
- 新出现的未知 service -> `MANUAL_BLOCKER`；
- 已消失 service -> warning/review，不自动删除 contract。

---

# 6. Full HomeLab Migration Backup

1.4.6 必须从“分类完成”升级为“真正生成可恢复工件”。

当前 HomeLab 至少包含：

```text
openclaw
product-radar
9router
immich
changedetection
media-organizer-adapter
frpc
xiaoya
homarr
emby
qbittorrent
nginxproxymanager
filebrowser
ariang
aria2
jellyfin
alist
v2raya
xiaoyakeeper
dashdot
fashion-siglip
```

重新 live scan 后以实际存在服务为准。

为每个 `MIGRATE` service 实现：

```text
backup artifact
restore method
integrity/health verification
sensitivity classification
cutover dependency
```

建议新增：

```text
scripts/export-skuld-homelab-state.sh
scripts/verify-skuld-homelab-state.sh
```

输出：

```text
$SKULD_BACKUP_ROOT/final-prep-<stamp>/
  manifest.json
  service-aware/
  homelab-state/
  sensitive-state/
  9router/
  host-inventory/
```

## 6.1 不得重复打包 external data

以下只记录 identity/reference/check：

```text
Avalon / media
Avalon / downloads
Immich media
其他大型 external data
```

不得 tar 数 TB 数据。

## 6.2 普通迁移 state

示例：

```text
Emby config
qBittorrent config
Aria2 config
changedetection datastore
media adapter state
```

使用 service-specific archive/restore。

## 6.3 named volumes

Filebrowser/NPM/其他真实 named volumes 必须显式：

```text
docker volume inspect
volume export
checksum
restore target
```

禁止 generic volume prune。

## 6.4 数据库

- SQLite -> backup API + integrity check；
- Immich PostgreSQL -> `pg_dump -Fc` + `pg_restore --list`；
- 其他 service DB 若为 SQLite/PostgreSQL/MySQL，使用对应一致性方法，不得仅 raw-copy live DB。

---

# 7. Secret / Sensitive State 全覆盖

区分：

```text
secret value
sensitive configuration
credential-bearing service state
non-sensitive service state
```

不要为了“API key 列表完整”而从数据库中提取/打印凭据。

允许两种恢复方式：

```text
A. 独立 secret file/env -> encrypted bundle
B. credential embedded in service DB/config -> encrypted sensitive-state artifact
```

至少重新审计：

```text
OpenClaw
Product Radar
9Router
Immich
frpc
qBittorrent
Nginx Proxy Manager
Filebrowser
Aria2
Alist
v2rayA
Xiaoya
Emby/Jellyfin credential-bearing config
changedetection/media adapter env if present
```

最终 `required=false` 只能用于 live scan 已证明不存在真实 sensitive material 的 optional service。

如果 service 运行且有认证状态，但没有 migration artifact：

```text
OPERATION_SKULD=BLOCKED
```

## 7.1 encrypted bundle metadata 修正

当前：

```text
plaintextTemporaryFiles=false
```

若实现仍使用 `0700 mktemp` staging，改为真实描述：

```text
plaintextStaging=ephemeral-0700-cleanup-on-exit
```

或实现真正 streaming encryption。

任何情况：

- no plaintext path in Git；
- no values in logs；
- trap cleanup；
- failure path cleanup；
- bundle checksum；
- import rehearsal。

---

# 8. OrbStack Full Snapshot

新增：

```text
scripts/skuld-orbstack-snapshot.sh
```

接口至少：

```text
--plan
--export --apply
--verify ARTIFACT
```

Final export 前 hard gates：

```text
source machine = expected ORBSTACK_MACHINE
machine architecture recorded
source distro recorded
service-aware final backup passed
encrypted sensitive-state bundle passed
Avalon identity passed
sufficient Avalon free space
no active migration blocker
```

Final export 应在**source freeze**之后执行。

输出：

```text
$SKULD_BACKUP_ROOT/orbstack/
  ubuntu-<stamp>.tar.zst
  ubuntu-<stamp>.sha256
  ubuntu-<stamp>.manifest.json
```

manifest 至少：

```text
source Mac hostname
source macOS architecture
OrbStack version
machine name
machine distro/os-release
machine logical disk usage
Docker system df summary
export artifact bytes
sha256
repo commit
VERSION
createdAt
```

不得记录 secrets。

---

# 9. Destination Capacity Planner

新 Mac mini 是 512GB 内置 SSD，因此 final fast-path 不能盲目 import 一个过大的旧 VM。

新增：

```text
scripts/skuld-capacity-plan.sh
```

Source 端采集：

```text
OrbStack guest used bytes
/DATA used bytes
Docker used/reclaimable
retained Immich source bytes
export artifact bytes if available
```

Destination 端（SSH）采集：

```text
internal total/free
repo/bootstrap footprint
OrbStack existing footprint
```

只有达到可配置 safety margin 才允许 `FAST_PATH=eligible`。

不要仅以 `.tar.zst` 压缩后体积判断 destination 是否够用。

若不满足：

```text
FAST_PATH=blocked
CLEAN_RESTORE_PATH=required
```

---

# 10. Pre-export Garbage Cleanup

目的：减少旧 Mac 压力和 OrbStack export 体积，但**绝不牺牲 rollback/data**。

新增或扩展：

```text
scripts/skuld-pre-export-cleanup.sh
```

必须先 `--plan`，再显式 `--apply`。

允许清理：

```text
expired project release image tags
unprotected dangling project images
expired BuildKit cache
stale test/rehearsal containers
known /tmp/skuld-* leftovers
apt package cache
bounded system journal beyond configured retention
expired disposable deployment evidence
known generated build temp
```

允许设置 journald 上限，但必须记录 before/after。

禁止：

```text
Docker volumes
any database
Avalon media/downloads
Immich retained source
secret bundles
latest service-aware backup
latest OrbStack export
current image
previous known-good
rollback/checkpoint referenced image
unknown owner paths
```

输出：

```text
FREE_BEFORE_BYTES
FREE_AFTER_BYTES
FREE_DELTA_BYTES
REMOVED_OBJECTS
PROTECTED_OBJECTS
```

若释放 >= meaningful threshold，走 owner notification。

---

# 11. Image Retention 必须真正保护 rollback set

`storage-maintenance.sh` 必须构造实际 protected set：

```text
running image IDs/tags
current release image
previous known-good image
rollback tags
checkpoint/evidence referenced image tags
last N project releases
9Router exact image
```

删除候选必须与 protected set 比较。

不能只生成 `running-images.txt` 而不消费它。

测试至少：

```text
old but running image            KEEP
old but checkpoint referenced    KEEP
old rollback tag                 KEEP
last N                           KEEP
unreferenced older project tag   REMOVE
unknown image                    REPORT_ONLY
```

---

# 12. Agent Context / Repo Hygiene

`.agent/checkpoints` 中大量 pre-OpenClaw / LangBot / old HomeHub checkpoint 已不属于 active execution context。

本轮进行一次**只针对 current-tree context noise 的清理**：

- Git history 保留所有旧 checkpoint；
- active `.agent/` 只保留当前架构、最新稳定 release、Operation Skuld、当前开发 workflow 必要文件；
- 老历史如果仍需要 discoverability，可留下一个 `docs/history/README.md` 索引说明 Git history/ref；
- 不复制几十个历史文件到新的 history 目录造成同样上下文噪声。

目标：

```text
Codex 默认 scan .agent
=> 只看到当前现实
```

不得删除真正仍参与 runtime/migration contract 的文档。

---

# 13. SSH Destination Bootstrap

新增：

```text
scripts/skuld-destination-bootstrap.sh
```

支持：

```text
--target USER@HOST --check
--target USER@HOST --apply
```

旧 Mac 作为一次性迁移控制端，通过 SSH 执行。

## 13.1 新 Mac 人工第一步

新 Mac 到手后，Operator 先人工完成：

1. 首次 macOS Setup；
2. **建议创建与旧 Mac 相同 short username：`blacksidev`**，减少 host path / imported Linux user / existing automation 差异；
3. 接入有线 Ethernet；
4. 在路由器先给新 Mac 一个**临时 LAN IP**，不得和旧 Mac 冲突；
5. System Settings -> General -> Sharing -> 开启 **Remote Login**，仅允许 operator account；
6. 不运行 Migration Assistant 去整体复制旧 macOS HomeLab；HomeLab 使用 Operation Skuld；
7. 旧 Mac 将自己的 public SSH key 加入新 Mac `authorized_keys`；
8. 验证无密码 SSH。

旧 Mac private key 不需要复制到新 Mac。

## 13.2 bootstrap 检查

远端检查：

```text
Darwin
arm64
expected user
hostname
internal free bytes
network reachability
SSH host fingerprint recorded
```

`--apply` 安装/准备：

```text
Homebrew
git
node/pnpm
tmux
cloudflared (if contract requires)
OrbStack
repo clone
host-profile template
```

OrbStack GUI 需要完成 first-run 时，脚本必须明确 BLOCKED 并告诉 Operator 在新 Mac 本地打开一次 OrbStack，而不是无限等待。

## 13.3 不提前启动第二 runtime

Destination bootstrap 阶段禁止：

```text
OpenClaw owner channels active
frpc/public ingress active
changedetection/Product Radar active producer sending to owner
```

可以构建/检查，但不允许形成双活。

---

# 14. SSH Migration Controller / State Machine

新增：

```text
scripts/operation-skuld.sh
```

它不是第二 Agent，只是 deterministic migration controller。

建议命令：

```text
operation-skuld.sh status
operation-skuld.sh source-preflight
operation-skuld.sh destination-preflight --target USER@HOST
operation-skuld.sh prepare-artifacts --apply
operation-skuld.sh freeze-source --apply --approval-token ...
operation-skuld.sh export-orbstack --apply
operation-skuld.sh mark-disk-moved --approval-token ...
operation-skuld.sh import-destination --apply
operation-skuld.sh validate-destination
operation-skuld.sh cutover --apply --approval-token ...
operation-skuld.sh rollback --apply --approval-token ...
```

State 写在：

```text
$SKULD_BACKUP_ROOT/cutover/state.json
```

因为 Avalon 会随迁移物理移动，state 能从旧 Mac 延续到新 Mac。

状态机至少：

```text
SOURCE_READY
DESTINATION_SSH_READY
DESTINATION_BOOTSTRAPPED
ARTIFACTS_READY
FREEZE_ARMED
SOURCE_FROZEN
ORBSTACK_EXPORTED
DISK_MOVE_REQUIRED
DESTINATION_STORAGE_VERIFIED
DESTINATION_IMPORTED
DESTINATION_VALIDATED
CUTOVER_ARMED
CUTOVER_COMMITTED
ROLLBACK_REQUIRED
```

每一 phase：

- 幂等；
- 可 resume；
- phase 前验证 previous state；
- destructive/traffic mutation 必须 approval token；
- 不允许跳过 physical disk move gate。

---

# 15. Source Freeze

Final freeze 之前旧 Mac 一直是 authoritative runtime。

`freeze-source` 必须：

1. 再跑 source readiness；
2. 记录 outbox pending/sent count；
3. 生成**最后一次** service-aware backup；
4. 生成 fresh Immich `pg_dump -Fc`；
5. 生成 fresh encrypted sensitive-state bundle；
6. 生成/校验 exact 9Router artifact；
7. 停止会产生新 writes / external delivery 的 runtime；
8. 停止 public ingress；
9. 记录 Docker restart policies；
10. 确保 imported VM 第一次启动不会自动形成双活；
11. stop OrbStack machine；
12. 之后不得在旧 runtime 接受新 owner/channel/media writes。

优先停止顺序：

```text
public ingress / frpc / tunnel
OpenClaw owner channels
Product Radar / changedetection producers
media workflow writers
Immich writers
remaining containers
OrbStack ubuntu
```

实际服务列表以 live contract 生成，不可仅写死名称。

Freeze 完成：

```text
SOURCE_FROZEN=yes
```

旧 Mac 保持通电、不要抹盘。

---

# 16. OrbStack Export & Avalon Move

Source frozen 后：

```text
orb export ubuntu $SKULD_BACKUP_ROOT/orbstack/ubuntu-<stamp>.tar.zst
```

完成：

- sha256；
- manifest；
- readback；
- capacity check；
- artifact size；
- export command exit 0。

随后执行：

```text
diskutil unmount /Volumes/Avalon
```

必须成功后才允许拔出 8TB。

**不要在文件系统 mounted 时直接拔盘。**

State：

```text
DISK_MOVE_REQUIRED
```

此时物理把 Avalon 从旧 Mac 接到新 Mac。

---

# 17. Destination Restore — Fast Path

新 Mac 上：

1. Avalon mount；
2. 验证 Volume UUID；
3. 验证 sentinel；
4. 验证 latest cutover state；
5. 验证 OrbStack export SHA256；
6. 确认目标无冲突 machine name；
7. `orb import -n ubuntu ...`；
8. imported machine 第一次启动保持 external ingress disabled；
9. 验证 `/DATA/AppData`、Docker containers/images/networks、CasaOS；
10. 验证 host bind path `/Volumes/Avalon`；
11. 安装 macOS host LaunchAgents。

Host-level restore：

```text
FashionSigLIP LaunchAgent
storage-health LaunchAgent
storage-maintenance LaunchAgent
required host-side tunnel/remote-access agent if live inventory says active
```

不要默认复制未知 LaunchAgent；先分类。

---

# 18. Destination Restore — Clean Path

如果 Fast Path blocked，controller 切换到 clean path：

```text
create/import fresh OrbStack Ubuntu
install CasaOS
restore tracked compose/contracts
restore full HomeLab migration state
restore encrypted sensitive state
restore SQLite snapshots
pg_restore Immich
load exact 9Router image
attach Avalon
rebuild REBUILD services
install host LaunchAgents
```

CasaOS 安装命令只能来自实现时验证的 official source；不要把第三方镜像脚本写成默认路径。

Clean path 也必须使用相同 manifest/runbook contract。

---

# 19. Destination Validation（仍不开放入口）

至少验证：

```text
Avalon identity
Immich media root
Immich PostgreSQL + VectorChord
Immich historical photo/video read
9Router dashboard/auth boundary
OpenClaw config/plugins
Product Radar DB/health
SQLite integrity
owner outbox idempotency
Emby/Jellyfin media roots
qBittorrent/Aria2 download roots
NPM certificate state
Alist storage mount
frpc config present but ingress still stopped
FashionSigLIP MPS
storage schedulers
Docker bounded logs
```

执行：

```text
scripts/doctor.sh
scripts/migration-readiness.sh
scripts/verify-skuld-homelab-state.sh
```

要求：

```text
DESTINATION_VALIDATED=yes
```

在这之前：

```text
OpenClaw owner channels = off
public ingress = off
```

---

# 20. LAN / IP Cutover Strategy

推荐：

```text
staging:
old Mac = 原 LAN IP（例如现有 192.168.5.3）
new Mac = 临时新 IP

cutover:
old Mac runtime stopped + network conflict removed
new Mac optionally inherits old Mac LAN IP
```

是否继承旧 IP 由 local host profile 决定，不写死地址。

如果家庭设备/书签/服务大量仍指向旧 IP，继承原 IP 可以减少配置改动。

Hard rule：

```text
两个设备绝不能同时持有同一 LAN IP
```

如果选择保留 new IP：

- 更新 DHCP/DNS；
- 更新真实仍使用 IP 的客户端；
- host-neutral `host.docker.internal` runtime 不应受影响。

---

# 21. Cutover 顺序

只有：

```text
DESTINATION_VALIDATED=yes
```

才能进入 cutover。

推荐启动顺序：

```text
1. internal DB / Redis dependencies
2. 9Router
3. Immich / media dependencies
4. Emby/Jellyfin/Alist/download services
5. media adapter
6. Product Radar（owner delivery 仍 gated）
7. OpenClaw
8. owner delivery / channel ingress
9. frpc / public ingress / external tunnel LAST
```

实际 dependency graph 必须由 contract 生成。

避免：

```text
old OpenClaw still online
+
new OpenClaw starts WhatsApp/Telegram
```

这会造成 duplicate consumers / duplicate owner delivery。

---

# 22. First Real User Test

Health 全绿后才执行一个明确的 real test：

```text
Operator -> Telegram/WhatsApp -> Amadeus
```

验证：

```text
only destination receives
session isolation correct
9Router responds
owner notification path works
no duplicate reply
```

记录 event key / pass-fail，不记录私聊正文。

然后：

```text
CUTOVER_COMMITTED=yes
```

---

# 23. Rollback

## 23.1 在 destination 未接受真实 writes 前

rollback 很简单：

```text
stop destination
unmount Avalon
move Avalon back to old Mac
mount/verify UUID
start old OrbStack machine
restore restart policies/ingress
health
reopen channels
```

## 23.2 destination 已接受真实 writes 后

禁止盲目直接启动旧 snapshot。

必须进入：

```text
ROLLBACK_REQUIRED + DATA_DIVERGENCE_REVIEW
```

先确定：

- new SQLite writes；
- Immich DB writes；
- outbox/channel events；
- media/download changes；

如何 reverse/replay。

不要制造双写世界线。

---

# 24. Old Mac 保留策略

成功 cutover 后：

```text
old Mac remains powered-off/stopped as rollback host
```

建议至少保留 48-72 小时，不立刻抹盘。

在稳定观察期内：

- 不启动旧 OpenClaw；
- 不启动旧 frpc；
- 不让旧机抢回原 IP；
- 保留原 OrbStack machine；
- 保留 migration artifacts。

稳定后才能单独决定：

```text
reclaim imported /DATA/Gallery/immich duplicate
repurpose old Mac
remove old host artifacts
```

Immich source reclaim 必须使用修复后的 checksum gate 和单独 approval token。

---

# 25. Host-level Remote Access Inventory

1.4.6 migration contract 必须扫描并分类 macOS host 上与 HomeLab 相关的：

```text
Remote Login / sshd
Cloudflare Tunnel if installed/active
Tailscale if installed/active
Cumora agent if installed/active
FashionSigLIP LaunchAgent
storage LaunchAgents
other com.amadeus/com.productradar tracked jobs
```

分类：

```text
MIGRATE_CONFIG
REINSTALL
REPAIR
DROP
MANUAL_BLOCKER
```

不要自动复制所有 `~/Library/LaunchAgents`。

---

# 26. SSH Key Policy

迁移控制：

```text
old Mac private key stays on old Mac
old Mac public key -> new Mac authorized_keys
```

新 Mac 长期使用：

- 可继续允许现有 trusted client public keys；
- 新 Mac 自己生成新的 outbound personal SSH key；
- Amadeus service-specific VPS/NAS keys从 encrypted bundle 恢复到明确 target；
- 不把 personal private key 塞进 Git / HomeLab service bundle，除非它本来就是 manifest 中明确的 service credential。

---

# 27. 1.4.6 Development Efficiency

继续执行 1.4.5 validation matrix。

开发阶段：

```text
migration shell -> bash -n + fixture
docs/manifest -> contract test
storage -> storage fixture
backup -> backup fixture
SSH controller -> fake target fixture
```

只在 final release：

```text
pnpm test
pnpm typecheck
pnpm build
pnpm check:secrets
fresh-clone full rehearsal
```

Docker build：

- 只有 runtime source 变化才 build affected image；
- 单纯 migration scripts/docs 不 build OpenClaw/Product Radar。

## 27.1 Safe validation cache

`run-check.sh` cache key 必须由：

```text
command
+
input file hashes
+
relevant dependency lock hash
```

生成。

不得接受 Agent 随意复用一个人工字符串 cache key。

Release evidence 记录：

```text
targetedRuns
reusedChecks
fullTestRuns
fullTypecheckRuns
fullBuildRuns
dockerBuilds
liveDeployAttempts
validationDurationMs
```

---

# 28. 1.4.6 Final Source Preparation

发布 1.4.6 后，在旧 Mac 上执行一次 final preparation（但不 freeze/cutover）：

```text
source readiness
service inventory contract diff
full HomeLab migration backup
secret/sensitive bundle rehearsal
9Router artifact verify
safe runtime cleanup
storage health
capacity report
OrbStack export plan
SSH destination bootstrap plan
```

如果新 Mac 尚未到：

```text
DESTINATION_SSH=WAITING_FOR_HARDWARE
```

不应影响 1.4.6 source-side release。

最终旧 Mac 状态：

```text
Amadeus 1.4.6
Source runtime healthy
Migration artifacts current
Garbage safely reduced
Avalon verified
Immich source retained
Cutover controller ready
Waiting for Mac mini
```

---

# 29. Acceptance Tests

至少增加：

```text
test:immich-reclaim-remote-equivalence
test:storage-growth-machine
test:service-inventory-contract
test:homelab-backup
test:sensitive-state-bundle
test:image-protected-set
test:skuld-controller-state-machine
test:skuld-destination-ssh-fixture
test:orbstack-snapshot-manifest
test:skuld-capacity-plan
```

关键 destructive tests 全部使用 fixture/temp dir/fake SSH target，不允许碰真实数据。

---

# 30. Release Evidence

最终 tracked report 至少记录：

```text
VERSION=1.4.6

AUDIT_BLOCKERS=0
IMMICH_RECLAIM_REMOTE_GATE=fixed
STORAGE_GROWTH=valid
SERVICE_INVENTORY_CONTRACT=protected
FULL_HOMELAB_BACKUP=rehearsed
SENSITIVE_STATE_COVERAGE=complete-for-live-services
IMAGE_PROTECTED_SET=verified
SAFE_PRE_EXPORT_CLEANUP=passed
SOURCE_CAPACITY_PLAN=recorded
ORBSTACK_EXPORT_PATH=ready
SSH_CONTROLLER=ready
DESTINATION_BOOTSTRAP=ready

IMMICH_SOURCE_RECLAIM=PENDING
MAC_MINI_CUTOVER=NOT_EXECUTED
OPERATION_SKULD_SOURCE_READY=yes
```

如果今晚新 Mac 已经到货，可在独立 cutover evidence 中继续记录 destination phases；不要把硬件到货作为源码 release 的强依赖。

---

# 31. Non-goals

1.4.6 不做：

- 新业务 Plugin；
- Agent architecture 重构；
- Worldline vocabulary 重构；
- 自动删除 Immich retained source；
- 自动抹除旧 Mac；
- 自动修改家庭路由器 DHCP；
- 自动发送真实 Telegram/WhatsApp test message；
- 未经 approval 自动开启 destination public ingress。

---

# 32. 今晚 Mac mini 到货后的 Operator Checklist

## A. 新 Mac 本地初始化

```text
[ ] macOS 首次设置
[ ] short username 建议 blacksidev
[ ] Ethernet 接入
[ ] 临时 DHCP/LAN IP，与旧 Mac 不冲突
[ ] 开启 Remote Login，仅 operator user
[ ] 不使用 Migration Assistant 整体搬 HomeLab
```

## B. 旧 Mac 建立 SSH 控制

旧 Mac：

```bash
ssh <new-user>@<new-mac-temp-ip>
```

首次确认 host fingerprint 后，将旧 Mac 的 **public key** 加入新 Mac `~/.ssh/authorized_keys`，再次验证无密码登录。

然后：

```bash
./scripts/operation-skuld.sh destination-preflight --target <user>@<host>
./scripts/skuld-destination-bootstrap.sh --target <user>@<host> --apply
```

如果 OrbStack first-run 需要 GUI：在新 Mac 本地打开 OrbStack 一次，再重新运行 preflight。

## C. 不移动 8TB，先把新机 bootstrap 完

在旧 Mac/Avalon 仍维持现状时完成：

```text
Git clone
Homebrew/dependencies
OrbStack installed/first-run
repo tests/bootstrap checks
SSH state ready
capacity ready
```

此阶段旧 HomeLab 继续正常工作。

## D. 正式迁移窗口

只有 destination bootstrap green 后：

```bash
./scripts/operation-skuld.sh prepare-artifacts --apply
./scripts/operation-skuld.sh freeze-source --apply --approval-token <explicit-token>
./scripts/operation-skuld.sh export-orbstack --apply
```

确认 export + checksum 后安全 unmount Avalon。

## E. 物理移动 Avalon

拔出旧 Mac -> 接入新 Mac。

新 Mac：

```text
verify UUID
verify sentinel
verify migration state
verify export checksum
```

然后 fast path import：

```bash
./scripts/operation-skuld.sh import-destination --apply
./scripts/operation-skuld.sh validate-destination
```

## F. LAN/IP 与正式 Cutover

验证通过后：

1. 确保旧 Mac 不再占用计划中的 production IP；
2. 如有需要让新 Mac 继承旧 LAN IP；
3. 内部依赖先启动；
4. OpenClaw / owner channels 后启动；
5. frpc/public ingress 最后启动；
6. doctor/readiness green；
7. Operator 手工发一条真实消息做最终验证；
8. commit cutover state。

## G. 旧 Mac 不要立刻清空

至少 48-72 小时：

```text
old OrbStack stopped
old ingress stopped
old Mac 不占 production IP
old data 不删除
```

稳定后再讨论 source reclaim / old Mac repurpose。

---

# 33. 建议 Codex /goal

```text
/goal Implement docs/AMADEUS_1_4_6_OPERATION_SKULD_CUTOVER_READINESS_GOAL.md completely. This is the final migration-preparation release before the new Mac mini arrives. Re-audit current main and the canonical old-Mac CasaOS/OrbStack runtime first. Fix every 1.4.5 audit issue, especially the production Immich remote checksum gate. Complete full HomeLab state/sensitive-state backup coverage, protect the tracked migration contract from live-inventory overwrite, make image/checkpoint retention consume the actual protected set, fix storage growth telemetry, add safe pre-export cleanup, implement an OrbStack whole-machine export/import fast path plus independent clean-restore fallback, and implement a deterministic SSH-based Operation Skuld controller/state machine so the old Mac can bootstrap and control the new Mac until cutover. Keep all traffic-changing/destructive phases behind explicit approval gates. Do NOT reclaim /DATA/Gallery/immich, do NOT perform the actual Mac mini cutover in this goal, do NOT enable a second OpenClaw owner-channel runtime, and do NOT delete unknown data/volumes. Preserve the 1.4.5 scope-aware validation workflow, use targeted tests during implementation and one final full release gate, release as 1.4.6, commit/push, deploy to the current canonical host, run source-side final preparation/cleanup/readiness, and commit/push sanitized deployment evidence. The final source state should be ready to begin Operation Skuld immediately when the Mac mini is physically available.
```
