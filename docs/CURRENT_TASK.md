# 当前任务

## 2026-09-23：M204 非 Avalon 服务恢复准备（进行中）

用户已授权先恢复不依赖 Avalon 的服务，并确认其余服务可按固定挂载名 `/Volumes/Avalon` 准备；不改 Avalon 路径名。源端仍是唯一权威运行时。

已完成：源端 16 个 MIGRATE 服务的 Full HomeLab 备份已写入 `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T025614Z`，checksums 全部通过；修复了备份脚本对缺失目录静默成功、9Router 错选回滚镜像、Xiaoya bind/named volume 漏备份的问题。修复后定向测试通过。新鲜加密 secret bundle 的导入 rehearsal 和目标路径 dry-run 通过；不含 secret 明文。

一致性证据：3 份 service-aware SQLite snapshot 的 SHA-256 与 manifest 匹配且 `integrity_check=ok`；Immich PostgreSQL dump 的 `pg_restore --list` 通过；9Router 实际镜像标签为 `local/9router:0.5.81`，备份数据中 `data.sqlite` 与 WAL 已在临时副本上通过 SQLite integrity check。普通 AppData tar 仅作应急配置归档，不能替代 service-aware 数据快照；它曾报告 9Router sqlite 文件读取期间变化。

依赖分类基于源端运行容器真实 mount：直接绑定 Avalon 的是 Immich、media-organizer-adapter、Emby、qBittorrent、aria2、Jellyfin、Alist；可先按稳定路径准备配置，但盘挂载并通过身份/sentinel 检查前不启动这些消费者。OpenClaw 与 Product Radar 没有直接 Avalon bind，但必须等单一运行时/切换门禁，避免双跑和重复通知。frpc/Nginx Proxy Manager 等入口类服务需等入口切换检查，不提前开放流量。

目标 M204 主机 SSH 可达，但 OrbStack guest 当前未运行/CLI 无响应；`/Volumes/Avalon` 也尚未挂载。因此目标尚未恢复任何业务容器、数据或 secret。下一步需要在 M204 的 OrbStack UI 启动 canonical `nyannyan` guest；恢复 guest 后先恢复可独立、无入口副作用的服务并逐项验收，再处理需 Avalon 的服务。详细证据与阻塞见 `.agent/checkpoints/2026-09-23-m204-independent-service-backup.md` 和 `.agent/tasks/2026-09-23-m204-service-restore.md`。

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
