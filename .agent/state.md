## 2026-09-25：1.5.3 连续群语音只生成一条 PTT（入站 FIFO 修复候选）

用户报告在群聊连续发两条语音，只有一条得到 PTT，另一条只有文字。12:18–12:19Z 脱敏日志可见两个
Ogg 音频入站、两个助手最终回合、仅一条媒体发送。固定 OpenClaw 2026.9.4 的 followup 队列将结果通过
直接 `routeReply` 投递，绕过正常 inbound final TTS 应用；该源码路径与“queued voice 只有文字”吻合。

修复候选已把排队边界移动到 WhatsApp `processForRoute`：同一 session 只在活动 voice lease 时用 FIFO 等待，
前一轮完整 settle 后，每个 queued voice 都重新经过正常 `processMessage`/`runChannelInboundEvent`/TTS 路径；
后续 text 也按顺序处理。每条 queued voice 在自己开始时获得独立的 3 秒 composing lease/120 秒上限。Presence
发送失败仅停止刷新、不提前释放队列；断连、turn settle 与硬超时仍会清理。typed-only concurrency 不变。

`pnpm test`、`pnpm typecheck`、architecture、secrets 与 pinned monitor 临时副本 patch/语法/幂等/stdin 检查通过。
修复源码还未 commit、push 或部署；正式 1.5.3 镜像仍运行。下一步 commit/push 后使用 `--candidate` build/apply
并带 corrected full npm subtree checkpoint，再请用户重复连续群语音，确认两条各自一条日文 PTT+中文 summary。
详见 `.agent/checkpoints/2026-09-25-amadeus-1.5.3-consecutive-voice-tts-regression.md`。

## 2026-09-24 — WhatsApp direct session identity fallback deployed

修复后 14:17:47 收到 marker、14:18:34 单次出站，但 adapter 未提供 sender metadata，identity
bind 三次失败。commit `805e6b4` 仅从 host 生成的 `agent:*:whatsapp:*:direct:<peer>` session key
恢复可信 WhatsApp peer，group/channel key 不接受；定向测试 22、typecheck、build、secrets、
diff check 通过。M204 已运行 `local/openclaw-amadeus:git-805e6b4-20260924064816`，healthy，
等待重启后重新发送 marker；当前仍未执行 `COMMIT_SKULD_CUTOVER_1_4_8`。

## 2026-09-23 — Amadeus 1.4.8 Operation Skuld final cutover (active)

- 2026-09-24 WhatsApp relink completed: M204 reports Telegram `ready/connected` and WhatsApp `linked/healthy/connected`. The detached relink worker and its child login processes were stopped after successful linking. A bounded recent log window now shows six direct WhatsApp inbound markers and six sent-message markers with no extra send marker, but this is multi-message activity rather than the required single controlled acceptance and does not prove reply content, owner identity, or tool policy. Telegram still has no inbound/outbound activity timestamps; do not claim owner acceptance or final cutover. Evidence: `.agent/checkpoints/2026-09-24-whatsapp-activity-awaiting-telegram.md`.

- 2026-09-24 Phase 12/13: the old Mac `ai.openclaw.gateway` LaunchAgent was disabled and booted out; its plist remains intact for rollback-only and loopback `18789` is closed. The unique-runtime probe now passes with source process count 0, one M204 candidate, and active runtime count 1. M204 is running canonical Compose (healthy, `unless-stopped`, LAN `18789`) with persisted `sessions.visibility=self`, per-account/channel/peer DM scope, per-group scope, and Telegram/WhatsApp enabled. Telegram is `ready/connected`; WhatsApp is `not-linked` after server-side logout, and a detached M204-host `screen` session named `amadeus-whatsapp-relink` is waiting for QR scan and retries after expiry. Do not execute final source retirement or claim Telegram/WhatsApp acceptance until WhatsApp is linked and both channels pass real inbound/outbound duplicate checks.

- 2026-09-24 fresh Phase 12 check: exact `APPROVE_OWNER_INGRESS_SWITCH_1_4_8` received, but no ingress mutation was performed. M204 has one healthy migration-safe candidate; the old Mac `ai.openclaw.gateway` LaunchAgent/process remains active on loopback `18789` with only iMessage configured. The unique-runtime probe reports `OPENCLAW_ACTIVE_RUNTIME_COUNT=2` and `UNIQUE_RUNTIME_GATE=BLOCKED`. The effective M204 config is the read-only `/run/openclaw-migration/openclaw.json` overlay with loopback binding, both owner channels disabled, `sessions.visibility=self`, and owner delivery disabled. Require operator classification/handling of the old Mac Gateway and a fresh gate before owner ingress; do not treat the approval as the final cutover token.

