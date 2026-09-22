# Amadeus 1.4.6 — Operation Skuld Cutover Readiness Goal

更新时间：2026-09-22（北京时间）

## 0. 目标与执行边界

这是 Mac mini 实际到货前的最后一个迁移准备版本。

Amadeus 1.4.6 不扩展业务能力；本轮只把当前旧 Mac 上的 Amadeus / CasaOS / OrbStack / Immich / 9Router / HomeLab 收敛成一个**可验证、可恢复、可暂停、可回滚、今晚即可执行的 Operation Skuld 迁移系统**。

最终角色：

```text
旧 Mac
  = 当前 authoritative runtime
  = 临时 Operation Skuld Controller

新 Mac mini
  hostname = Amadeus-M204
  macOS short user = nyannyan
  home = /Users/nyannyan
  = destination runtime

Avalon 8TB
  = external media/data
  = migration artifacts

Git
  = tracked source + migration contract

Encrypted Bundle
  = secrets + sensitive state

OrbStack Export
  = whole-machine fast path

Service-aware Backup
  = independent clean-restore fallback
```

1.4.6 实施完成后必须达到：

```text
VERSION=1.4.6
OPERATION_SKULD_SOURCE_READY=yes
OPERATION_SKULD_DESTINATION_BOOTSTRAP_READY=yes
OPERATION_SKULD_FULL_HOMELAB_BACKUP_READY=yes
OPERATION_SKULD_ORBSTACK_EXPORT_READY=yes
OPERATION_SKULD_SSH_CONTROLLER_READY=yes
OPERATION_SKULD_CUTOVER_RUNBOOK_READY=yes
DESTINATION_HOST_IDENTITY=Amadeus-M204
DESTINATION_MACOS_USER=nyannyan
IMMICH_SOURCE_RECLAIM=still-pending
MAC_MINI_CUTOVER=NOT_EXECUTED
```

本 Goal 允许：

- 修复 1.4.5 审计出的全部 migration blocker；
- 修改源码、脚本、测试、manifest、runbook、host profile、版本；
- commit / push；
- 在当前 canonical old-Mac/CasaOS host 部署 1.4.6；
- 执行安全 runtime cleanup / GC；
- 生成完整 migration artifacts、encrypted bundles、service-aware backups；
- 生成和 rehearsal OrbStack export/import；
- 实现 SSH destination bootstrap/controller；
- 清理 current-tree 中已经失去 active value 的 agent context / stale migration-only clutter，Git history 保留历史。

本 Goal 禁止：

- 实际执行 Mac mini cutover；
- 删除 `/DATA/Gallery/immich` retained source；
- 格式化或重新分区 Avalon；
- generic `docker volume prune`；
- generic `docker system prune -a --volumes`；
- 在 Git、日志、通知中写 secret value；
- 旧 Mac 与新 Mac 同时启动 OpenClaw owner-channel runtime；
- 迁移验证完成前破坏旧 Mac rollback 能力；
- 为了用户名统一而修改 OrbStack Ubuntu 内现有 Linux 用户或 `/home/blacksidev` 路径；
- 在新 Mac active host-side 配置中继续依赖 `/Users/blacksidev`。

---

# 1. Destination Identity Contract（本轮新增硬约束）

新 Mac mini 身份已经确定，不再作为运行时猜测：

```text
ComputerName = Amadeus-M204
LocalHostName = Amadeus-M204
HostName = Amadeus-M204
macOS short user = nyannyan
macOS home = /Users/nyannyan
```

Destination bootstrap 必须验证或设置：

```bash
sudo scutil --set ComputerName "Amadeus-M204"
sudo scutil --set LocalHostName "Amadeus-M204"
sudo scutil --set HostName "Amadeus-M204"
```

并验证：

```text
whoami == nyannyan
$HOME == /Users/nyannyan
hostname/scutil identity == Amadeus-M204
```

SSH destination canonical identity：

```text
nyannyan@Amadeus-M204.local
```

在 mDNS 尚未稳定或 cutover 前允许：

```text
nyannyan@<temporary-lan-ip>
```

## 1.1 新旧 macOS 用户不同是设计事实

```text
old macOS host user = blacksidev
new macOS host user = nyannyan
```

因此所有 destination host-side 路径必须：

- 使用 `$HOME`；或
- 使用 Host Profile；或
- 明确以 `/Users/nyannyan` 为目标。

