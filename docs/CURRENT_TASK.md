# 当前任务

## 2026-09-23：Amadeus 1.4.8 Operation Skuld 最终迁移与记忆连续性（进行中）

当前优先目标为 `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`。Phase 7 source freeze、Phase 8 Avalon destination preflight 和 Phase 9 OpenClaw cold-state restore 已完成。迁移安全候选在 M204 运行，所有 owner/public ingress 与 owner delivery 仍关闭，`DESTINATION_AUTHORITY=NO`。此前报告的 84 session/JSONL 与 6 transcript 是路径子串误计，不能作为会话迁移验收；真实主会话库为 SQLite。当前运行库记录 52 sessions、5,684 transcript events、5,506 active events、1 archive row、2,827 search chunks，且 SQLite integrity 通过。修正证据见 `.agent/checkpoints/2026-09-23-kurisu-recall-audit.md`。

Phase 10 已在 M204 完成：ARM64 镜像 `local/openclaw-amadeus:git-9cb5474-20260923145233` 的 host/guest digest 一致；安全 Compose preflight 通过，候选容器 healthy，loopback-only、全部渠道关闭、无 published ports、owner delivery=false，9Router 探测通过（接受 200/401）。候选 restart policy 为 `no`。Phase 11 机器侧 SQLite/hash 检查通过，但旧 session/transcript 文件数因路径子串误计作废。更关键的是 Phase 11 操作者记忆验收失败：Kurisu 没有回忆起已存在的上下文，agent run 有两次工具失败；Identity DB 与历史 transcript 只读检索能找到对应记录。故障表现是“数据存在但运行时无法取回”，对用户而言记忆当前不可用。memory index dirty、vector index empty 且索引配置不匹配；未重建，因为重建可能把私有文本发送至外部 embedding provider。此项修复并重新验收前，不进入 Phase 12。详见 `.agent/checkpoints/2026-09-23-kurisu-recall-audit.md`。

Phase 12 前置的旧 Mac authority 复核已确认本机 `xu-mac` 上 `ai.openclaw.gateway` 是另一个 active LaunchAgent：`RunAtLoad=true`、`KeepAlive=true`，gateway 只绑定 loopback `18789`，当前仅启用 iMessage channel/plugin。保留日志有 18 行命中粗粒度 inbound 关键词；未读取任何消息内容，因此尚不能判断它是本次迁移的生产 authority 还是独立本地服务。未停止/禁用；必须先由 operator 分类，再做 fresh unique-runtime gate。详细脱敏证据见 `.agent/checkpoints/2026-09-23-migration-safe-compose-preflight.md`。

Phase 11 首次自然提问验收仍为失败：两个人名查询都被错误地传给 `identity_resolve(reference=self)`；历史查询又误用 `memory_search`（当前 embedding/provider/index 路径失败），最后用 `ls` 无效兜底。受控的本地 `sessions_search` + `sessions_history` 零错误地取回相关历史；另一次严格指定参数的测试确认一个别名可由 Identity 全局预设解析，另一个不在身份库中但在历史会话中可检索。故数据在，坏的是普通自然提问的工具/参数路由。源代码 Skill 已改为按问题类型调用 `identity_resolve(reference=alias)`、session search 或 durable-memory search，但还未装入候选镜像；`KURISU_ACCEPTANCE` 仍未通过，需更新安全候选后用原始自然提问复测。memory file vector index 仍为空/不匹配（`fts-only` 对 `text-embedding-3-small`）；未重建，避免把私有文本发送给外部 embedding provider。复测自然提问通过前不推进 Phase 12。完整脱敏证据见 `.agent/checkpoints/2026-09-23-kurisu-recall-audit.md`。

2026-09-23 Phase 9 restore passed on M204. Two restore bugs were fixed and pushed (`65164d9`, `80ef2ee`): source ownership is captured before copy and metadata paths are mapped onto the destination tree. The root-only owner-preservation fixture passed in the Ubuntu guest. Six absent secret targets were restored; the existing 9Router env and active Changedetection datastore were preserved without overwrite. The exact cold snapshot and encrypted secret bundle were verified before apply; restore retained a protected rollback checkpoint and reported `OPENCLAW_STATE_RESTORE=verified`. The earlier failed attempt's `failed-new` recovery copy remains intact. No OpenClaw runtime or owner ingress was started. Full sanitized evidence is in `.agent/checkpoints/2026-09-23-openclaw-destination-restore.md`.