- The authoritative objective is `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`. Phase 7 source freeze, Phase 8 Avalon destination preflight, and Phase 9 OpenClaw cold-state restore are complete. Six non-Avalon staging containers are running without Avalon binds; Avalon consumers remain off.
- Current acceptance: source CasaOS OpenClaw stopped, Amadeus owner ingress off, and exactly one healthy M204 migration-safe candidate running with no published ports; `DESTINATION_AUTHORITY=NO`. Cold restore preserved the authenticated state and credentials, but the old reported 84 session/JSONL and 6 transcript counts were produced by path-substring matching and are invalid. The actual agent SQLite store currently reports 52 sessions, 5,684 transcript events, 5,506 active events, 1 archive row, and 2,827 search chunks; one deleted compressed session archive is present. All required SQLite integrity checks pass and credentials have numeric owner `1000:1000`. See `.agent/checkpoints/2026-09-23-openclaw-destination-restore.md` and `.agent/checkpoints/2026-09-23-kurisu-recall-audit.md`.
- Fresh read-only audit on `xu-mac` confirms host-local `ai.openclaw.gateway` is an active, separate LaunchAgent: `RunAtLoad=true`, `KeepAlive=true`, `gateway.bind=loopback`, port 18789, and only the iMessage channel/plugin enabled. Its listener is loopback-only. Existing log metadata has 18 lines matching coarse inbound keywords across the retained log; message content was not read, so this does not establish production ownership. Do not count the Phase 12 old-Mac production runtime gate as passed until the operator classifies this gateway; no stop/disable action was taken.
- Phase 11 operator acceptance remains failed pending a natural-prompt retest on the corrected candidate. The initial no-channel/no-delivery run passed aliases to `identity_resolve` with `reference=self`, so both were semantically misrouted; it also called `memory_search` (failed on the configured embedding/provider/index path) and then `ls` (missing path). A bounded local `sessions_search` + `sessions_history` test retrieved historical context with zero tool failures. A separate exact-parameter identity probe resolved alias A via `global-alias` and correctly returned `not_found` for alias B; the latter's historical context is available through session search. The source Skill/tool-description fix now routes past-conversation questions to those session tools; it is not yet deployed to the candidate. Memory-file vector search remains mismatched (`fts-only` vs `text-embedding-3-small`); no reindex was run because it may send private text to an external embedding provider. Do not proceed to Phase 12 until the rebuilt safe candidate passes the unprompted operator probe. See `.agent/checkpoints/2026-09-23-kurisu-recall-audit.md`.
- Historical diagnostic notes follow; they record failed initial attempts and are superseded by the current completed checkpoints above.
- (Historical phase snapshot; final source freeze and destination restore are now recorded above.) Four cold snapshot attempts were rejected and their partial outputs cleaned. Tar-header owner reconciliation passes its fixture; fingerprints isolated 15 `config` mode differences after macOS extraction, while `data` and `notifications` matched. Verification now reconstructs owner/mode from authenticated tar headers and checks against source fingerprints. No source data changed.
- Phase 1 is implemented and focused checks pass. Git-managed workspace context is seed-only, deployment seeds absent files only, and explicit sync is plan-only/default with exactly one approved file per apply. Existing runtime workspace state and metadata are preserved.
- Sanitized evidence: `.agent/checkpoints/2026-09-23-openclaw-workspace-seed-only.md`. No runtime, external storage, secrets, or service state changed.
- `VERSION=1.4.8` release validation passed and commit `3d9985c` is pushed; local `main` matches `origin/main`, clean. Full `pnpm build/typecheck/test`, doctor/readiness, architecture, version, syntax, diff, and secrets checks passed.
- Phase 2 state-root discovery is recorded in `.agent/checkpoints/2026-09-23-openclaw-state-inventory.md`. `config/credentials/**` contains 856 WhatsApp runtime credential files and was absent from the old secret-export path; export/import/restore now cover it using opaque path hashes, token-gated apply, and preserved replacement checkpoints. Read-only source counts and DB checks were taken while OpenClaw was live and are not final acceptance evidence.
- Phase 3 cold snapshot/verify/restore tooling is implemented and fixture-tested. Credential bundle matching now rejects same-count/same-byte content or path changes, binds opaque paths/content/mode/owner into an authenticated continuity HMAC, and verifies restored credentials. Target restore normalizes to the source/image runtime owner `1000:1000`.
- Phase 4 evidence emitters are wired; live source evidence remains behind exact source-freeze approval, and destination comparison remains behind approved restore. Phase checkpoint: `.agent/checkpoints/2026-09-23-openclaw-cold-snapshot-hardening.md`.
- (Historical pre-freeze audit; superseded by the source-freeze and Phase 9 checkpoints above.) Targeted continuity, migration-safe, runtime-gate, workspace, secret restore, architecture, consistency, syntax, diff, and secrets checks passed. The Phase 6 audit found the legacy bundle policy issue; it was resolved through an authenticated rewrap, followed by final post-freeze bundle verification. See `.agent/checkpoints/2026-09-23-openclaw-prefreeze-gate-audit.md` for the original audit snapshot.

## 2026-09-23 — M204 service restore phase 2 (current)