以下在 **destination host active config/script/LaunchAgent** 中出现时属于 blocker：

```text
/Users/blacksidev
~blacksidev
hard-coded old macOS user
```

必须至少扫描：

```text
scripts/
infra/
integrations/
LaunchAgent templates
FashionSigLIP install paths
Cloudflare/remote-access host config
local repo/bootstrap paths
host-profile generated values
```

## 1.2 OrbStack guest 不跟随 macOS username 重命名

如果采用整个 OrbStack Ubuntu export/import：

```text
/home/blacksidev/...
```

属于 Linux guest 内部路径，可以原样保留。

Hard rule：

```text
macOS /Users/blacksidev -> destination blocker
Linux guest /home/blacksidev -> allowed legacy guest identity
```

不要为了视觉统一执行 Linux user rename、UID/GID rewrite 或大规模 guest path move。

## 1.3 Destination file ownership

所有新 Mac host-side 工件必须最终属于：

```text
nyannyan
```

尤其：

```text
/Users/nyannyan/.ssh
~/Library/LaunchAgents
FashionSigLIP install/state
repo checkout
host-profile local override
migration controller local state
```

不得继承旧 macOS 用户 ownership。

---

# 2. 当前 1.4.5 基线与必须修复的问题

1.4.5 已完成：

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
- source-side readiness evidence。

1.4.6 必须收口以下问题。

### P0

Immich production reclaim gate 的 remote `rsync --checksum --dry-run` 不能只看 exit code；有内容差异时 rsync 可 exit 0，因此必须显式要求 **zero change lines**。

### P1

- `storage-health.sh` growth subprocess 使用 literal `${MACHINE}`，导致 growth facts 可变成 null；
- `service-inventory.sh --write` 不能覆盖 tracked migration contract；
- HomeLab 已分类但完整 MIGRATE service state/named-volume backup 尚未完全自动化；
- 非核心 secret/sensitive state 仍有 metadata-only 覆盖；
- image retention 必须真正消费 running/checkpoint/rollback protected set，而不是只按 last-N。

### P2

- secret bundle plaintext staging metadata 必须描述真实；
- validation cache 必须 source-fingerprint invalidation；
- retired agent checkpoints/context 应降低默认搜索噪声；
- 缺少完整 SSH old-Mac -> new-Mac deterministic cutover controller；
- destination identity 现在固定为 `Amadeus-M204` / `nyannyan`，必须纳入所有迁移合同和测试。

---

# 3. Operation Skuld 双恢复策略

1.4.6 必须支持两条恢复路径，但只有一个 source-of-truth manifest/runbook。

## Strategy A — OrbStack whole-machine export/import（今晚首选 fast path）

目标：保留当前 Ubuntu/CasaOS/Docker/AppData/runtime state，避免今晚逐服务手工重建。

流程：

```text
old Mac authoritative runtime
  ↓ source preflight
  ↓ final service-aware backup
  ↓ encrypted sensitive-state bundle
  ↓ safe cleanup
  ↓ freeze writers / ingress
  ↓ stop OrbStack ubuntu
  ↓ orb export
Avalon/skuld/orbstack/ubuntu-<stamp>.tar.zst
  ↓ checksum
  ↓ safe unmount
  ↓ physical disk move
Amadeus-M204
  ↓ verify Avalon identity
  ↓ orb import -n ubuntu
  ↓ ingress disabled validation
  ↓ host-side restore under /Users/nyannyan
  ↓ doctor/readiness
  ↓ cutover
```

## Strategy B — Clean rebuild + service-aware restore（独立兜底）

若 fast path 因容量、artifact、import health 等原因 blocked：

```text
Git tracked source
+ Avalon external data
+ full HomeLab state backup
+ encrypted sensitive-state bundle
+ exact 9Router image
+ service-aware DB backups
```

必须可重建目标 HomeLab。

Strategy A 只是加速，绝不能成为唯一恢复能力。

---

# 4. 修复 Immich Reclaim P0

文件：

```text
scripts/reclaim-immich-old-source.sh
```

production remote equivalence：

```text
rsync -a --checksum --dry-run --itemize-changes source/ destination/
```

必须同时满足：

```text
exit code == 0
actual source->destination change lines == 0
```

允许 destination-only files。

以下任一存在都必须 BLOCK：

```text
source file missing on destination
same-size different-content
source newer/different file
source-only new file
type/path mismatch
anything requiring rsync mutation
```

不得写：