Phase 1 已完成源码与聚焦验证：仓库 workspace 文件已改名为 `workspace-seed/*.seed.md`，`openclaw_prepare.py` 仅向缺失路径写入 seed，并保留已有运行态文件、权限、符号链接、目录及 `memory/**`；新增默认只读 plan 的单文件同步工具。证据见 `.agent/checkpoints/2026-09-23-openclaw-workspace-seed-only.md`。

Phase 2 已完成 state root/secret boundary 定义和旧源只读发现：`config`、`workspace`、`data`、`notifications` 全量进入 cold-state；`openclaw.env`、`secrets/**`、`config/credentials/**` 独立进加密 secret bundle。发现 WhatsApp credentials 原有 exporter 漏项，已补导出、导入、目标恢复、opaque path metadata 和批准替换前保留 rollback copy；apply 需要精确 Avalon token。源仍 active，因此活态计数/SQLite 检查不是 freeze acceptance。脱敏证据见 `.agent/checkpoints/2026-09-23-openclaw-state-inventory.md`。

Phase 3 工具实现与临时 fixture 验证已完成：冷快照使用加密流、HMAC-authenticated manifest、SQLite/session/workspace 校验；独立 verifier 在认证后解密检查，restore 要求 Avalon token 和四个 state-root 替换批准，并先保留目标 rollback copy。凭据 continuity 改为逐项绑定 opaque path、内容、mode 和 `1000:1000` runtime owner；恢复后逐项复验。相同文件数/总字节但内容或路径变化的负向 fixture 均被拒绝。Phase 4 的 source/destination evidence 输出已接线；实际 source evidence 只能在获批 freeze 后采集，destination evidence 只能在获批 restore 后采集。证据见 `.agent/checkpoints/2026-09-23-openclaw-cold-snapshot-hardening.md`。

1.4.8 仓库侧 hardening、完整 `pnpm test/build/typecheck`、secrets scan、版本校验、语法和 `git diff --check` 均通过。新增 legacy secret-bundle rewrap 工具：保留原件，在旁路生成当前策略/HMAC 清单，并真实执行导入、解密、logical-ID/文件元数据及目标 restore dry-run；readiness 现已调用该真实验证。当前重包通过，原始采集时间仍为 unknown；原件未修改。clean `7c93b7e` readiness 为 0 failure/0 warning，doctor 也为 0/0；rollback plan ready。9Router 未认证 `/v1/models` 的 401 是预期鉴权，不阻塞。Phase 6 pre-freeze audit（历史截面）：当时 source-freeze token 尚未提供，源端仍 active；证据见 `.agent/checkpoints/2026-09-23-openclaw-prefreeze-gate-audit.md`。

2026-09-23 Phase 7 完成（Amadeus CasaOS runtime）：源 CasaOS OpenClaw/Gateway 容器与 owner ingress 关闭；Product Radar、9Router、Changedetection、所有 Avalon 直接/间接消费者和 RW Docker socket 控制器已停止；Mac host 与 ubuntu guest 均已 sync。事后复核发现 macOS 上另有独立 `ai.openclaw.gateway` LaunchAgent 运行于 loopback，仅配置 iMessage，使用 host-local `~/.openclaw` 状态；其是否属于生产 authority 尚未判定，未停止。目的端生产 authority 未启动、公网入口未改；在目的端启动 OpenClaw 前必须重验唯一 runtime gate。

最终 Secret bundle：`/Volumes/Avalon/backups/operation-skuld/secrets-20260923T112416Z`，认证、import 和 restore dry-run 均通过。最终 OpenClaw 冷快照：`/Volumes/Avalon/backups/operation-skuld/openclaw-cold/openclaw-cold-20260923T112531Z.tar.gz.enc`，独立 verifier 通过，SHA-256 `367ffc43f53ec9dfda96b1f14caacf944c7994b1f356aa8e5f4f93d12f3d6e36`；155 个 workspace 文件、4,888 个 state 文件、84 个 session/JSONL 文件、6 个 transcript，必需 SQLite 均 `ok`。完整记录见 `.agent/checkpoints/2026-09-23-openclaw-source-frozen.md`。

