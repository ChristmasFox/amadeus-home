# Amadeus 1.4.6 — Operation Skuld Clean Cutover Readiness Goal

更新时间：2026-09-22（北京时间）

## 0. 本 Goal 的唯一定位

**1.4.6 只做迁移前准备，不开始迁移。**

执行本 Goal 时，旧 Mac 仍是唯一 authoritative runtime。不得连接、修改、bootstrap、冻结或切换尚未进入正式迁移窗口的新 Mac mini；不得移动 Avalon；不得停止当前 HomeLab；不得实际执行 destination restore/cutover。

本轮只完成：

```text
修复 1.4.5 最后审计问题
+ 完整 HomeLab 可恢复备份
+ 完整 secret / sensitive-state 迁移覆盖
+ 安全垃圾清理
+ clean destination bootstrap 工具
+ clean OrbStack Ubuntu guest restore 工具
+ deterministic cutover/rollback controller
+ 今晚可直接照着执行的 Runbook
```

最终 source-side 状态：

```text
VERSION=1.4.6
OPERATION_SKULD_SOURCE_READY=yes
OPERATION_SKULD_CLEAN_RESTORE_READY=yes
OPERATION_SKULD_DESTINATION_BOOTSTRAP_READY=yes
OPERATION_SKULD_FULL_HOMELAB_BACKUP_READY=yes
OPERATION_SKULD_SSH_CONTROLLER_READY=yes
OPERATION_SKULD_CUTOVER_RUNBOOK_READY=yes
IMMICH_SOURCE_RECLAIM=PENDING
MAC_MINI_CUTOVER=NOT_EXECUTED
DESTINATION_MUTATED=NO
SOURCE_FROZEN=NO
```

---

# 1. 最终 Destination Identity Contract

新 Mac mini 的目标身份已经确定：

```text
macOS ComputerName   = Amadeus-M204
macOS LocalHostName  = Amadeus-M204
macOS HostName       = Amadeus-M204
macOS short user     = nyannyan
macOS home           = /Users/nyannyan
SSH identity         = nyannyan@Amadeus-M204.local
```

迁移初期 mDNS 尚未稳定时允许：

```text
nyannyan@<temporary-lan-ip>
```

新 Mac active host-side 配置中出现以下任一项必须 BLOCK：

```text
/Users/blacksidev
~blacksidev
hard-coded old macOS username
```

所有 host-side 路径必须基于：

```text
$HOME
Host Profile
/Users/nyannyan
```

覆盖范围至少包括：

```text
SSH
repo checkout
LaunchAgents
FashionSigLIP
Cloudflare/remote-access config
storage scheduler
host-profile local override
migration controller state
```

---

# 2. 新 OrbStack 目标：干净 Ubuntu，不导入旧 Guest

用户明确要求新 Mac 使用**全新 OrbStack Ubuntu guest**。

目标：

```text
OrbStack machine name = nyannyan
Ubuntu release        = 24.04 LTS / noble
Linux default user    = nyannyan
```

目标创建命令按 OrbStack 官方能力实现为：

```bash
orb create ubuntu:noble nyannyan
```

实现/Runbook 必须验证：

```text
orb machine exists: nyannyan
uname architecture expected for Apple Silicon
/etc/os-release => Ubuntu 24.04 / noble
whoami => nyannyan
$HOME => /home/nyannyan
passwordless sudo works as expected
```

OrbStack 默认会按 macOS 用户名创建 Linux 用户，因此 macOS user `nyannyan` 与 fresh guest user `nyannyan` 应自然一致；仍必须在 bootstrap 后显式验证，不能靠假设。

## 2.1 禁止把旧 Guest 当生产迁移目标

旧 Mac 当前 OrbStack `ubuntu`：

```text
不得直接 orb import 到新 Mac 作为生产 guest
不得把 /home/blacksidev 作为 destination active identity
不得通过 Linux user rename 把旧 guest“洗成”新 guest
```