```text
FRESH_ONE_WAY_EQUIVALENCE=passed
SOURCE_RECLAIM_READY
```

除非 zero-difference gate 通过。

新增 production-style rsync fixture：

```text
identical                         PASS
destination has extra files      PASS
destination missing source file  FAIL
same-size changed content        FAIL
source has new file              FAIL
```

1.4.6 **修 gate 但不执行 reclaim**：

```text
DO NOT delete /DATA/Gallery/immich
```

---

# 5. 修复 Storage Growth

`storage-health.sh` 所有 Python subprocess 的 machine name 必须通过 argv/env 显式传入。

不得在 quoted heredoc 中依赖 shell interpolation。

必须产生可区分状态：

```text
immichMediaBytes
mediaBytes
downloadsBytes
dockerBytes
```

目录不存在时记录：

```text
status=not-present
```

不能静默 null。

验证：

- machine name 正确；
- history JSONL append/retention；
- 7d/30d growth 在 history 足够时可计算；
- growth 失败不改变 capacity truth，不伪造 healthy。

---

# 6. Service Inventory：Observation 与 Contract 分离

禁止任何 live scan 直接覆盖：

```text
docs/OPERATION_SKULD_SERVICE_INVENTORY.md
docs/OPERATION_SKULD_MIGRATION_MANIFEST.json
```

目标结构：

```text
Live Observation
  scripts/service-inventory.sh --scan --output PATH
        ↓
  sanitized runtime observation

Tracked Contract
  OPERATION_SKULD_SERVICE_INVENTORY.md
  OPERATION_SKULD_MIGRATION_MANIFEST.json
        ↓
  diff/check
```

建议支持：

```text
--scan --output PATH
--check
--diff-contract
```

必须验证：

- 所有 running CasaOS service 在 contract 中；
- MIGRATE/REBUILD/EXTERNAL_DATA 都有 restore policy；
- 新未知 service -> `MANUAL_BLOCKER`；
- 已消失 service -> warning/review，不自动删除 contract。

---

# 7. Full HomeLab Migration Backup

重新 live scan，以实际存在服务为准。

当前已知范围至少包括：

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

每个 `MIGRATE` service 必须具备：

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

## 7.1 External bulk data 不重复打包

只记录 identity/reference/check：

```text
Avalon media
Avalon downloads
Immich media
other multi-TB external data
```

不得 tar 大型 external media。

## 7.2 DB 一致性

```text
SQLite -> SQLite backup API + integrity + checksum
Immich PostgreSQL -> pg_dump -Fc + pg_restore --list + checksum
other DB -> service-specific consistent backup
```

禁止仅 raw-copy live DB。

## 7.3 Named volumes

Filebrowser/NPM/其他真实 named volumes：

```text
docker volume inspect
explicit export
checksum
explicit restore target
```

禁止 generic volume cleanup。

---

# 8. Secret / Sensitive State 全覆盖

区分：

```text
secret value
sensitive configuration
credential-bearing service state
non-sensitive service state
```

不要从 service DB 中提取/打印凭据，只为了凑 API key 列表。

允许：

```text
independent secret/env -> encrypted bundle
credential-bearing DB/config -> encrypted sensitive-state artifact
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
Emby/Jellyfin auth-bearing config
changedetection/media adapter env when present
```

运行中的认证 service 如果没有 migration artifact：

```text
OPERATION_SKULD=BLOCKED
```

`required=false` 只能用于 live scan 已证明不存在实际 sensitive material 的 optional service。

## 8.1 Plaintext staging metadata

若仍使用 `0700 mktemp`：

```text
plaintextStaging=ephemeral-0700-cleanup-on-exit
```

而不是 `plaintextTemporaryFiles=false`。

必须保证：

- no plaintext path/value in Git；
- no value in logs；
- cleanup trap covers success/failure；
- encrypted bundle checksum；
- import rehearsal；
- restored host-side file owner/mode 正确（destination owner=`nyannyan`）。

---

# 9. OrbStack Full Snapshot

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
source machine == expected ORBSTACK_MACHINE
architecture recorded
source distro recorded
service-aware final backup passed
encrypted sensitive-state bundle passed
Avalon identity passed
sufficient Avalon free space
no migration blocker
```

Final export 必须在 source freeze 后执行。

输出：

```text
$SKULD_BACKUP_ROOT/orbstack/
  ubuntu-<stamp>.tar.zst
  ubuntu-<stamp>.sha256
  ubuntu-<stamp>.manifest.json
