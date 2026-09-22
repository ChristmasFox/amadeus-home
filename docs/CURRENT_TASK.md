# 当前任务

## 2026-09-22：Amadeus-M204 主机访问与终端代理准备（进行中）

用户已明确启动新 Mac 的迁移准备，并授权目标主机的受限 SSH 管理。

已完成：

1. **专用 SSH 身份**：控制端为 `nyannyan@Amadeus-M204` 生成独立 ED25519 迁移 key；私钥仅留在控制端 SSH 目录、未进入 Git。用户已在目标 `authorized_keys` 安装对应公钥，实际登录已通过。
2. **目标身份只读验收**：`Amadeus-M204` / `nyannyan`、arm64、macOS 27.0、Apple M6、24 GiB 内存已确认；根卷约 4% 已用、约 386 GiB 可用。
3. **终端代理**：目标机 `127.0.0.1:7897` 已验证同时支持 HTTP CONNECT 与 SOCKS5。已在 `/Users/nyannyan/.zshrc` 写入可逆的受管 block：交互式 zsh 默认使用 HTTP(S) proxy `http://127.0.0.1:7897` 与 `ALL_PROXY=socks5h://127.0.0.1:7897`，并保留 loopback、Bonjour、私网和 OrbStack-local bypass。`proxy_status`、`proxy_off`、`proxy_on` 可查询或切换；实际 HTTPS proxy smoke 返回 HTTP 200。
4. **目标 bootstrap 基线**：Homebrew、OrbStack/Docker、Node、pnpm 和仓库均尚未安装/克隆；Python 为系统 3.9.6；`/Volumes/Avalon` 尚未挂载。Git 已存在。
5. **容量复核**：现有 source-side `plan-destination-capacity.sh` 重新测量仍返回 `DESTINATION_CAPACITY_JUDGMENT=FIT`（规划总需求 190.0 GiB、512 GB 目标盘剩余规划余量 290.0 GiB）。

边界：本阶段只有用户安装的 SSH 公钥和受管 zsh 终端代理 block 写入了目标 Mac；没有安装 Homebrew/OrbStack、创建 Linux guest、复制仓库、恢复 secret/data、启动第二套运行时、移动 Avalon，或执行 cutover。旧 Mac/CasaOS 仍是唯一权威运行时。

下一步：在用户可进行本机管理员授权的窗口，先完成 Homebrew → OrbStack → Node 24/pnpm/Python 3.11+ → clone clean monorepo 的 host bootstrap；此后才可创建干净的 `nyannyan` Ubuntu 24.04 guest。详见 `.agent/tasks/2026-09-22-amadeus-m204-host-bootstrap.md`。

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