旧 Guest 可以在正式 cutover 前生成一次 **archive-only** export 作为灾难恢复工件，但：

```text
OLD_ORBSTACK_EXPORT_ROLE=rollback-archive-only
DEFAULT_DESTINATION_IMPORT=forbidden
```

除非 clean restore 失败并且 Operator 另行明确批准 emergency import，否则新 Mac 永远使用 clean `nyannyan` guest。

---

# 3. Guest Path Normalization

Clean restore 必须消灭 active destination 对旧 guest user home 的依赖。

Source 中存在：

```text
/home/blacksidev/...
```

时，逐项进入 migration contract，不能简单 raw-copy 到同一路径。

优先迁移为：

```text
/DATA/AppData/<service>
```

仅服务本身必须使用用户目录时，才映射到：

```text
/home/nyannyan/<service>
```

例如当前已知 Xiaoya 需要重新审计：

```text
source: /home/blacksidev/xiaoya
candidate destination: /DATA/AppData/xiaoya
fallback destination: /home/nyannyan/xiaoya
```

最终 destination contract 中：

```text
active /home/blacksidev references = 0
```

source-only evidence/history 可以保留旧路径文字。

---

# 4. 1.4.6 执行边界：Preparation Only

本 Goal 实施过程中允许：

```text
修改/测试/提交 migration tooling
更新 manifest/runbook
生成新的 source-side backups
生成 encrypted bundles
生成 service-aware artifacts
安全 runtime cleanup / GC
source readiness
容量盘点
fixture/fake-SSH rehearsal
```

本 Goal 实施过程中禁止：

```text
SSH 到真实新 Mac 并修改它
在真实新 Mac 安装 OrbStack
在真实新 Mac 创建 guest
停止旧 Mac HomeLab
freeze source
live orb export 作为迁移动作
移动/卸载 Avalon 用于迁移
启动 destination services
修改 LAN production IP
开启第二套 OpenClaw owner channels
任何实际 cutover
```

如果新 Mac 在 Goal 执行期间提前到货，仍输出：

```text
HARDWARE_AVAILABLE=yes
CUTOVER_DEFERRED=yes
```

然后完成 1.4.6 source release；正式迁移使用单独的 Operation Skuld 执行流程。

---

# 5. 修复 1.4.5 最终审计问题

## 5.1 P0 — Immich Reclaim Remote Equivalence

`scripts/reclaim-immich-old-source.sh` 的 production remote gate：

```text
rsync -a --checksum --dry-run --itemize-changes source/ destination/
```

必须满足：

```text
exit code == 0
AND
source -> destination actual change lines == 0
```

允许 destination-only files。

以下必须 FAIL：

```text
destination missing source file
same-size different-content
source-only new file
source changed/newer file
type/path mismatch
anything that would require rsync mutation
```

任何差异都不得写：

```text
FRESH_ONE_WAY_EQUIVALENCE=passed
SOURCE_RECLAIM_READY
```

新增 production-style fixture 覆盖 PASS/FAIL 情况。

**本 Goal 仍禁止删除 `/DATA/Gallery/immich`。**

## 5.2 Storage Growth

修复 `storage-health.sh` quoted heredoc 中 literal `${MACHINE}` 问题。

machine name 必须显式 argv/env 传入 Python。

真实采集：

```text
immichMediaBytes
mediaBytes
downloadsBytes
dockerBytes
```

不存在目录记录 `not-present`，不能静默 null。

保留 90d history；有足够样本时可计算 7d/30d growth。

## 5.3 Service Inventory 不再覆盖 Contract

改造：

```text
scripts/service-inventory.sh --scan --output PATH
scripts/service-inventory.sh --check
scripts/service-inventory.sh --diff-contract
```

Live observation 只能输出 sanitized artifact，不得覆盖：

```text
docs/OPERATION_SKULD_SERVICE_INVENTORY.md
docs/OPERATION_SKULD_MIGRATION_MANIFEST.json
```

新出现且无 contract 的 running service => `MANUAL_BLOCKER`。