```

manifest 至少记录：

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

# 10. Destination Capacity Planner

新 Mac mini 内置 SSD = 512GB。

新增：

```text
scripts/skuld-capacity-plan.sh
```

Source：

```text
OrbStack guest used bytes
/DATA used bytes
Docker used/reclaimable
retained Immich source bytes
export artifact bytes when available
```

Destination over SSH：

```text
internal total/free
repo/bootstrap footprint
OrbStack existing footprint
```

必须使用 destination identity：

```text
user=nyannyan
home=/Users/nyannyan
host=Amadeus-M204 or temporary IP
```

只有达到 configurable safety margin：

```text
FAST_PATH=eligible
```

否则：

```text
FAST_PATH=blocked
CLEAN_RESTORE_PATH=required
```

不能仅用 compressed export size 判断导入后空间。

---

# 11. Pre-export Garbage Cleanup

新增或扩展：

```text
scripts/skuld-pre-export-cleanup.sh
```

必须：

```text
--plan first
--apply only explicitly
```

允许清理：

```text
expired project release tags
unprotected dangling project images
expired BuildKit cache
stale test/rehearsal containers
known /tmp/skuld-* leftovers
apt package cache
bounded old journal
expired disposable deployment evidence
known generated build temp
```

禁止：

```text
Docker volumes
DBs
Avalon media/downloads
Immich retained source
secret bundles
latest service-aware backup
latest OrbStack export
current image
previous known-good
rollback/checkpoint referenced image
unknown owner path
```

输出：

```text
FREE_BEFORE_BYTES
FREE_AFTER_BYTES
FREE_DELTA_BYTES
REMOVED_OBJECTS
PROTECTED_OBJECTS
```

释放 >= meaningful threshold 时走 owner notification。

---

# 12. Image Retention 必须消费真实 Protected Set

`storage-maintenance.sh` 必须保护：

```text
running image IDs/tags
current release image
previous known-good
rollback tags
checkpoint/evidence referenced tags
last N project releases
9Router exact image
```

必须把 protected set 真正用于删除决策。

测试：

```text
old but running              KEEP
checkpoint referenced        KEEP
rollback tag                 KEEP
last N                       KEEP
unreferenced old project tag REMOVE
unknown image                REPORT_ONLY
```

---

# 13. Agent Context / Repo Hygiene

`.agent/checkpoints` 中 pre-OpenClaw/LangBot/old HomeHub checkpoint 不应继续污染默认 Agent context。

本轮：

- Git history 保留历史；
- active `.agent/` 只保留当前架构、最新稳定 release、Operation Skuld、当前开发 workflow 必需文件；
- 可留 `docs/history/README.md` 指向 Git history；
- 不把旧文件复制到另一个目录制造同样噪声。

目标：

```text
Codex default scan .agent
=> current reality only
```

---

# 14. SSH Destination Bootstrap

新增：

```text
scripts/skuld-destination-bootstrap.sh
```

接口：

```text
--target nyannyan@HOST --check
--target nyannyan@HOST --apply
```

旧 Mac 是一次性迁移 controller。

## 14.1 新 Mac 人工初始化步骤（已定，不再建议）

Operator 在新 Mac 本地：

1. 完成 macOS 首次 Setup；
2. 创建 short username **`nyannyan`**；
3. Home 必须为 `/Users/nyannyan`；
4. 将电脑命名为 **`Amadeus-M204`**；
5. 接入有线 Ethernet；
6. 先使用与旧 Mac 不冲突的临时 DHCP/LAN IP；
7. System Settings -> General -> Sharing -> 开启 **Remote Login**，仅允许 `nyannyan`；
8. 不使用 Migration Assistant 整体复制旧 HomeLab；
9. 旧 Mac public SSH key 加入 `/Users/nyannyan/.ssh/authorized_keys`；
10. 验证 old Mac -> `nyannyan@Amadeus-M204.local` 或临时 IP 无密码 SSH。

旧 Mac private key 不复制到新 Mac。

## 14.2 Bootstrap hard checks

远端检查：

```text
uname == Darwin
arch == arm64
whoami == nyannyan
HOME == /Users/nyannyan
ComputerName == Amadeus-M204
LocalHostName == Amadeus-M204
HostName == Amadeus-M204
internal free bytes sufficient
SSH host fingerprint recorded
network reachability
```

如果 hostname 尚未设置，`--apply` 可以显式设置三种 scutil identity。

如果 remote user 不是 `nyannyan`：

```text
DESTINATION_BOOTSTRAP=BLOCKED
```

不得静默换用户继续。

## 14.3 Bootstrap apply

安装/准备：

```text
Homebrew
git
node/pnpm
tmux
cloudflared when contract requires
OrbStack
repo clone under /Users/nyannyan
host-profile local override
```

Host Profile destination 至少应生成/验证：

```text
MAC_CONTROL_USER=nyannyan
```

不要因为 guest 内存在 `/home/blacksidev` 就把 MAC_CONTROL_USER 写回 blacksidev。

OrbStack GUI 需要 first-run 时：

```text
BLOCKED: open OrbStack once locally on Amadeus-M204
```

而不是无限等待。

## 14.4 Active host path audit

Destination preflight 必须执行 active path audit：

```text
FORBIDDEN_HOST_PATH=/Users/blacksidev
```

允许 explicit historical docs/evidence，禁止 active script/config/template/LaunchAgent/runtime target 依赖该路径。

Guest path `/home/blacksidev` 不属于此检查。

## 14.5 不提前启动第二 runtime

Bootstrap 阶段禁止：

```text
OpenClaw owner channels active
frpc/public ingress active
Product Radar/changedetection owner delivery active
```

可以 build/check，不得双活。

---

# 15. SSH Migration Controller / State Machine

新增：

```text
scripts/operation-skuld.sh
```

它是 deterministic migration controller，不是第二 Agent。

建议接口：

```text
operation-skuld.sh status
operation-skuld.sh source-preflight
operation-skuld.sh destination-preflight --target nyannyan@HOST
operation-skuld.sh prepare-artifacts --apply
operation-skuld.sh freeze-source --apply --approval-token ...
operation-skuld.sh export-orbstack --apply
operation-skuld.sh mark-disk-moved --approval-token ...
operation-skuld.sh import-destination --target nyannyan@HOST --apply
operation-skuld.sh validate-destination --target nyannyan@HOST
operation-skuld.sh cutover --apply --approval-token ...
operation-skuld.sh rollback --apply --approval-token ...
```

State：

```text
$SKULD_BACKUP_ROOT/cutover/state.json
```

状态至少：

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

- idempotent；
- resumable；
- previous-state validation；
- destructive/traffic mutation requires approval；
- no physical-disk-move gate skipping；
- state records destination identity `Amadeus-M204/nyannyan`。

---

# 16. Source Freeze

Freeze 前旧 Mac 一直 authoritative。

`freeze-source` 必须：

1. source readiness；
2. 记录 outbox pending/sent；
3. final service-aware backup；
4. fresh Immich `pg_dump -Fc`；
5. fresh encrypted sensitive-state bundle；
6. exact 9Router artifact verify；
7. stop write-producing/external-delivery runtime；
8. stop public ingress；
9. record restart policies；
10. 确保 imported VM first boot 不会双活；
11. stop OrbStack ubuntu；
12. freeze 后旧 runtime 不再接受 owner/channel/media writes。

优先停止：

```text
public ingress/tunnel
OpenClaw owner channels
Product Radar/changedetection producers
media workflow writers
Immich writers
remaining containers
OrbStack ubuntu
```

服务列表来自 live contract，不仅靠硬编码。

---

# 17. OrbStack Export & Avalon Physical Move

Source frozen 后：

```text
orb export ubuntu $SKULD_BACKUP_ROOT/orbstack/ubuntu-<stamp>.tar.zst
```

要求：

```text
exit=0
sha256
manifest
readback
capacity check
artifact size recorded
```

完成后安全 unmount Avalon。

必须 unmount 成功后才允许拔盘。

State：

```text
DISK_MOVE_REQUIRED
```

然后物理把 Avalon 从旧 Mac 接到 Amadeus-M204。

---

# 18. Destination Restore — Fast Path

在 **Amadeus-M204 / nyannyan**：

1. Avalon mount；
2. Volume UUID；
3. sentinel；
4. latest cutover state；
5. export SHA256；
6. destination identity re-check；
7. no machine-name conflict；
8. `orb import -n ubuntu ...`；
9. imported machine first boot external ingress disabled；
10. `/DATA/AppData` / Docker / CasaOS verify；
11. host bind `/Volumes/Avalon` verify；
12. host LaunchAgents restored under `nyannyan`。

Host-level restore：

```text
FashionSigLIP LaunchAgent
storage-health LaunchAgent
storage-maintenance LaunchAgent
required host-side tunnel/remote-access agents from classified inventory
```

禁止复制未知 `~/Library/LaunchAgents`。

---

# 19. Destination Restore — Clean Path

Fast Path blocked 时：

```text
prepare fresh OrbStack Ubuntu
install CasaOS using verified source
restore tracked compose/contracts
restore full HomeLab state
restore encrypted sensitive state
restore SQLite snapshots
pg_restore Immich
load exact 9Router image
attach Avalon
rebuild REBUILD services
install host LaunchAgents under /Users/nyannyan
```

使用同一 manifest/runbook contract。

---

# 20. Destination Validation（入口仍关闭）

至少验证：

```text
host identity Amadeus-M204
macOS user/home nyannyan / /Users/nyannyan
no active host-side /Users/blacksidev dependency
Avalon identity
Immich media root
Immich PostgreSQL + VectorChord
historical photo/video read
9Router dashboard/auth boundary
OpenClaw config/plugins
Product Radar DB/health
SQLite integrity
owner outbox idempotency
Emby/Jellyfin media roots
qBittorrent/Aria2 download roots
NPM certificate state
Alist storage mount
frpc config present but ingress stopped
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