- User authorized restoring services independent of Avalon and confirmed `/Volumes/Avalon` remains the stable mount name. The old source CasaOS remains authoritative; no cutover or public ingress change has occurred.
- M204 OrbStack `nyannyan` guest is running after the OS auto-update. `/Volumes/Avalon` is not mounted there.
- Latest full backup is `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z`: 16/16 MIGRATE services and all checksums pass. It contains Xiaoya image/data plus Filebrowser `/database` and `/config` volumes; do not use the incomplete `044715Z` attempt.
- Six services are running in local-only staging: Changedetection (healthy, no host port), 9Router (`127.0.0.1:20128`, unauthenticated `/v1/models` returns 401 on source and target), Filebrowser (healthy, `127.0.0.1:10180`), Xiaoya (`127.0.0.1:5678` UI/public-settings 200), AriaNG (`127.0.0.1:6880` HTTP 200), and Dashdot (`127.0.0.1:3001` HTTP 200; guest-root bind is read-only). All six are running with restart count 0; Changedetection still polls alongside its source instance. AriaNG has no restored aria2 backend yet.
- Filebrowser retains writable `/DATA`, so keep it loopback-only. Xiaoya's `data.db` and `strm_internal.db` pass SQLite integrity; its 169 Alist storage rows contain no direct `/Volumes/Avalon` reference. Xiaoya's private AppData is `700 root:root`.
- Source commit `32be0ec` is pushed and M204 clone fast-forwarded cleanly. Docker 28.2.2→29.8.1 normalizes imported image IDs, but all transferred images' platform, creation time, complete Config and every RootFS layer match source.
- Homarr and xiaoyakeeper remain deferred because each requests RW Docker socket; Homarr's `AUTH_SECRET` and `SECRET_ENCRYPTION_KEY` also lack protected bundle coverage. Do not restore either socket grant by default.
- Direct Avalon consumers wait for actual disk UUID/sentinel/storage preflight. OpenClaw/Product Radar, frpc/Nginx Proxy Manager, and v2raya remain behind single-runtime, ingress, and host-network gates respectively. See `.agent/checkpoints/2026-09-23-m204-service-restore-phase2.md` and phase 1 evidence.

## 2026-09-22 — Amadeus-M204 SSH access and terminal proxy baseline (in progress)

- User explicitly authorized target-host migration preparation. Dedicated ED25519 key is local-only; user-installed public key authentication and `ssh amadeus-m204` were verified.
- Read-only target facts: `Amadeus-M204` / `nyannyan`, macOS 27.0, arm64 Apple M6, 24 GiB RAM, root volume about 4% used with about 386 GiB available.
- `127.0.0.1:7897` is reachable and verified for both HTTP CONNECT and SOCKS5. `/Users/nyannyan/.zshrc` now contains the reversible managed terminal proxy block; `zsh -ic` HTTPS proxy smoke returned HTTP 200.
- OrbStack correction and guest acceptance: noninteractive SSH omits `/usr/local/bin` from `PATH`, but `/usr/local/bin/orb` exists. Current `orb list` contains only a running canonical `nyannyan` noble/arm64 guest. Normal-user UID 501/user/hostname `nyannyan`, `/home/nyannyan`, Ubuntu 24.04.5, and `-u root` UID 0 all pass read-only validation.
- Git SSH clone acceptance: user authorized the target-only ED25519 identity as a GitHub account Authentication key. The standard `github.com` host now uses that identity, and the repo also has a local `core.sshCommand` pin; `git ls-remote` plus `git pull --ff-only` pass. A clean clone exists at `/Users/nyannyan/agent-monorepo` with standard GitHub origin. No control-side key copy or token transfer occurred.
- Destination bootstrap progress: host Homebrew/Node 24.21.0/pnpm 11.19.0/Python 3.11.16/tmux/cloudflared installed; clean monorepo frozen-lockfile install and non-secret host profile complete; bootstrap check passed. Guest Docker 29.8.1/Compose 5.5.1, CasaOS 0.4.15, `/DATA/AppData`, `/var/lib/casaos/apps`, and `amadeus_network` are ready; CasaOS core services and gateway HTTP 200 pass. OrbStack LXC `polkit.service` remains a non-blocking failed static unit.
- Remaining destination gate: `/Volumes/Avalon` is not attached. Source `migration-readiness.sh` remains 0 failure / 0 warning with `OPERATION_SKULD=READY`; no secret/data restore, business runtime startup, Avalon movement, source freeze, or cutover has occurred.
- Historical `DESTINATION_MUTATED=NO` release statements remain accurate at their timestamp. Current target writes are user-authorized SSH authorization, terminal proxy, GitHub account-key/standard SSH configuration, clean-monorepo clone, host toolchain/profile, pnpm install, guest Docker/CasaOS bootstrap, and amadeus_network only; no business data/runtime has been restored.


## 2026-09-22 — Amadeus 1.4.6 Cutover Readiness deployed