最终 HomeLab 备份：`/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-source-freeze-20260923T111228Z`；16/16 MIGRATE 服务、38 artifacts、22/22 checksums 通过。Avalon 已由 M204 host/guest 识别并通过 Phase 8 preflight；目标 OpenClaw/Product Radar 尚未启动，`DESTINATION_AUTHORITY=NO`。Phase 9 状态恢复待执行。

## 2026-09-23：M204 非 Avalon 服务分阶段恢复（进行中）

用户已授权先恢复不依赖 Avalon 的服务，并确认其他服务沿用固定挂载名 `/Volumes/Avalon`。它们仍只是 M204 loopback 暂存；source OpenClaw 已冻结，生产 authority 与公网入口尚未切换。

最新 16 服务备份位于 `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-source-freeze-20260923T111228Z`，manifest 16/16 `passed`、22/22 checksums 通过；包含 Xiaoya 精确镜像 ID、bind/Alist 数据、Immich `pg_dump -Fc` 和 Filebrowser `/database`、`/config` 两个匿名卷。冷快照和密钥 bundle 另见本节 Phase 7 完成记录。

M204 canonical `nyannyan` guest 的 OrbStack restart 已完成，当前 `running`。Phase 8 host/guest preflight 已通过：guest VirtioFS 可读写，哨兵、Immich data root、最终冷快照/secret bundle 哈希和 HomeLab manifest 均通过；guest Avalon 容量约 985G 可用（13%，低于 20% warning 阈值）。六个 loopback staging 容器均已恢复，mount inspection 确认无 Avalon bind。Phase 9 OpenClaw cold-state restore 已通过，但 Avalon consumer、OpenClaw、Product Radar 均未启动。host-local `ai.openclaw.gateway` LaunchAgent 仍 active，须在目的端 OpenClaw 启动前完成 authority 分类并重验唯一 runtime gate；Phase 9 evidence 见 `.agent/checkpoints/2026-09-23-openclaw-destination-restore.md`。

Filebrowser、Xiaoya 的 Compose 模板已提交到 `4bdc605` 并部署到目标，默认 loopback-only。Filebrowser healthy，`127.0.0.1:10180` HTTP 200；它可写挂载整个 `/DATA`，不得提前开放。Xiaoya 主 UI 与 public-settings API HTTP 200；`data.db` 的 169 条 Alist storage 记录和 `strm_internal.db` 均通过 SQLite integrity check，未发现字面 `/Volumes/Avalon` 路径；具体远端 storage 可用性仍需按实际挂盘/网络分别验收。目测的 `2345/` 根路径返回 HTTP 500，不据此宣称该辅助端口可用。目标恢复的 Xiaoya 私有 AppData 已设为 root-only。

AriaNG 与 Dashdot Compose 模板已在 `32be0ec` 提交并部署。二者 UI 分别在 `127.0.0.1:6880`、`127.0.0.1:3001` 返回 HTTP 200；Dashdot 对 guest `/` 的挂载为只读。镜像归档 SHA-256 已与源端核验，导入后 platform、created time、完整 Config 和所有 RootFS layer digests 一致。AriaNG 目前仅证明 UI 可访问；aria2 后端仍因下载目录依赖 Avalon 而未恢复。

直接绑定 Avalon 的 Immich、media-organizer-adapter、Emby、qBittorrent、aria2、Jellyfin、Alist 暂不启动：配置保持 `/Volumes/Avalon` 不变，但需目标端实际挂盘并通过 UUID/sentinel/storage preflight，避免 guest 内生成同名空目录。Homarr 与 xiaoyakeeper 因 RW Docker socket 暂缓；Homarr 另有尚未纳入受保护 secret bundle 的 `AUTH_SECRET`、`SECRET_ENCRYPTION_KEY`。OpenClaw/Product Radar 受唯一 runtime/切换门禁限制；frpc/Nginx Proxy Manager 受 ingress 门禁限制；v2raya 的 host-network 副作用另行评估。最新运行态证据见 `.agent/checkpoints/2026-09-23-m204-service-restore-phase2.md`；阶段一和备份准备历史分别见 `.agent/checkpoints/2026-09-23-m204-service-restore-phase1.md`、`.agent/checkpoints/2026-09-23-m204-service-restore-stage1-prep.md`。