此前 owner channel/public ingress 仍 off。

---

# 21. LAN / IP Cutover

Staging：

```text
old Mac = existing production LAN IP
Amadeus-M204 = temporary non-conflicting IP
```

Cutover：

```text
old runtime stopped
old host releases production IP
Amadeus-M204 optionally inherits old LAN IP
```

具体 IP 不写死在 repo，由 Host Profile / operator 决定。

Hard rule：

```text
old/new never share same LAN IP simultaneously
```

---

# 22. Cutover 顺序

仅在：

```text
DESTINATION_VALIDATED=yes
```

后允许：

```text
1. DB/Redis dependencies
2. 9Router
3. Immich/media dependencies
4. Emby/Jellyfin/Alist/download services
5. media adapter
6. Product Radar owner delivery still gated
7. OpenClaw
8. owner delivery/channel ingress
9. frpc/public ingress LAST
```

Dependency graph 应来自 contract。

必须避免 old/new OpenClaw 同时消费 Telegram/WhatsApp。

---

# 23. First Real User Test

所有 health green 后，Operator 明确执行一次：

```text
Operator -> Telegram/WhatsApp -> Amadeus-M204 Amadeus
```

验证：

```text
only destination receives
session isolation correct
9Router responds
owner notification works
no duplicate reply
```