- Released VERSION=1.4.6; commit `5baad95`.
- Fixed Immich remote checksum equivalence bug (rsync zero-changes verification).
- Fixed storage growth telemetry bug (MACHINE variable not expanding in heredoc).
- Added 7 preparation tooling scripts (bootstrap planner, clean guest planner, HomeLab restore plan, state machine, rollback plan, pre-migration GC, capacity planner).
- Added 2 new test scripts (preparation tooling + checksum equivalence).
- Updated migration manifest (schemaVersion 3) and runbook with Amadeus-M204/nyannyan destination identity.
- Fixed xiaoya path: /home/blacksidev/xiaoya → /DATA/AppData/xiaoya.
- Live CasaOS deploy: OpenClaw image git-5baad9571dfc-20260922120543; doctor 0/0; migration-readiness 28/28 PASS.
- OPERATION_SKULD=READY; DESTINATION_HOST_IDENTITY=Amadeus-M204; SOURCE_FROZEN=NO; DESTINATION_MUTATED=NO.
- Deployment evidence: docs/reports/AMADEUS_1_4_6_DEPLOYMENT.md.


## 2026-09-21 — Amadeus 1.4.5 Phase 0 audit

- Goal: `docs/AMADEUS_1_4_5_OPERATION_SKULD_FINAL_HARDENING_GOAL.md` plus the development-efficiency addendum.
- Main is clean at `0f9521c`; canonical CasaOS host is OrbStack `ubuntu`.
- Live baseline: OpenClaw/Product Radar image tag `git-16a8c15d727f-20260921082428`; Immich media mount is `/Volumes/Avalon/immich/data`; legacy `/DATA/Gallery/immich` remains retained.
- Audit findings confirmed: three secret migration scripts are ignored, storage state can be falsely healthy, scheduled maintenance is read-only, retention is not enforced, backup is raw-tar-centric, inventory/runbook classification is incomplete, and reclaim uses historical rather than fresh equivalence.
- Current external storage is near threshold (about 11% free); future evidence must report the real warning state. No live mutation was performed in Phase 0.
- Execution state is persisted in `.agent/EXECUTION_PLAN.md`, `.agent/run-state.example.json`, and external evidence under `SKULD_BACKUP_ROOT`.
# Agent State

更新时间：2026-09-24（Asia/Shanghai）

2026-09-24 frpc/public restore：已从 source-freeze 外置归档恢复官方 frp 0.69.0，systemd
服务 active，配置校验通过。删除了 9router 与 Homarr 的隧道映射，frpc 管理面和 Glances
回源固定 loopback；9router 仍仅作为 OpenClaw 本机依赖并绑定 `127.0.0.1:20128`。Avalon
UUID、哨兵和 guest 外置设备检查通过后，Emby、Jellyfin、qBittorrent、aria2、Glances 已恢复。
公网 Immich/Emby/Jellyfin/qBittorrent/aria/monitor 分别返回 200/302/302/200/200/200，Claw
返回预期 403；`9router.nyannyan.top` 无 DNS。证据见
`.agent/checkpoints/2026-09-24-frpc-public-restore.md`，回滚副本在外置备份目录。

2026-09-24 公网诊断：公网前端可达，但多个服务返回 502；M204 没有 frpc 进程/容器。旧 frpc
映射和受保护凭据仍在 `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-source-freeze-20260923T111228Z/frpc/frpc-config.tar.gz`，本轮未恢复公网入口。证据见
`.agent/checkpoints/2026-09-24-public-services-diagnosis.md`。

2026-09-24 M204 LAN binding fix：用户服务此前发布在 `127.0.0.1`，局域网无法访问；已将 Git
Compose 默认值和 live CasaOS 端口切换到 `0.0.0.0`，重建用户服务且未重建镜像。两个 M204 LAN
地址 `192.168.5.3`/`192.168.5.50` 的逐端口探测均建立连接；内部 DB/Redis/model 仍未发布。回滚
备份和证据：`.agent/checkpoints/2026-09-24-m204-lan-bindings.md`。

2026-09-24 scope revision and final commit：用户明确跳过 Telegram 验收，Telegram 保持运行且
声明式配置不变。WhatsApp 是唯一 owner-channel acceptance。`COMMIT_SKULD_CUTOVER_1_4_8` 已执行，
当前 `DESTINATION_AUTHORITY=Amadeus-M204`、`SOURCE_AUTHORITY=retired`、
`OPERATION_SKULD_CUTOVER=COMMITTED`；rollback checkpoint、旧源和 Immich source 保留 72 小时。
最终证据：`/Volumes/Avalon/backups/operation-skuld/final-cutover-20260924T074756Z`。

2026-09-24 WhatsApp direct identity acceptance 已通过：修复镜像重启后 15:19:17 收到精确
`SKULD-WHATSAPP-20260924`，15:19:44 仅出站一次；实时 SQLite/WAL 确认
`identity_bind_channel` 为 `bound`，无 `trusted_sender_metadata_unavailable`。当前
`WHATSAPP_ACCEPTANCE=passed`、`TELEGRAM_ACCEPTANCE=pending`、`DESTINATION_AUTHORITY=NO`，
未执行 `COMMIT_SKULD_CUTOVER_1_4_8`。证据见
`.agent/checkpoints/2026-09-24-whatsapp-direct-session-identity-fix.md`。