## 2026-09-22：Amadeus-M204 主机访问与终端代理准备（进行中）

用户已明确启动新 Mac 的迁移准备，并授权目标主机的受限 SSH 管理。

已完成：

1. **专用 SSH 身份**：控制端为 `nyannyan@Amadeus-M204` 生成独立 ED25519 迁移 key；私钥仅留在控制端 SSH 目录、未进入 Git。用户已在目标 `authorized_keys` 安装对应公钥，实际登录已通过。
2. **目标身份只读验收**：`Amadeus-M204` / `nyannyan`、arm64、macOS 27.0、Apple M6、24 GiB 内存已确认；根卷约 4% 已用、约 386 GiB 可用。
3. **终端代理**：目标机 `127.0.0.1:7897` 已验证同时支持 HTTP CONNECT 与 SOCKS5。已在 `/Users/nyannyan/.zshrc` 写入可逆的受管 block：交互式 zsh 默认使用 HTTP(S) proxy `http://127.0.0.1:7897` 与 `ALL_PROXY=socks5h://127.0.0.1:7897`，并保留 loopback、Bonjour、私网和 OrbStack-local bypass。`proxy_status`、`proxy_off`、`proxy_on` 可查询或切换；实际 HTTPS proxy smoke 返回 HTTP 200。
4. **OrbStack 访问与 canonical guest 验收**：非交互 SSH 的默认 `PATH` 未含 `/usr/local/bin`，此前 `command -v orb` 的 missing 结论已被更正。目标实际存在 `/usr/local/bin/orb`；当前 `orb list` 只显示运行中的 `nyannyan` guest（Ubuntu noble/arm64）。`orb -m nyannyan` 普通 user probe（UID 501、用户/hostname 均为 `nyannyan`）和 `orb -m nyannyan -u root` root probe（UID 0）均通过；`/home/nyannyan` 存在，来宾系统为 Ubuntu 24.04.5 LTS。该 guest 已符合 clean destination identity contract。
5. **目标 destination bootstrap**：目标 host 已完成 Homebrew、Node `v24.21.0`、pnpm `11.19.0`、Python `3.11.16`、tmux 和 cloudflared 安装；clean monorepo 已完成 `pnpm install --frozen-lockfile`，非敏感 host profile 已设为 `ORBSTACK_MACHINE=nyannyan` / `MAC_CONTROL_USER=nyannyan` / `EXTERNAL_STORAGE_ROOT=/Volumes/Avalon`，`./scripts/bootstrap.sh --check` 通过。canonical guest 已安装 Docker `29.8.1`、Compose `v5.5.1`、CasaOS `v0.4.15`，`/DATA/AppData`、`/var/lib/casaos/apps` 和 `amadeus_network` 已验证；CasaOS 核心服务与 gateway HTTP 200，只有 OrbStack LXC 环境下的静态 `polkit.service` 失败，未阻断 CasaOS 核心服务。未恢复 secret/data，未启动 OpenClaw/Product Radar。
6. **容量复核**：现有 source-side `plan-destination-capacity.sh` 重新测量仍返回 `DESTINATION_CAPACITY_JUDGMENT=FIT`（规划总需求 190.0 GiB、512 GB 目标盘剩余规划余量 290.0 GiB）。
7. **Git SSH clone 验收**：用户明确授权将目标专用 ED25519 key 作为 GitHub **账号级 Authentication key** 使用。用户最初使用标准 `git@github.com` URL 失败的原因是目标配置只含 alias，且随后发现 `~/.ssh/config` 被外部流程缩为 2-byte 空配置。现已备份该文件并将标准 `github.com` host 配置为专用目标 key，同时在 repo local config 固定 `core.sshCommand`。`git ls-remote` 和 `git pull --ff-only` 均成功；clean monorepo 位于 `/Users/nyannyan/agent-monorepo`，origin 为 `git@github.com:ChristmasFox/amadeus-home.git`，当前 `main` clean at `e9c648d`。没有复制控制端已有 Git key 或 token。