## 5.4 Image / Checkpoint Protected Set

安全 GC 必须真正消费：

```text
running image IDs/tags
current release
previous known-good
rollback tags
checkpoint/evidence referenced tags
last N project releases
exact 9Router artifact/image
```

禁止“只生成 running-images.txt 但删除逻辑不读取”。

## 5.5 Secret bundle metadata

若仍存在 0700 temporary plaintext staging，manifest 如实记录：

```text
plaintextStaging=ephemeral-0700-cleanup-on-exit
```

不能继续写 `plaintextTemporaryFiles=false`。

## 5.6 Validation cache

cache key 自动由：

```text
command
+ input file content hashes
+ relevant lock/config hash
```

生成。

Agent 不能随意指定一个永久人工 key 绕过 invalidation。

## 5.7 Agent context hygiene

清理 active `.agent/` 中已经 retired 的 LangBot/HomeHub/旧迁移 checkpoint 噪声。

原则：

```text
Git history 保留
active tree 只保留当前 architecture/release/Skuld/workflow 所需上下文
```

不得误删 runtime/migration contract。

---

# 6. Full HomeLab Clean-Restore Backup

1.4.6 必须把“已分类”升级成“真正可恢复”。

Live scan 后以真实运行服务为准，至少审计：

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

每个 `MIGRATE` 服务必须有：

```text
source location
destination location on clean nyannyan guest
backup artifact
backup consistency method
secret/sensitive-state policy
restore command/method
verification
cutover dependency
```

建议新增：

```text
scripts/export-skuld-homelab-state.sh
scripts/verify-skuld-homelab-state.sh
scripts/restore-skuld-homelab-state.sh
```

输出：

```text
$SKULD_BACKUP_ROOT/final-prep-<stamp>/
  manifest.json
  service-aware/
  homelab-state/
  sensitive-state/
  named-volumes/
  9router/
  host-inventory/
```

## 6.1 External data 只引用不打包

以下只记录 UUID/sentinel/path/count/bytes/health/equivalence：

```text
Avalon media
Avalon downloads
Immich media
其他大型 external data
```

禁止 tar 数 TB 数据。

## 6.2 DB 必须一致性备份

```text
SQLite -> backup API + PRAGMA integrity_check + sha256
Immich PostgreSQL -> pg_dump -Fc + pg_restore --list + sha256
其他 DB -> service-specific logical/consistent method
```

不得只 raw-copy live DB。

## 6.3 Named volumes

需要迁移的 named volume：

```text
docker volume inspect
explicit export
sha256
explicit destination restore target
```

禁止 generic volume prune。

---

# 7. Secret / Sensitive State 完整覆盖

分类：

```text
secret value
sensitive env/config
credential-bearing DB/state
non-sensitive state
```