2026-09-24 WhatsApp identity bridge fix：修复前精确 marker 只产生一条回复，但
`identity_bind_channel` 返回 `trusted_sender_metadata_unavailable`，故未计入 acceptance。commit
`a62b2bd` 已通过定向 test/typecheck/build、secrets scan 和 diff check，并部署为 M204
`local/openclaw-amadeus:git-a62b2bd-20260924131000`；容器 healthy、Telegram/WhatsApp 重新连接，
受保护运行时 checkpoint 保留。`before_dispatch` 现在把当前入站 sender 以 5 分钟 TTL 桥接到
identity context，WhatsApp E164 fallback 仅限 WhatsApp。等待用户在当前 WhatsApp 私聊重新发送
`SKULD-WHATSAPP-20260924` 做修复后单轮验收；当前 `WHATSAPP_ACCEPTANCE=pending_post_fix_resend`、
`TELEGRAM_ACCEPTANCE=pending`、`DESTINATION_AUTHORITY=NO`，未执行
`COMMIT_SKULD_CUTOVER_1_4_8`。media-organizer-adapter 仍缺可重建 image/compose。

2026-09-24 workstation handoff pre-cutover evidence：当前执行环境已现场确认是
`Amadeus-M204`/`nyannyan`，repo `/Users/nyannyan/agent-monorepo` clean，`main` 与 `origin/main`
及 GitHub `ls-remote` 一致；Node 24.21.0、pnpm 11.19.0、Python 3.11.16、Git、tmux、cloudflared、
OrbStack `nyannyan`、Docker 29.8.1、Compose 5.5.1、CasaOS active 和 `bootstrap.sh --check` 均通过。
host profile 已加载 `ORBSTACK_MACHINE=nyannyan`、`MAC_CONTROL_USER=nyannyan`、
`EXTERNAL_STORAGE_ROOT=/Volumes/Avalon`。旧路径命中仅为 Xiaoya 源迁移映射、tests 和禁止性说明，
未发现 active destination workflow 依赖；owner acceptance 仍等待修复后 WhatsApp marker。

2026-09-24 M204 workstation/runtime progress：`Amadeus-M204` 的 canonical repo `/Users/nyannyan/agent-monorepo`
在 `main`/`origin/main` `3a41867` clean；GitHub SSH、Node 24.21.0、pnpm 11.19.0、Python 3.11.16、tmux、
cloudflared、OrbStack `nyannyan` guest、Docker/Compose/CasaOS 和 host profile 均已现场核验。Avalon UUID、
`diskutil verifyVolume`、guest sentinel/content 通过；Product Radar SQLite/image/health、Immich dump/四容器/
API/vector extension、FashionSigLIP MPS worker 已恢复。Owner-channel controlled acceptance 仍 pending；
最近 WhatsApp group 事件不计入验收，两个 SKULD marker 均未观察到。media-organizer-adapter 缺可重建 image/
compose，未臆造替代。`DESTINATION_AUTHORITY=NO`，未执行 `COMMIT_SKULD_CUTOVER_1_4_8`。

Amadeus 1.4.8 当前在 M204 `nyannyan` 运行 migration-safe OpenClaw 候选，镜像为
`local/openclaw-amadeus:git-238bb65-20260923171901`，容器 healthy、loopback-only、无 published
ports、Telegram/WhatsApp/公网入口关闭、owner delivery=false，`tools.sessions.visibility=self` 已生效。
Phase 11 自然语言身份路由和无范围反向验收已通过：`identity_resolve` 先于同会话 `sessions_search`，
不会从其他会话取回范围事实。用户指定的 direct-only/group-only 事实没有写入全局 `MEMORY.md`，
需真实渠道 metadata 才能定向验收。
当前仍未取得 `APPROVE_OWNER_INGRESS_SWITCH_1_4_8`，旧 Mac 的 host-local `ai.openclaw.gateway`
LaunchAgent 仍需 operator 分类；因此 destination authority 仍为 NO，不能开放 owner ingress 或宣称最终 cutover 完成。

更新时间：2026-09-21（Asia/Shanghai）

