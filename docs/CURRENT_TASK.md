# 当前任务

## 2026-09-23：M204 非 Avalon 服务分阶段恢复（进行中）

用户已授权先恢复不依赖 Avalon 的服务，并确认其他服务沿用固定挂载名 `/Volumes/Avalon`；源端仍是唯一权威运行时，不切换公网入口。

最新 16 服务备份位于 `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z`，manifest 16/16 `passed`、checksums 全部通过；包含 Xiaoya 精确镜像 ID、bind/Alist 数据和 Filebrowser `/database`、`/config` 两个匿名卷。较早的 `20260923T044715Z` 备份尝试漏归档 Filebrowser `/config`，不要作为恢复源。回归测试现覆盖子进程消耗 stdin 时仍完整归档两个卷。3 份 service-aware SQLite snapshot、Immich `pg_dump -Fc` 和 secret bundle rehearsal 证据见既有外部 checkpoint。

M204 canonical `nyannyan` guest 已在系统自动更新后恢复运行；CasaOS/Docker 可用，Avalon 目前仍未挂载。目标现有 Changedetection、9Router、Filebrowser、Xiaoya、AriaNG、Dashdot 六项服务，均处于 loopback-only/无宿主端口的暂存状态。Changedetection healthy、无宿主端口；它与源端并行轮询仅作迁移暂存，源端仍是唯一权威身份。9Router 仅绑定 `127.0.0.1:20128`，源端与目标对无凭据 `/v1/models` 都返回 401，与预期一致。

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

下一步：目标 bootstrap 已基本完成，当前只剩连接新 Mac 上的 Avalon 外置盘。挂载后先只读运行 `diskutil info /Volumes/Avalon`，用真实 UUID 更新 host profile 并运行 storage identity/capacity preflight；在该 preflight 和后续独立批准前，不恢复 secret/data、不启动业务 runtime、不切换入口、不执行 cutover。详见 `.agent/tasks/2026-09-22-amadeus-m204-host-bootstrap.md`。

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