只记录 event key / pass-fail，不记录私聊正文。

之后：

```text
CUTOVER_COMMITTED=yes
```

---

# 24. Rollback

## 24.1 Destination 未接受真实 writes

```text
stop destination
unmount Avalon
move Avalon back
verify UUID
start old OrbStack
restore restart policies/ingress
health
reopen channels
```

## 24.2 Destination 已接受真实 writes

禁止盲目启动旧 snapshot。

进入：

```text
ROLLBACK_REQUIRED
DATA_DIVERGENCE_REVIEW
```

检查：

```text
SQLite writes
Immich DB writes
outbox/channel events
media/download changes
```

决定 reverse/replay，避免双写。

---

# 25. Old Mac 保留策略

Cutover 成功后旧 Mac：

```text
powered/stopped as rollback host
```

至少建议保留 48-72h：

- old OrbStack 不启动；
- old ingress 不启动；
- old host 不抢 production IP；
- old data 不删除；
- migration artifacts 保留。

稳定后才单独讨论：

```text
Immich retained source reclaim
old Mac repurpose
old host artifact cleanup
```

---

# 26. Host-level Remote Access Inventory

扫描并分类 macOS host：

```text
Remote Login/sshd
Cloudflare Tunnel
Tailscale
Cumora
FashionSigLIP LaunchAgent
storage LaunchAgents
other tracked com.amadeus/com.productradar jobs
```

分类：

```text
MIGRATE_CONFIG
REINSTALL
REPAIR
DROP
MANUAL_BLOCKER
```

所有 destination path 必须针对 `/Users/nyannyan` 或 host-neutral path。

不要复制整个旧 `~/Library/LaunchAgents`。

---

# 27. SSH Key Policy

迁移 controller：