当前执行 docs/AMADEUS_1_4_4_OPERATION_SKULD_STORAGE_RUNTIME_HYGIENE_GOAL.md，已完成。外置 8TB
sentinel/UUID/device/free-space fail-closed 检查、Immich checksum copy-first migration、fresh DB
backup/cutover/旧源保留与独立 reclaim gate、9Router/Immich/changedetection secret/service coverage、
加密 bundle rehearsal、Docker log rotation、受保护 GC、storage health scheduler 与动态 readiness
均已完成；`VERSION=1.4.4` 已 commit/push 并 apply 到 canonical CasaOS。最终 live evidence 位于
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-1.4.4-live-20260921T111052Z`，doctor 0/0，
`OPERATION_SKULD=READY`，旧 Immich 源保留为 `SOURCE_RECLAIM_PENDING`。Docker daemon 默认日志策略
已收口为 `local/20m/5`，备份和重启后容器恢复证据已保留。本轮不执行 Mac mini cutover，
不回收旧源。

当前执行 docs/AMADEUS_1_4_2_WORLDLINE_UNIFICATION_AND_SKULD_READINESS_GOAL.md。Worldline
intent/policy/adapter/renderer、统一 owner outbox producer、host profile、可配置 network、
FashionSigLIP inventory、Operation Skuld manifest/runbook 和只读 readiness rehearsal 已进入源码；
`VERSION=1.4.2`、全量 test/typecheck/build、secret scan、architecture fitness、脚本语法和两套
生产镜像构建均已通过。implementation commit `af54e7d` 已 push；当前 CasaOS `ubuntu` apply、
live evidence、doctor 和 `OPERATION_SKULD=READY` 均通过，详见 deployment report。Operation Skuld
不执行 Mac mini cutover。真实自然语言 inbound/final-reply 仍按边界保持 pending，不发送未经请求的
群聊测试消息。

2026-09-20 服务更新已完成：Immich `v2.5.3` → `v3.2.2`，并从旧 pgvecto.rs 数据库迁移到
VectorChord；server、machine-learning、Postgres、Redis 均 healthy，公网 ping 通过。9router
已从 mutable `latest` 更新到 npm `0.5.81`，当前 live image 为 `local/9router:0.5.81`，dashboard
公网 200、未带 key 的 API 保持 401，容器重启次数为 0。
恢复点位于 `/DATA/AppData/immich/backups/pre-update-20260920T132238Z` 和
`/DATA/AppData/9router/backups/pre-update-20260920T132238Z`，npm 切换恢复点为
`/DATA/AppData/9router/backups/pre-npm-0.5.81-20260920T142239Z`；Claw/OpenClaw 未修改。

1.4.2 通知 follow-up：初次 deploy 的 owner smoke 只写入 checkpoint 的 `owner-smoke`，未写入生产
owner outbox，故没有触发 WhatsApp worker；用户要求后已用 `amadeus-release:1.4.2:manual-resend`
补发并确认 `.sent.json`。当前 deploy source 已修复为成功 health/preflight 后进入生产 outbox，并等待
真实 sent 状态；发送失败会让 deploy 明确失败，不再把 checkpoint-only smoke 视为已通知。

以下历史记录保留 1.4.1 及更早 release 的 live evidence，不覆盖当前目标状态。
历史记录：`docs/AMADEUS_1_4_1_PUBG_PRESENTATION_HARDENING_GOAL.md` 已完成源码、release、部署和
live evidence 阶段。Phase 1-7 的 Presentation contracts/renderers/time formatter、owner hard
validation、PUBG structured presentation、period review、architecture fitness check、版本 fixtures
和 workflow integration 均已验证；`VERSION=1.4.1` 的 implementation commit `032e314` 已 push。
CasaOS live OpenClaw 使用 `local/openclaw-amadeus:git-032e31477b45-20260920065322`，Product Radar
复用 `local/product-radar:git-7d85bc10f15d-20260920041059`，checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920065322`；health、preflight、外围 smoke
和 doctor（0 failure / 0 warning）均通过。真实自然语言 inbound/final-reply 仍按验收边界保持
pending，未发送未经请求的群聊测试消息。

本轮真实 WhatsApp trajectory 审计发现周期队友动作查询只走基础 Match API，新增
`pubg_query_team_damage` 作为 Domain-owned batch Telemetry contract，覆盖全队误伤详情和
007 → 004 KICK 计数；Domain 22/22、Plugin 9/9、全仓验证已通过。版本 `1.4.0` 的提交
`6ee03d0` 已 push 并完成 CasaOS apply；live image、tool/Skill preflight、health、外围 smoke
和 doctor 均通过。部署证据已提交并 push，当前只剩本次版本策略单独提交。

版本策略已按用户要求调整：当前 live release 保持 `1.4.0`，以后只使用 `bump patch` 按 `0.0.1`
递增；patch `0..9` 向 minor 进位，minor `0..99` 且 patch=9 时向 major 进位，示例为
`0.9.9 -> 0.10.0`、`0.99.9 -> 1.0.0`，不再使用 `bump minor`/`bump major`。