边界：本阶段只有用户安装的 SSH 公钥、受管 zsh 终端代理 block、目标本地 GitHub key/standard SSH config，以及 clean monorepo clone 写入了目标 Mac；本轮 OrbStack 检查全为只读。没有恢复 secret/data、启动第二套运行时、移动 Avalon，或执行 cutover。旧 Mac/CasaOS 仍是唯一权威运行时。

下一步：等待当前 `orbctl restart nyannyan` 返回并确认 guest 恢复；随后只读验证 guest 能访问真实 Avalon、sentinel 和 Immich media root，再完成 guest 可读/写与容量检查。若 VirtioFS 仍挂起，继续保持 `CUTOVER=BLOCKED`，不强制停止 OrbStack、不启动 Avalon 服务、不恢复 secrets/state、不切换入口。后续需在目的端 OpenClaw 启动前重新核验 host-local iMessage Gateway 的唯一 runtime 归属。

## 2026-09-22：Amadeus 1.4.7 Operation Skuld Final Migration Blocker Fixes（已完成）

本轮以 Operation Skuld 最终迁移 blocker 修复为唯一范围。

已完成：
1. **Full HomeLab backup**: 实现 `scripts/full-homelab-backup.sh`，为所有 16 个 MIGRATE 分类服务生成具体 artifact 与 checksums。Avalon 媒体/下载数据维持 `external-reference-only` 策略，不做打包。
2. **Secret coverage**: 扩展加密 Skuld secret bundle 覆盖范围至所有 live 凭据状态，不记录或暴露凭据明文。
3. **Real secret restore path**: 实现 `scripts/restore-skuld-secrets.sh`，将 bundle 中的逻辑 ID 映射到干净目标身份 (`/Users/nyannyan` / `/home/nyannyan`) 的具体路径。支持 `--dry-run` 默认模式、路径安全校验、权限强制以及 `--approve-replace` 覆盖控制。
4. **Service inventory observation vs contract**: 重构 `scripts/service-inventory.sh`，新增 `--observe`（仅写入临时/外部路径）与 `--compare` 模式。禁止覆写 tracked contract 文件。未在 contract 中的运行服务报告 `MANUAL_BLOCKER`；缺失的 live 运行服务报告 `WARNING`。
5. **Verified state-machine gates**: 在 `scripts/skuld-state-machine.sh` 中实现 `GATE_VERIFIERS` 逻辑，在推进 Phase (0-10) 前执行具体的 Python 验证器。Phase 11+ 保持严格锁定。
6. **Protected Docker image set**: 强化 `scripts/pre-migration-gc.sh`，根据运行容器、9Router 镜像、最近 Release 镜像、Rollback 标签及 checkpoint 证据引用构建真实的受保护镜像集。
7. **Destination capacity model**: 修正 `scripts/plan-destination-capacity.sh` 计算模型为 `guest_required = max(configured_floor, measured_requirement + 20% margin + 10G)`。避免重复计算 Docker/AppData，且 Avalon 外置盘不计入 SSD。
8. **Migration tests in release gate**: 在 `package.json` 中将 `test:migration-blockers` 接入 `pnpm test` 主流程。
9. **Release/evidence reproducibility**: 确认 Git 提交可追溯性 (`901a9ca` on clean `main`)。
10. **Final migration artifact proof**: 实现 `scripts/generate-skuld-artifact-report.sh`，生成包含所有 MIGRATE 服务验证状态的脱敏 Markdown/JSON 报告。
11. **Documentation path consistency**: 修复 `docs/OPERATION_SKULD_SERVICE_INVENTORY.md` 中 `/home/nyannyan` 标注为 macOS 的文档不一致。
12. **Clean destination strategy**: 保持干净目标身份 (Amadeus-M204 / nyannyan)，未修改 live 目标机器，未执行 cutover。

`VERSION=1.4.7` 已 commit 并 push 到 `main` (`901a9ca`)。
Doctor 0/0，`migration-readiness.sh` 0 failures / 0 warnings，`OPERATION_SKULD=READY`。