```text
old Mac private key stays on old Mac
old Mac public key -> /Users/nyannyan/.ssh/authorized_keys
```

权限必须：

```text
~/.ssh 0700
authorized_keys 0600
owner nyannyan
```

新 Mac 长期：

- 可添加现有 trusted client public keys；
- Amadeus-M204 自己生成新的 outbound personal SSH key（如果需要）；
- Amadeus service-specific VPS/NAS keys 从 encrypted bundle 恢复到明确 target；
- personal private key 不进入 Git/HomeLab service bundle，除非它本来就是 manifest-declared service credential。

---

# 28. Development Efficiency

继续执行 1.4.5 Validation Matrix。

开发阶段：

```text
migration shell -> bash -n + fixture
docs/manifest -> contract test
storage -> storage fixture
backup -> backup fixture
SSH controller -> fake target fixture
host identity -> fake Darwin/user/home/scutil fixture
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

- runtime source 变化 -> affected image only；
- migration scripts/docs only -> no OpenClaw/Product Radar build。

## 28.1 Safe validation cache

Cache fingerprint 必须包含：

```text
command
input file hashes
relevant dependency lock hash
```

不能由 Agent 随意复用人工 cache key。

Release evidence：

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

# 29. 1.4.6 Final Source Preparation

发布 1.4.6 后在旧 Mac 执行一次 final prep，但**不 freeze/cutover**：

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
SSH destination bootstrap plan for nyannyan@Amadeus-M204
```

如果硬件尚未到：

```text
DESTINATION_SSH=WAITING_FOR_HARDWARE
```

最终 source state：

```text
Amadeus 1.4.6
source runtime healthy
migration artifacts current
garbage safely reduced
Avalon verified
Immich source retained
controller ready
destination identity frozen: Amadeus-M204 / nyannyan
waiting for Mac mini
```

---

# 30. Acceptance Tests

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
test:skuld-destination-identity
test:destination-old-host-path-blocker
test:orbstack-snapshot-manifest
test:skuld-capacity-plan
```

Destructive tests 只使用 fixture/temp/fake target，不碰真实数据。

特别验证：

```text
nyannyan@Amadeus-M204 -> PASS
blacksidev@Amadeus-M204 -> BLOCK as destination operator identity
/Users/blacksidev in destination active config -> BLOCK
/home/blacksidev inside imported Linux guest -> ALLOW
```

---

# 31. Release Evidence

最终 tracked report 至少：

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
DESTINATION_HOST_IDENTITY=Amadeus-M204
DESTINATION_MACOS_USER=nyannyan
DESTINATION_HOME=/Users/nyannyan
DESTINATION_OLD_HOST_PATH_DEPENDENCIES=0
IMMICH_SOURCE_RECLAIM=PENDING
MAC_MINI_CUTOVER=NOT_EXECUTED
OPERATION_SKULD_SOURCE_READY=yes
```

新 Mac 已到货后的 destination/cutover evidence 单独记录，不把硬件存在作为 source release blocker。

---

# 32. Non-goals

1.4.6 不做：

- 新业务 Plugin；
- Agent architecture 重构；
- Worldline vocabulary 重构；
- 自动删除 Immich retained source；
- 自动抹除旧 Mac；
- 自动修改家庭路由器 DHCP；
- 自动发送真实 Telegram/WhatsApp test message；
- 未经 approval 自动开启 destination public ingress；
- macOS Migration Assistant 整机复制 HomeLab；
- 把新 Mac 用户改回 blacksidev；
- 重命名 imported Linux guest 的 blacksidev 用户/目录。

---

# 33. 今晚 Amadeus-M204 到货后的 Operator Checklist

## A. 新 Mac 本地初始化

```text
[ ] macOS 首次设置
[ ] Account Name / short username = nyannyan
[ ] Home = /Users/nyannyan
[ ] ComputerName = Amadeus-M204
[ ] LocalHostName = Amadeus-M204
[ ] HostName = Amadeus-M204
[ ] Ethernet 接入
[ ] 临时 DHCP/LAN IP，与旧 Mac 不冲突
[ ] Remote Login ON，仅允许 nyannyan
[ ] 不使用 Migration Assistant 搬 HomeLab
```

可验证：

```bash
whoami
printf '%s\n' "$HOME"
scutil --get ComputerName
scutil --get LocalHostName
scutil --get HostName
```

期望：

```text
nyannyan
/Users/nyannyan
Amadeus-M204
Amadeus-M204
Amadeus-M204
```