本次 1.3.0 live release：implementation commit `7d85bc1`；OpenClaw image
`local/openclaw-amadeus:git-7d85bc10f15d-20260920041059`；Product Radar image
`local/product-radar:git-7d85bc10f15d-20260920041059`；checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920041059`。health、plugin/Skill preflight、
owner worker/outbox、NAS read-only、media connectivity、legacy runtime retirement 和 doctor 均 PASS。
没有发送未经请求的真实群聊消息，真实自然语言 inbound/final-reply 仍明确标记为 pending。

当前 Goal：按 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md，将仍有价值的旧多领域能力迁移到
OpenClaw/Kurisu native Amadeus plugin 与独立服务，并退休 LangBot、n8n、旧 runtime、
旧通知 bridge 和旧 proactive producer。

当前子目标：完成 PUBG Telemetry 小时预取、缓存语义修正、D-mail 每日 owner 汇总，并继续
实现跨 Telegram/WhatsApp 的 canonical Person identity、昵称候选学习和
provider-neutral external account；Identity reply metadata bridge、provider-native channel metadata
和 Telegram trusted username patch 已完成新的 CasaOS apply，线上真实 sender binding/账号 linking
仍待真实用户入口验收；VPS 只读查询、真实 WhatsApp 早晚报告 smoke 和重启持久化已完成，仍待
用户从真实 WhatsApp 入站发送一条自然语言 VPS 查询。

当前状态：PUBG Telemetry 预取与 D-mail 基础能力已部署；PUBG 全部用户可见时间统一北京时间的 1.1.5 已完成 release build/apply，live Amadeus 已加载并通过 health、preflight、插件注册和 bundle 规则核验。本轮又定位并修复部署通知结尾重复，1.1.7 已完成 release apply，实际 owner smoke 已核实结尾语全文只出现一次。此前方向性结果与来源时间范围修复已完成 1.1.4 release build/apply，既有复盘新鲜度、relative_period 06:00 解析、缓存语义、周期复盘顺序和“所有 PUBG 路由事实必须走工具”修复已完成 release build/apply；PUBG 工具默认从持久化 SQLite 缓存/更新结果取事实，上下文只解析参数，不提供数据；周期复盘默认正序、最近一局保持倒序；部署通知已改为只读取单次发布摘要，不累计历史内容；全局上下文拆分、旧 secret fallback 清理、Codex hook 修复、内部服务 proxy bypass、
提交/push、CasaOS apply、外部 checkpoint、真实 WhatsApp owner smoke、自然语言工具选择和旧
app/data 退休均 PASS；本轮 Telegram trusted username patch 与 Identity preset 动态刷新已通过
选择性镜像构建重新 apply 到线上；PUBG plugin 现会同步刷新缓存的 IdentityStore。

VPS 公网入口 follow-up 已完成：Cloudflare 525 的根因是 Caddy 缺少已有 frps 映射的
`jellyfin`、`aria`、`qb`、`monitor` 和 `9router` site；现已补齐并取得证书，Immich、Jellyfin、
AriaNG、qBittorrent、Glances、9Router 的公网回源均通过。OpenClaw 配置未修改；Caddy 回滚副本
保留在 VPS `/etc/caddy/backups/Caddyfile.pre-public-services-20260919T161251Z`。

已落地：

- plugins/amadeus：Product Radar、Emby media safety flow、NAS、HomeLab、KOOK lookup、
  briefing、owner notifier/retry worker；
- Product Radar channel-free owner outbox 和 Codex channel-free hook；
- OpenClaw Amadeus config/template、workspace policy、固定 image Dockerfile；
- Product Radar compose 去除 LangBot/Telegram/KOOK notification keys；
- NAS source 移到 infra/macos/nas-control.sh；
- briefing config 保留旧日报的来源/主题/调度意图，但通知目标固定为 WhatsApp owner；
- scripts/deploy-openclaw.sh 和 scripts/openclaw_prepare.py 的一次性迁移/退休流程。
- 全局 workspace 只保留通用规则；PUBG 领域规则在 `plugins/pubg/skills/pubg/SKILL.md`；
  OpenClaw prepare 不再读取旧 LangBot DB，Codex hook 使用远端 owner outbox。
- owner 工具策略固定为 `tools.profile="full"`；live baseline 的 PUBG-only allowlist 根因已记录并
  在部署 preflight 中设为硬失败条件。PUBG/Amadeus 已作为 bundled/trusted plugins 加载，
  因此 Amadeus owner notifier 可正常调用 Gateway runtime。
- `packages/identity`、Amadeus `identity_*` tools/Skill 和 PUBG identity boundary 已加入源码；
  identity SQLite 与 presets 使用 `/data` 外部路径，确认写入受 owner gate，observed alias
  只能作为 candidate。线上已运行
  `local/openclaw-amadeus:git-1ccd6f09c6f1-20260918103442`，SOUL/MEMORY 与 Git 哈希一致，四张
  身份表仍为空；外部 `identity-presets.json` 可在运行后安全刷新，等待用户填写。
- Amadeus typed `before_dispatch` hook 只把 OpenClaw 可信 `replyToSender` 短时传给同一
  session 的 Identity tools，`agent_end` 清理；没有 reply metadata 时仍 fail closed。mention
  仍要求 host 提供结构化 platform ID，不解析昵称或 prompt。Pinned Telegram bundle 和外部
  WhatsApp package 现已通过 source-controlled、版本锚定补丁传递真实 mention/sender ID；Telegram
  `@username` 只有在同一会话内由 trusted sender metadata 先建立对应关系时才可解析。
- VPS read-only 子目标已完成 live 部署阶段：五个 bounded native tools、VPS Skill、KiwiVM 三个固定
  read endpoints、SSH 固定 probe、traffic baseline/stale semantics、secret mounts 和 VPS
  report cron 已加入源码；最新 Amadeus 10 tests、build/typecheck、脚本检查和 diff check 通过。
  Gateway 自然语言 smoke 已实际调用五个 VPS tools；晚间 report 已真实到达 WhatsApp owner DM，
  重启后 cron、usage baseline 和十格进度条提示仍存在。只剩真实 WhatsApp 入站查询证据。

最新已部署 PUBG 版本：提交 `fdf331c`，镜像 `local/openclaw-amadeus:git-fdf331cbca89-20260919071937`，恢复点
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919071937`；未发送未经请求的真实群聊测试消息。