至少覆盖：

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
changedetection/media-adapter env when present
```

规则：

```text
独立 env/file secret -> encrypted secret bundle
credential-bearing DB/config -> encrypted sensitive-state artifact
```

禁止为了枚举 secret 而打印/提取数据库中的认证值。

运行服务存在认证状态但无 migration artifact：

```text
OPERATION_SKULD_SOURCE_READY=no
```

---

# 8. Source-side Safe Cleanup

1.4.6 release 完成后允许做一次 source cleanup，但不得改变 runtime 语义。

允许：

```text
expired unprotected project image tags
unprotected dangling project images
expired BuildKit cache
stale test/rehearsal containers
known /tmp/skuld-* leftovers
package cache
bounded old system journal
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
latest migration backup
current/previous/rollback/checkpoint images
unknown owner paths
```

输出 before/after/freed bytes 和 removed/protected inventory。

---

# 9. Clean Destination Bootstrap Tooling

新增：

```text
scripts/skuld-destination-bootstrap.sh
```

接口：

```text
--target USER@HOST --check
--target USER@HOST --apply
```

**本 Goal 只通过 fake SSH / fixture 测试它，不对真实新 Mac 执行。**

真实运行时必须验证：

```text
Darwin
arm64
whoami=nyannyan
HOME=/Users/nyannyan
ComputerName=Amadeus-M204
LocalHostName=Amadeus-M204
HostName=Amadeus-M204
internal free bytes
SSH fingerprint pinned/recorded
```

`--apply` 可准备：

```text
Homebrew
git
node/pnpm
tmux
cloudflared when contract requires
OrbStack app
repo clone
host-profile local override template
```

OrbStack GUI 首次启动需要人工操作时：

```text
DESTINATION_BOOTSTRAP=BLOCKED_ORBSTACK_FIRST_RUN
```

明确提示 Operator 在 Amadeus-M204 本地打开 OrbStack 一次，不能无限等待。

---

# 10. Clean OrbStack Guest Bootstrap

新增：

```text
scripts/skuld-create-clean-guest.sh
```

真实迁移时在新 Mac 执行：

```bash
orb create ubuntu:noble nyannyan
```

必须 fail-closed：

```text
已有 machine nyannyan -> 不覆盖，要求 review
wrong distro/version -> BLOCK
wrong default user -> BLOCK
wrong architecture -> BLOCK
```

创建后验证：

```text
machine name = nyannyan
guest user = nyannyan
guest home = /home/nyannyan
Ubuntu 24.04 LTS
sudo boundary usable
```

随后 clean guest 才进入：

```text
CasaOS installation
Docker/log policy
network creation
service restore
```

CasaOS 安装命令必须在实际执行时从官方 source 重新确认；1.4.6 只准备 deterministic wrapper/contract，不把未经验证的第三方一键脚本固化为不可变事实。

---

# 11. Old OrbStack Archive（Rollback Only）

新增/保留：

```text
scripts/skuld-orbstack-snapshot.sh
```

用途仅为：

```text
old guest disaster-recovery archive
```

接口：

```text
--plan
--export --apply
--verify ARTIFACT
```

**1.4.6 Goal 不执行 live export。**

实际 cutover 前 Operator 可选择生成：

```text
$SKULD_BACKUP_ROOT/orbstack-archive/ubuntu-<stamp>.tar.zst
sha256
manifest.json
```

它不参与默认 destination restore，不被 `orb import` 到生产 Amadeus-M204。

---

# 12. Clean Restore Controller / State Machine

新增：

```text
scripts/operation-skuld.sh
```

这是 deterministic migration controller，不是第二 Agent。

建议命令：

```text
status
source-preflight
destination-preflight --target nyannyan@HOST
prepare-artifacts --apply
freeze-source --apply --approval-token ...
archive-old-guest --apply               # optional rollback artifact
mark-disk-moved --approval-token ...
bootstrap-clean-destination --target ... --apply
create-clean-guest --target ... --apply
restore-clean-guest --target ... --apply
validate-destination --target ...
cutover --target ... --apply --approval-token ...
rollback --apply --approval-token ...
```

State：

```text
$SKULD_BACKUP_ROOT/cutover/state.json
```

至少：

```text
SOURCE_READY
DESTINATION_SSH_READY
DESTINATION_BOOTSTRAPPED
CLEAN_GUEST_READY
ARTIFACTS_READY
FREEZE_ARMED
SOURCE_FROZEN
OLD_GUEST_ARCHIVED_OPTIONAL
DISK_MOVE_REQUIRED
DESTINATION_STORAGE_VERIFIED
DESTINATION_RESTORED
DESTINATION_VALIDATED
CUTOVER_ARMED
CUTOVER_COMMITTED
ROLLBACK_REQUIRED
```

每个 phase：

```text
idempotent
resumable
previous-state validated
traffic/destructive mutation requires approval
```

---

# 13. 1.4.6 Source Readiness

实现完成后，在旧 Mac 只执行 source-side preparation：

```text
source readiness
live service inventory diff
full HomeLab migration backup rehearsal/live backup
secret/sensitive-state bundle + import rehearsal
9Router artifact verify
safe cleanup
storage health/growth
clean-destination capacity estimate
SSH bootstrap fixture
clean guest fixture
controller fixture
```

但保持：

```text
SOURCE_FROZEN=no
DESTINATION_MUTATED=no
AVALON_MOVED=no
CUTOVER_STARTED=no
```

---

# 14. Development Efficiency

沿用 1.4.5：

```text
编辑阶段 -> targeted validation
phase gate -> affected checks
release boundary -> one final full test/typecheck/build/secret gate
runtime source 未变化 -> 不构建无关镜像
成功输出 -> compact evidence
失败 -> bounded diagnostics
```

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

# 15. Acceptance Tests

至少新增/扩展：

```text
test:immich-reclaim-remote-equivalence
test:storage-growth-machine
test:service-inventory-contract
test:homelab-backup
test:sensitive-state-bundle
test:image-protected-set
test:destination-identity
test:clean-guest-contract
test:guest-path-normalization
test:skuld-controller-state-machine
test:skuld-destination-ssh-fixture
test:orbstack-archive-manifest
test:skuld-capacity-plan
```

所有 destructive/network tests 使用 fixture/temp/fake SSH target。

---

# 16. Release Evidence

最终报告至少：

```text
VERSION=1.4.6
AUDIT_BLOCKERS=0
IMMICH_RECLAIM_REMOTE_GATE=fixed
STORAGE_GROWTH=valid
SERVICE_INVENTORY_CONTRACT=protected
FULL_HOMELAB_BACKUP=ready
SENSITIVE_STATE_COVERAGE=complete-for-live-services
IMAGE_PROTECTED_SET=verified
SAFE_SOURCE_CLEANUP=passed
DESTINATION_IDENTITY=Amadeus-M204/nyannyan
CLEAN_GUEST_TARGET=ubuntu:noble/nyannyan
CLEAN_RESTORE_TOOLING=ready
SSH_CONTROLLER=ready
CUTOVER_CONTROLLER=ready
OLD_GUEST_IMPORT_DEFAULT=forbidden
IMMICH_SOURCE_RECLAIM=PENDING
SOURCE_FROZEN=NO
DESTINATION_MUTATED=NO
MAC_MINI_CUTOVER=NOT_EXECUTED
OPERATION_SKULD_SOURCE_READY=yes
```

---

# 17. Mac mini 到货后怎么做（正式迁移流程，不属于 1.4.6 Goal 执行）

## A. 新 Mac 本地初始化

新 Mac 到手后人工完成：

```text
[ ] macOS Setup
[ ] short username = nyannyan
[ ] ComputerName/LocalHostName/HostName = Amadeus-M204
[ ] Ethernet 接入
[ ] 获得临时 LAN IP（不得与旧 Mac 冲突）
[ ] System Settings -> General -> Sharing -> Remote Login ON
[ ] Remote Login 只允许 nyannyan
[ ] 不用 Migration Assistant 搬 HomeLab
```

## B. 旧 Mac 建立到新 Mac 的 SSH

先密码登录：

```bash
ssh nyannyan@<new-mac-temp-ip>
```

确认 fingerprint。

将旧 Mac **public key** 加到新 Mac：

```text
/Users/nyannyan/.ssh/authorized_keys
```

旧 Mac private key 不复制过去。

再次验证 passwordless SSH。

## C. 安装 OrbStack

新 Mac **需要安装 OrbStack macOS 客户端**。

两种方式任选：

```text
1. Operator 手工安装并打开一次 OrbStack
2. 让 skuld-destination-bootstrap.sh 通过 Homebrew cask 安装；如需要 GUI first-run，脚本暂停让 Operator 本地打开一次
```

在 OrbStack 可用之前，不创建 guest、不恢复 HomeLab。

## D. 先 bootstrap，新旧服务仍不切换

旧 Mac：

```bash
./scripts/operation-skuld.sh destination-preflight --target nyannyan@<new-mac-temp-ip>
./scripts/skuld-destination-bootstrap.sh --target nyannyan@<new-mac-temp-ip> --apply
```

目标：

```text
SSH green
identity green
Homebrew/deps green
OrbStack first-run green
capacity green
```

此时：

```text
旧 HomeLab 继续正常工作
Avalon 仍连接旧 Mac
新 Mac 不启动任何 owner-channel runtime
```

## E. 创建干净 guest

在新 Mac：

```bash
orb create ubuntu:noble nyannyan
```

验证：

```text
orb machine = nyannyan
Linux user = nyannyan
/home/nyannyan
Ubuntu 24.04 LTS
```

只建立空白基础 guest；不要导入旧 `ubuntu` guest。

## F. 正式迁移窗口

仅在 destination bootstrap/clean guest green 后：

```text
old Mac final source preflight
fresh service-aware backup
fresh sensitive bundle
fresh Immich pg_dump
optional old OrbStack archive for rollback
freeze source writers/ingress
safe unmount Avalon
physical move Avalon -> Amadeus-M204
verify UUID + sentinel
restore HomeLab into clean guest
validate with ingress OFF
```

## G. Cutover

只有：

```text
DESTINATION_VALIDATED=yes
```

才：

```text
confirm old OpenClaw/frpc stopped
optionally move production LAN IP to Amadeus-M204
start internal dependencies
start 9Router
start media/database services
start Product Radar/media adapter
start OpenClaw
owner channels near-last
frpc/public ingress last
```

最终手工发一条 Telegram/WhatsApp 做真实验证；确认无 duplicate consumer/reply 后：

```text
CUTOVER_COMMITTED=yes
```

## H. 旧 Mac 保留

至少 48-72 小时：

```text
old OrbStack stopped
old ingress stopped
old Mac 不抢 production IP
旧数据不删除
Immich retained source 不删除
```

稳定后再单独讨论 source reclaim / old Mac repurpose。

---

# 18. Non-goals

1.4.6 不做：

```text
实际新 Mac bootstrap
实际新 Mac OrbStack 安装
实际创建 destination guest
source freeze
Avalon physical move
actual destination restore
LAN/IP cutover
真实 Telegram/WhatsApp test
Immich source reclaim
旧 Mac erase/repurpose
新业务功能
Agent architecture / Worldline 重构
```

---

# 19. Codex /goal

```text
/goal Implement docs/AMADEUS_1_4_6_OPERATION_SKULD_CUTOVER_READINESS_GOAL.md completely as a PREPARATION-ONLY release. Re-audit current main and the canonical old-Mac runtime first. Fix every remaining 1.4.5 audit issue, complete full HomeLab clean-restore backup and secret/sensitive-state coverage, safe source cleanup, protected image/checkpoint retention, destination identity checks, SSH bootstrap tooling, clean Ubuntu 24.04 OrbStack guest tooling, guest path normalization, and a deterministic clean-restore cutover/rollback controller. The future destination identity is fixed: macOS host Amadeus-M204, macOS user nyannyan, OrbStack machine nyannyan, Ubuntu user nyannyan, target distro ubuntu:noble. The production migration path MUST be a fresh OrbStack guest and clean service restore; importing the old OrbStack ubuntu guest is not the default destination path and may exist only as an archive-only rollback artifact. During this goal DO NOT SSH to or mutate the real new Mac, DO NOT install OrbStack on the real new Mac, DO NOT create a real destination guest, DO NOT freeze the old runtime, DO NOT move Avalon, DO NOT perform live cutover, and DO NOT reclaim /DATA/Gallery/immich. Preserve scope-aware validation and use targeted checks plus one final full release gate. Release as Amadeus 1.4.6, commit/push, deploy only source-side changes to the current canonical old Mac when needed, generate current source-side backups/readiness/cleanup evidence, and finish with SOURCE_FROZEN=NO, DESTINATION_MUTATED=NO, MAC_MINI_CUTOVER=NOT_EXECUTED, OPERATION_SKULD_SOURCE_READY=yes.
```