## B. 旧 Mac 建立 SSH 控制

旧 Mac：

```bash
ssh nyannyan@<new-mac-temp-ip>
```

或 mDNS 可用时：

```bash
ssh nyannyan@Amadeus-M204.local
```

确认 host fingerprint 后，只把旧 Mac **public key** 加到：

```text
/Users/nyannyan/.ssh/authorized_keys
```

再次验证无密码 SSH。

然后：

```bash
./scripts/operation-skuld.sh destination-preflight --target nyannyan@<host>
./scripts/skuld-destination-bootstrap.sh --target nyannyan@<host> --apply
```

如果 OrbStack first-run 需要 GUI，在 Amadeus-M204 本地打开一次 OrbStack，再 rerun preflight。

## C. 不移动 Avalon，先 bootstrap 新机

旧 HomeLab 继续工作时完成：

```text
SSH
Git clone under /Users/nyannyan
Homebrew/dependencies
OrbStack install/first-run
host identity checks
active old-host-path audit
repo/bootstrap checks
capacity plan
```

## D. 正式迁移窗口

只有 destination bootstrap green 后：

```bash
./scripts/operation-skuld.sh prepare-artifacts --apply
./scripts/operation-skuld.sh freeze-source --apply --approval-token <explicit-token>
./scripts/operation-skuld.sh export-orbstack --apply
```

确认 export + checksum，安全 unmount Avalon。

## E. 物理移动 Avalon

```text
old Mac -> safe unmount -> unplug Avalon
Amadeus-M204 -> attach Avalon
```

验证：

```text
UUID
sentinel
migration state
export checksum
destination identity
```

然后：

```bash
./scripts/operation-skuld.sh import-destination --target nyannyan@<host> --apply
./scripts/operation-skuld.sh validate-destination --target nyannyan@<host>
```

## F. LAN/IP 与正式 Cutover

验证通过后：

1. 确保旧 Mac 不再占计划中的 production IP；
2. 如需要让 Amadeus-M204 继承旧 LAN IP；
3. 内部依赖先启动；
4. OpenClaw/owner channels 后启动；
5. frpc/public ingress 最后；
6. doctor/readiness green；
7. Operator 手工发一条真实消息；
8. commit cutover state。

## G. 旧 Mac 不立刻清空

至少 48-72h：

```text
old OrbStack stopped
old ingress stopped
old Mac does not own production IP
old data retained
```

之后再单独讨论 Immich source reclaim / old Mac repurpose。

---

# 34. 建议 Codex /goal

```text
/goal Implement docs/AMADEUS_1_4_6_OPERATION_SKULD_CUTOVER_READINESS_GOAL.md completely. This is the final migration-preparation release before the new Mac mini cutover. Re-audit current main and the canonical old-Mac CasaOS/OrbStack runtime first. The destination identity is fixed and must not be changed or inferred: ComputerName/LocalHostName/HostName=Amadeus-M204, macOS short user=nyannyan, destination home=/Users/nyannyan. The old macOS user may remain blacksidev on the source host, and imported OrbStack Linux guest paths such as /home/blacksidev must remain untouched; however any active destination host-side dependency on /Users/blacksidev is a migration blocker. Fix every 1.4.5 audit issue, especially the production Immich remote checksum gate. Complete full HomeLab state/sensitive-state backup coverage, protect the tracked migration contract from live-inventory overwrite, make image/checkpoint retention consume the actual protected set, fix storage growth telemetry, add safe pre-export cleanup, implement the OrbStack whole-machine export/import fast path plus independent clean-restore fallback, and implement a deterministic SSH-based Operation Skuld controller so the old Mac can bootstrap nyannyan@Amadeus-M204 until cutover. Keep all destructive and traffic-changing phases behind explicit approval gates. Do NOT reclaim /DATA/Gallery/immich, do NOT perform the actual Mac mini cutover in this goal, do NOT enable a second OpenClaw owner-channel runtime, do NOT delete unknown data/volumes, and do NOT rename the guest Linux user just to match the new macOS username. Preserve the scope-aware validation workflow, use targeted tests during implementation and one final full release gate, release as 1.4.6, commit/push, deploy to the current canonical old Mac, run source-side final preparation/cleanup/readiness, and commit/push sanitized evidence. Final source state must be ready to begin Operation Skuld immediately when Amadeus-M204 is physically available.
```