美股指数通知子目标已完成部署：`amadeus_market_indices` 固定观测 `^NDX`/`^GSPC`，美东
09:35/16:05 工作日 cron 经 WhatsApp owner outbox 通知，休市返回 `market_closed`；版本
`1.2.0`、提交 `5117aa5`、checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919102358`。

下一步：

1. 在真实 Telegram/WhatsApp 私聊和群聊入口完成 sender binding、PUBG account/link、群 alias
   candidate/confirm 和重启持久化验收；不能用伪造 ID 或 provider trace 代替。
2. 记录真实 inbound/outbound 结果和数据库重启前后摘要；当前 live DB 只有 schema、四张表
   均为 0 行，安全地等待真实用户确认。
3. 继续保留 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918122319` 作为最新恢复点，
   不恢复已退休的 LangBot/n8n/旧 Runtime；VPS secret、受限 SSH probe/key、早晚 cron、真实
   WhatsApp owner report 和重启持久化均已验收。等待用户从 WhatsApp 发送自然语言查询，记录
   inbound/tool trace/final reply 后再关闭 VPS 子目标。

约束：不恢复 LangBot/Mastra/n8n 业务链；不做灰度、shadow、双跑、兼容 fallback 或回滚
演练；不提交 secret/业务数据；不修改现有 Avalon media library；长期服务只部署在
OrbStack ubuntu CasaOS。

## 2026-09-21 — Amadeus 1.4.5 Phases 1-4 source implementation

- Tracked the three secret migration source scripts with explicit `.gitignore` negations; strengthened metadata-only inventory and encrypted bundle logical-id/mode restore rehearsal.
- Added non-recursive fresh-clone runner, bounded `run-check.sh` with optional scope cache, validation matrix, and workflow/image-scope tests.
- Replaced unconditional storage healthy output with target metrics, threshold state machine, component aggregation, transition notification hooks and 90-day growth history; scheduled maintenance now uses safe apply semantics with project-only image and known evidence retention guards.
- Added service-aware registry, SQLite backup API snapshots, Immich `pg_dump -Fc`/`pg_restore --list` path, service backup manifest, 9Router isolated fixture rehearsal, explicit HomeLab classifications and manifest/runbook contract test.
- Hardened future Immich reclaim with fresh no-delete checksum equivalence, fresh logical dump, live mount/health checks, approval token `RECLAIM_IMMICH_SOURCE_1_4_5`, and reclaim-aware readiness. Source remains retained.
- Targeted gates passed; no Docker build, live mutation, Mac mini cutover or source reclaim performed.

## 2026-09-21 — Amadeus 1.4.5 final release/live acceptance

- `VERSION=1.4.5` released and pushed; current clean `main` is `41acb87`.
- Canonical CasaOS apply completed once with affected-only OpenClaw build. Live OpenClaw is `local/openclaw-amadeus:git-47ce26ae82a3-20260921153903`; Product Radar reused `git-16a8c15d727f-20260921082428`.
- Live checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260921153903`; deploy evidence `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260921153903`.
- Post-deploy service-aware backup contains three SQLite consistent snapshots, a valid `pg_dump -Fc`/`pg_restore --list`, and the exact 9Router artifact at `/Volumes/Avalon/backups/operation-skuld/live-post-1.4.5-20260921T155832Z/service-aware`.
- Encrypted secret bundle export/import passed at `/Volumes/Avalon/backups/operation-skuld/live-1.4.5-20260921T155352Z/secrets/secrets-20260921T155354Z`; values were not logged or committed.
- Doctor: 0 failures/0 warnings. Migration readiness: `OPERATION_SKULD=READY`. Storage state truthfully remains `critical` (external `warning`) but every required target exceeds the acknowledged 10 GiB hard minimum; scheduler health exit is 0 and weekly GC final evidence is `20260921T154412Z` with `GC=passed`.
- Immich source remains retained/pending; Mac mini cutover remains unexecuted.
