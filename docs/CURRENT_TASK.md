## 2026-09-25：M204 9Router 容器启动代理环境已恢复（DNS/回退问题仍待查）

按旧 Mac 的受保护 Compose 记录，在 M204 9Router 的 Git 模板及 live Compose 恢复
`HTTP_PROXY`/`HTTPS_PROXY` 大小写两套环境变量（`host.docker.internal:7897`）与
`NO_PROXY`/`no_proxy`；保留现有镜像、API 鉴权、应用内代理设置及本地/Docker/LAN 绕过。
仅对 9Router 执行 `docker compose up -d --no-build --no-deps`。外部恢复点：
`/DATA/AppData/9router/backups/proxy-env-20260925T043942Z`（Compose + SQLite 一致快照）。
健康 200、未认证 models 401、容器启动环境六项、镜像未变均通过。

真实 `arthur-combo` 验收第一次超时，日志显示 `[ProxyFetch] Proxy failed, falling back to direct`
及 `ENOTFOUND chatgpt.com`；第二次返回 200。故 **不能宣称 TLS 故障完全修复**。
成功请求可见 `host.docker.internal:7897` 出站；Tailscale/system DNS 曾对 OpenAI 域名
返回异常地址或无应答，而经代理 DoH 返回不同结果。后续必须确认代理失败原因并让
Codex/OpenAI 请求 fail-closed，不得以关闭证书校验或恢复第二 runtime 规避。
见 `.agent/checkpoints/2026-09-25-9router-startup-proxy-env.md` 和待办
`.agent/tasks/2026-09-25-9router-dns-proxy-failclosed.md`。

# 当前任务

## 2026-09-24：HostAgent 能耗报告边界收紧（待部署）

针对 16.5% CPU 使用率同时报告 SoC 33.3 mW 的不一致观测，确认 `powermetrics`
短窗口值只代表估算的 SoC 子系统功率，不能作为整机功耗或以 load/CPU 占比反算 W。
本次修正采样解析：缺失的 CPU/GPU/ANE 字段保留 null，不伪装为 0；负的 combined
功率降级。macos-host Skill 明确禁止据此推断时钟门控或把瞬时 W 积分为未经测量的 kWh。
已做本地单测；没有执行 M204 安装、CasaOS 重启或真实外部电表验收。要获得整机 W/kWh，
仍需由用户确认外部电表/智能插座的型号或 Home Assistant 实体，并做连续采样验收。

## 2026-09-24：9router OpenAI/Codex 500 已修复

9router 日志中的根因是 OpenAI/Codex 上游 TLS 建连失败：`ECONNRESET`，随后被网关表现为
502/客户端 500。M204 guest 的 HTTP 代理 `host.orb.internal:7897` 可用，但 9router 的
出站代理开关原来是关闭的。已在 9router Settings 持久化启用 HTTP 出站代理，并保留本地、
Docker 内网和 LAN 网段为 no-proxy。

验收：Codex provider test 返回 `valid=true`；实际 `gpt-6-astra` chat completion 返回 HTTP 200，
日志显示完成。日志中 Kiro 的 `invalid_grant` 是独立的失效 refresh token，不是 OpenAI 请求根因。

## 2026-09-24：9router 局域网访问与密码恢复已完成

9router 之前的 CasaOS 发布仅绑定 `127.0.0.1:20128`，因此 `192.168.5.3:20128` 无法访问。
已将仓库模板和 M204 live compose 的默认发布改为 `0.0.0.0:20128`，frpc 仍不映射 9router。
验证通过：LAN `/api/health` 与 `/login` 返回 200，未带 API key 的 `/v1/models` 返回预期 401。

已在外部路径 `/DATA/AppData/9router/backups/access-recovery-20260924T141346Z` 保存 compose、env
和 data 回滚副本。通过 9router CLI 边界清除未知旧密码并设置临时新密码；密码只在本次用户回复中
提供，未写入 Git、checkpoint 或日志。带该密码的 LAN 登录返回 200，认证 dashboard 返回 200。

## 2026-09-24：Amadeus 1.5.2 SoC 功耗采集已启用，整机交流功率待外部电表

1.5.2 已部署，root `powermetrics` LaunchDaemon 已在 M204 启动。OpenClaw owner host-status
真实调用返回 `telemetry=supported`、新鲜样本和 `scope=soc`；一次观察为 SoC 约 0.03 W，
CPU 0 mW、GPU 30.4 mW、ANE 0 mW，采样窗口约 1.18 秒。后续样本也在约 0.016–0.044 W
之间变化。这些是芯片子系统估算值，不是 Mac mini 整机输入功率；不应继续用它计算整机耗电。

Apple 的 Mac mini 整机功耗定义为从墙上电源测量并包含电源转换及系统损耗；macOS
`powermetrics` 提供的是可能不准确的 SoC 子系统估算。因此“整机功耗能准确计算”仍需接入
带实时 W 读数的外部电表/智能插座。当前仓库没有发现已配置的功率计。待提供设备型号或
Home Assistant 实体后，可接入其读数；在此之前 status 必须标明 SoC 范围，不能冒充整机 W。
安装证据见 `.agent/checkpoints/2026-09-24-amadeus-1.5.2-power-sampler-installed.md`。

## 2026-09-24：Amadeus 1.5.1 Longbridge 日历范围热修复待部署

1.5.0 已在 M204 CasaOS 运行并通过 OAuth、官方 SDK quote、HostAgent、Telegram/WhatsApp
通道和 owner release notification 验收。`amadeus_market_session` 的 live smoke 仍暴露
Longbridge 错误 `301600 too many query days`：真实 SDK 探测确认 ±14 天成功、±21 天失败。
1.5.1 将默认窗口收窄为前后 14 天，同时保留显式日期范围。

定向 Amadeus tests、typecheck、build、secrets scan 和 diff check 已通过（针对 1.5.0 源码）；
1.5.1 需重新提交推送、重建 ARM64 镜像、执行带 rollback checkpoint 的 apply，并复测 market
session/quote、MacHostAgent 工具和 `amadeus-release:1.5.1` 通知。外部 `media-organizer-adapter` 仍无可重建
image/compose；部署会记录跳过，不伪造替代服务。Avalon 外部存储 gate 仍会使日志策略和 GC
维护保守失败，并追加 warning notification。

## 2026-09-24：Longbridge 官方 SDK M204 运行时边界与 OAuth 验收进行中

M204 已完成 Longbridge OAuth client 注册、PKCE 授权和 code exchange；canonical OAuth state 与
官方 SDK token cache 已以 `0600` 权限同步到 `/DATA/AppData/openclaw/data`，MacHostAgent 已安装并以
bearer 鉴权返回 HTTP 200。operator exchange 脚本已兼容 Node 24 stdin，并在本机代理下完成 exchange。

镜像侧确认官方 `longbridge@5.1.0` arm64 native binding 要求 glibc 2.39，而 pinned OpenClaw
Debian 12 基础镜像为 glibc 2.36。Dockerfile 现以 SHA-256 固定的 Ubuntu 24.04 `libc6 2.39`
私有 loader 包装 Node，保留基础镜像系统 libc；ARM64 构建与 SDK import smoke 已通过。尚未把该镜像
部署到 CasaOS，也未执行 live quote 或 owner notification smoke；部署前需完成 release build、
secrets scan、可回滚 checkpoint 和健康/工具验收。

M204 当前没有可重建的 `media-organizer-adapter` image/compose，只有受保护 state archive；部署脚本
会显式记录 `MEDIA_ADAPTER_NETWORK=skipped_missing_service`，不臆造替代服务，因此媒体整理 live
验收保留在 `.agent/tasks/amadeus-1.4.9-live-acceptance.md`。

## 2026-09-24：Longbridge 官方 SDK 运行时边界修正

已将市场客户端切换为官方 `longbridge@5.1.0` Node SDK：行情、日内、交易时段、交易日、温度、movers
和 constituents 均通过 SDK 的只读 Quote/Market context，运行时不再调用自写的行情 HTTP 路径。OAuth
operator exchange 会把同一授权状态以 SDK 的 `~/.longbridge/openapi/tokens/<client_id>` 格式写入外部
`longbridge-sdk-home`；Compose 持久化挂载该目录，SDK 刷新后的状态会同步回 canonical OAuth state。
镜像构建会安装与目标架构匹配的 native SDK 包；deployment checkpoint 也会保护该外部 token cache。
新增 SDK cache、RFC3339 时间戳和 prepare 权限回归覆盖，尚未执行实际 Docker release build 或 live OAuth。

## 2026-09-24：补齐 Longbridge 公有 OAuth PKCE operator flow

按 Longbridge 当前 OAuth 2 文档补齐 `S256` PKCE：operator `start` 在外部状态文件保存
短期 verifier，授权 URL 带 `scope=3`、`code_challenge` 和 `state`；`exchange` 只接受完整
callback URL，校验回传 state 后交换 code，并在成功后删除短期请求状态。OAuth token/refresh
数据仍只写入 0600 的外部 state 文件。新增 RFC 7636 challenge 回归测试，Amadeus typecheck、
30 个聚焦测试、build、secrets scan 和 diff check 已通过。HostAgent 安装器已修正为用户级
LaunchAgent，不再要求 sudo，当前尚未执行 `--apply`；Longbridge client id/OAuth 和 live acceptance
仍待外部状态。

## 2026-09-24：Amadeus 1.4.9 Host & Market Awareness（源码实现与验证进行中）

远端 `1c2162b` 已拉取，权威目标为 `docs/AMADEUS_1_4_9_HOST_AND_MARKET_AWARENESS_GOAL.md`。
当前工作树已将市场能力迁移到 Longbridge OAuth 2 唯一只读来源：新增公开市场 overview/quote/
intraday/session/movers 工具、确定性 symbol/数值/方向/通知格式、OAuth 状态持久化和无浏览器重启
路径；移除旧市场配置、传输、解析器、provider-specific fixture 与固定时钟市场真相。新增 M204 原生
MacHostAgent 固定 `/health`、`/v1/status`、`/v1/processes` 只读面、launchd plist、owner-only
OpenClaw host tools 和 powermetrics degraded 语义。定向 Amadeus/host tests、typecheck、architecture
checks 已通过；尚未执行需要真实 Longbridge operator OAuth 和 live M204 host agent 的部署验收。

版本已通过唯一入口更新为 `1.4.9`，release notes 已替换为单次发布内容。下一步是完成全仓 build/
typecheck/test/secrets/diff 验证，生成 sanitized checkpoint，并在具备外部 client id/OAuth state 与
MacHostAgent token 后执行 M204 runtime acceptance；OAuth/token/private account 数据不写入仓库。

## 2026-09-24：frpc 与公网服务已恢复（跳过 9router）

已从外置 source-freeze 归档恢复 M204 的 frpc 配置，删除 `9router-tcp` 与未恢复的 Homarr
映射，并将 frpc 管理面与 Glances 回源固定到 guest loopback。frpc `0.69.0` 由 systemd 管理，
配置校验通过，8 个安全映射登录并启动成功。Emby、Jellyfin、qBittorrent、aria2、Glances 的
配置归档和镜像已恢复到 CasaOS；Avalon UUID、哨兵和 guest 外置设备检查通过。

公网验收：`immich` 200、`emby` 302、`jellyfin` 302、`qb` 200、`aria` 200、`monitor` 200，
`claw` 403（token 保护正常）。`9router.nyannyan.top` 无 DNS 且没有 frpc 映射；9router 仅为
OpenClaw 本机依赖并收紧到 `127.0.0.1:20128`。Homarr 保持停用。证据见
`.agent/checkpoints/2026-09-24-frpc-public-restore.md`。

## 2026-09-24：公网服务诊断完成，待恢复 frpc 隧道

公网 Caddy/Cloudflare 前端可达，但 `claw`、`immich`、`emby`、`jellyfin`、`qb`、`aria`、`monitor`
均返回 502，根因是 M204 当前没有运行 frpc；`9router.nyannyan.top` 没有 DNS，`sub` 根路径 404
符合订阅站点行为。旧 frpc 映射可从外置归档恢复，未在本轮自动恢复公网入口。证据见
`.agent/checkpoints/2026-09-24-public-services-diagnosis.md`。

## 2026-09-24：M204 LAN bindings restored

用户反馈 M204 部署服务无法从局域网访问。现场确认除 OpenClaw 外，CasaOS Compose 的用户服务
均发布在 `127.0.0.1`。已将 Git 默认配置和 live CasaOS 端口发布切回 `0.0.0.0`，覆盖
Product Radar、Changedetection、Immich、9Router、Filebrowser、Xiaoya、AriaNG、Dashdot；
PostgreSQL、Redis 和模型容器继续不发布。`192.168.5.3`、`192.168.5.50` 两个 LAN 地址的逐端口
探测均已建立连接。回滚备份和证据见 `.agent/checkpoints/2026-09-24-m204-lan-bindings.md`。

## 2026-09-24：Operation Skuld WhatsApp-only cutover committed

用户已明确跳过 Telegram 验收，Telegram 运行时保持不变；声明式 OpenClaw 配置未停用 Telegram。
WhatsApp 单轮 owner 验收和唯一运行时门禁已通过，用户随后明确授权并已执行
`COMMIT_SKULD_CUTOVER_1_4_8`。当前 `DESTINATION_AUTHORITY=Amadeus-M204`、
`SOURCE_AUTHORITY=retired`、`OPERATION_SKULD_CUTOVER=COMMITTED`；旧源、外部 rollback
checkpoint 和 Immich source 保留至少 72 小时，不删除 Telegram secret。最终证据：
`/Volumes/Avalon/backups/operation-skuld/final-cutover-20260924T074756Z`。

## 2026-09-24：WhatsApp direct identity acceptance 已通过

修复镜像重启后，15:19:17 收到精确控制 marker `SKULD-WHATSAPP-20260924`，15:19:44 仅产生
1 条 WhatsApp 出站回复。实时 SQLite/WAL 记录确认 `identity_bind_channel` 返回 `status=bound`，
绑定到当前 WhatsApp direct sender；本轮没有 `trusted_sender_metadata_unavailable`。因此
`WHATSAPP_ACCEPTANCE=passed`。Telegram 尚未完成正式单轮验收，`DESTINATION_AUTHORITY=NO`，
最终 token `COMMIT_SKULD_CUTOVER_1_4_8` 未执行。证据见
`.agent/checkpoints/2026-09-24-whatsapp-direct-session-identity-fix.md`。

## 2026-09-24：WhatsApp direct session identity fallback 已部署

修复后 14:17:47 控制 marker 到达并只产生 1 条出站回复，但 OpenClaw WhatsApp adapter 未传
`senderId`/`senderE164`，identity bind 连续 3 次失败。commit `805e6b4` 仅从 host 生成的
`whatsapp + direct` session key 恢复 peer identity，拒绝 group/channel key 与消息文本推断。
22 个 Amadeus tests、typecheck、build、secrets scan、diff check 通过。M204 已运行
`local/openclaw-amadeus:git-805e6b4-20260924064816`（arm64 digest
`sha256:adb9532041682bda8a5b399398b6ee825a86e3e06d5da1a79c33c050813db9bd`），容器 healthy；
受保护回滚副本已保存，等待重启后的下一次 WhatsApp marker。`DESTINATION_AUTHORITY=NO`，最终
token 未执行。证据见 `.agent/checkpoints/2026-09-24-whatsapp-direct-session-identity-fix.md`。

## 2026-09-24：WhatsApp 身份桥接修复已部署，等待修复后控制验收

此前 WhatsApp 控制标记 `SKULD-WHATSAPP-20260924` 在修复前运行时收到并只产生一条回复，但
`identity_bind_channel` 返回 `trusted_sender_metadata_unavailable`，因此没有把该轮计为 owner
acceptance。已在 commit `a62b2bd` 修复：`before_dispatch` 将当前入站 sender metadata 以 5 分钟
TTL 桥接到会话，identity context 在缺少 `requesterSenderId` 时安全使用该桥接；WhatsApp E164
仅作为 WhatsApp fallback。`pnpm test:amadeus`、`pnpm typecheck:amadeus`、`pnpm build:amadeus`、
`pnpm check:secrets` 与 `git diff --check` 均通过。

M204 已构建并加载 `local/openclaw-amadeus:git-a62b2bd-20260924131000`（arm64 digest
`sha256:1ba126e6e740bf572f7c80ab1b1e34bdf9e95e8c138023f7c8a64a990b984875`），更新 canonical
CasaOS Compose 后重启，容器 healthy，Telegram/WhatsApp 均重新连接。运行时 Compose/container
checkpoint 保存在仓库外受保护备份中；修复后 WhatsApp 单轮控制验收等待用户在当前私聊重新发送
同一精确标记。`WHATSAPP_ACCEPTANCE=pending_post_fix_resend`、`TELEGRAM_ACCEPTANCE=pending`、
`DUPLICATE_RUNTIME=not-finalized`、`DESTINATION_AUTHORITY=NO`，未执行
`COMMIT_SKULD_CUTOVER_1_4_8`。`media-organizer-adapter` 仍只有外部 state archive，未恢复或臆造替代。

同日 workstation handoff pre-cutover 现场复核已通过：当前主机 `Amadeus-M204`、用户 `nyannyan`、
canonical repo `/Users/nyannyan/agent-monorepo`，`main` clean 且本地 HEAD、`origin/main` 与远端
`git ls-remote` 一致，origin 为 `git@github.com:ChristmasFox/amadeus-home.git`。Node 24.21.0、
pnpm 11.19.0、Python 3.11.16、Git、tmux、cloudflared、OrbStack `nyannyan` guest、Docker
29.8.1、Compose 5.5.1、CasaOS active 均已核验，`./scripts/bootstrap.sh --check` 通过；本机
profile 为 `ORBSTACK_MACHINE=nyannyan`、`MAC_CONTROL_USER=nyannyan`、`EXTERNAL_STORAGE_ROOT=/Volumes/Avalon`。
旧路径扫描仅命中 Xiaoya 源迁移映射、测试 fixture 和禁止性说明，未发现 active destination workflow
依赖旧 Mac 路径。证据见 `.agent/checkpoints/2026-09-24-m204-workstation-handoff-precutover.md`。

## 2026-09-23：Amadeus 1.4.8 Operation Skuld 最终迁移与记忆连续性（进行中）

2026-09-24 M204 runtime readiness progress：主机/仓库/GitHub/工具链验收通过；M204 canonical
guest 为 OrbStack `nyannyan` Ubuntu 24.04 arm64，Avalon UUID 与 sentinel 经过 `diskutil
verifyVolume` 和 guest 读校验；Product Radar SQLite/image/health、Immich 四容器与 PostgreSQL
dump/vector extension/API、FashionSigLIP MPS worker 均已恢复并通过现场检查。目标工作区仍 clean，
`origin/main` 与本地 `3a41867` 一致。证据见
`.agent/checkpoints/2026-09-24-m204-runtime-readiness-progress.md`。

当前仍未完成 owner-channel acceptance：最近 WhatsApp group 活动不计入控制验收，Telegram/WhatsApp
唯一标识测试消息尚未观察到；`TELEGRAM_ACCEPTANCE=pending`、`WHATSAPP_ACCEPTANCE=pending`。
`media-organizer-adapter` 仍缺可重建 image/compose，仅有 state archive，未臆造替代运行时；
因此 doctor 仍有 2 个失败，`DESTINATION_AUTHORITY=NO`，且没有执行
`COMMIT_SKULD_CUTOVER_1_4_8`。

2026-09-24 WhatsApp relink 已完成：M204 `channels status` 显示 Telegram `ready/connected`，WhatsApp `linked/healthy/connected`；二维码登录残留子进程已精准停止，避免重复登录。随后观察到 WhatsApp 最近窗口 6 次 direct 入站与 6 次发送，未见额外重复发送，但这是多条消息而非单次控制验收，且尚未证明回复内容、owner identity 和 tool policy；Telegram 仍无入站/出站时间戳，正式 owner-channel acceptance 尚未通过，不能执行最终 cutover。证据见 `.agent/checkpoints/2026-09-24-whatsapp-activity-awaiting-telegram.md`。

2026-09-24 Phase 12/13 进展：用户授权停止旧 Mac Gateway 后，已执行 `launchctl disable` + `bootout`；`ai.openclaw.gateway` plist 保留，rollback-only，`18789` 已无监听。fresh unique-runtime gate 通过：旧 Mac OpenClaw/Gateway 进程 0、M204 候选 1、`OPENCLAW_ACTIVE_RUNTIME_COUNT=1`。M204 已从 migration-safe overlay 切换到 canonical Compose，容器 healthy、restart=unless-stopped、LAN `18789` 已发布；canonical 配置持久化 `tools.sessions.visibility=self`、`dmScope=per-account-channel-peer`、`groupScope=per-group`，Telegram/WhatsApp enabled，owner delivery=true。Telegram 已 `ready/connected`；WhatsApp 旧会话服务端返回 401/logged-out，M204 主机 detached `screen` 会话 `amadeus-whatsapp-relink` 正在等待新 QR 扫码并在过期后自动重试，真实 WhatsApp 入站/出站和去重验收尚未通过。最终 cutover token 尚未执行。

2026-09-24 Phase 12 fresh gate：用户已提供精确 `APPROVE_OWNER_INGRESS_SWITCH_1_4_8`，但门禁未通过，未执行 ingress 写入。旧 Mac `ai.openclaw.gateway` 仍为 active LaunchAgent（loopback `18789`、`RunAtLoad=true`、`KeepAlive=true`，仅 iMessage）；M204 候选为 1 个，旧 Mac OpenClaw/Gateway 进程为 1 个，因此 `OPENCLAW_ACTIVE_RUNTIME_COUNT=2`、`UNIQUE_RUNTIME_GATE=BLOCKED`。M204 实际有效配置仍为 `/run/openclaw-migration/openclaw.json`：loopback、Telegram/WhatsApp disabled、`sessions.visibility=self`、owner delivery disabled。需要 operator 明确分类/处理旧 Mac Gateway 后，才能重新跑唯一运行时门禁；本次批准不等同于 `COMMIT_SKULD_CUTOVER_1_4_8`。

当前优先目标为 `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`。Phase 7 source freeze、Phase 8 Avalon destination preflight 和 Phase 9 OpenClaw cold-state restore 已完成。迁移安全候选在 M204 运行，所有 owner/public ingress 与 owner delivery 仍关闭，`DESTINATION_AUTHORITY=NO`。此前报告的 84 session/JSONL 与 6 transcript 是路径子串误计，不能作为会话迁移验收；真实主会话库为 SQLite。最新运行库记录 57 sessions、5,791 transcript events、5,605 active events、1 archive row、2,843 search chunks，且 SQLite integrity 通过。修正证据见 `.agent/checkpoints/2026-09-24-kurisu-recall-acceptance-passed.md`。

Phase 10 已在 M204 完成：当前 ARM64 安全候选镜像为 `local/openclaw-amadeus:git-238bb65-20260923171901`，目标 digest `4c726c0a7d5992b53d55591c45455e1a45000e45e8d53c829cdb8a3b2ce8ffb9`；安全 Compose preflight 通过，候选容器 healthy，loopback-only、全部渠道关闭、无 published ports、owner delivery=false，9Router 探测通过（接受 200/401）。候选 restart policy 为 `no`，上一版 Compose 已保留受保护备份；`tools.sessions.visibility=self` 已生效，阻止跨会话历史回忆。

2026-09-24 Phase 11 自然语言身份路由验收已通过；范围反向验收也通过：无 direct/group scope 的 synthetic 会话只能解析全局身份，不能从其他会话取回范围事实；调用顺序为 `identity_resolve(reference=alias)` → `sessions_search`，无先行 `memory_search`。实际主会话库最新只读计数以范围 checkpoint 为准。memory file vector index 仍 dirty/empty/mismatched，但本次身份与范围隔离验收不依赖该索引，也未触发外部 embedding reindex。用户指定的一条 direct-only 事实和一条 group-only 事实未写入全局 `MEMORY.md`；待真实私聊/group session metadata 可用后再做定向验收。证据见 `.agent/checkpoints/2026-09-24-conversation-scope-guard.md`。

Phase 12 前置的旧 Mac authority 复核已确认本机 `xu-mac` 上 `ai.openclaw.gateway` 是另一个 active LaunchAgent：`RunAtLoad=true`、`KeepAlive=true`，gateway 只绑定 loopback `18789`，当前仅启用 iMessage channel/plugin。保留日志有 18 行命中粗粒度 inbound 关键词；未读取任何消息内容，因此尚不能判断它是本次迁移的生产 authority 还是独立本地服务。未停止/禁用；必须先由 operator 分类，再做 fresh unique-runtime gate。详细脱敏证据见 `.agent/checkpoints/2026-09-23-migration-safe-compose-preflight.md`。

历史首次自然提问验收曾失败：两个人名查询被错误地传给 `identity_resolve(reference=self)`，并误用 `memory_search`/`ls`。该失败已由 `e7c3de0` 的候选修正并通过原始自然提问复测；当前 `KURISU_ACCEPTANCE=passed`。memory file vector index 仍为空/不匹配（`fts-only` 对 `text-embedding-3-small`）；未重建，避免把私有文本发送给外部 embedding provider。完整脱敏证据见 `.agent/checkpoints/2026-09-24-kurisu-recall-acceptance-passed.md`。

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

## 2026-09-24：Amadeus 1.5.3 WhatsApp Voice I/O（源码候选，未部署）

从目标分支取得 `docs/AMADEUS_1_5_3_VOICE_IO_GOAL.md`，重新检查 M204 live 9Router/OpenClaw 和 pinned schema。当前 STT `amadeus-asr` 仅是 Chat Combo，真实 STT 端点对合成音频返回 400；尚无正确 STT alias、DashScope 凭据验证、`kurisu-v1` 音频/文字资产或本机 TTS token。

已实现原生 macOS Qwen3-TTS 服务候选、受保护 Bearer 边界、voice profile 单次加载/热身、音频编码、launchd 安装脚本及 OpenClaw 原生 `media.audio`/`tts.auto=inbound` 配置候选。mock 单测、schema、工作流 fixture、secrets 检查通过；没有改 live runtime、发布版本或发送 WhatsApp 消息。下一步为 ASR API/9Router 确认、真实模型/资产、集成及验收；详情见 `.agent/checkpoints/2026-09-24-amadeus-1.5.3-voice-source-discovery.md` 与 `.agent/tasks/2026-09-24-amadeus-1.5.3-voice-acceptance.md`。不能把该候选称为 1.5.3 release。

1.5.3 工程烟测补充：在仓库外安装了 pinned Qwen3-TTS Base 模型和 Python venv；使用临时系统合成参考音频验证 MPS 单次模型加载/热身与中文 WAV 生成，并在临时 loopback 端口验证 503→200 readiness、鉴权和 MP3 输出。临时参考/密钥和测试进程已移除；正式 `kurisu-v1` 仍缺失，18792/launchd 与 9Router/OpenClaw live 均未切换。新增 9Router 默认 dry-run 的 provider/alias 受保护配置脚本，等待真实 DashScope STT 兼容接口和凭据确认。工程烟测不等于生产声音或 WhatsApp 验收。

1.5.3 后续准备：M204 speech token 已由显式 `--prepare-apply` 在仓库外生成并验证 mode 0600；前述“缺少 TTS token”只描述 discovery 时点。仍缺正式参考音频/转录文字及 DashScope/dashboard 的可用受保护凭据；未执行生产 launchd、9Router 或 WhatsApp 切换。

## 2026-09-24：1.5.3 ASR 适配与失败语义（源码阶段）

阿里云官方文档确认 `qwen-audio-3.0-asr-flash` 同步接口是 DashScope multimodal-generation，非 9Router 的标准 STT multipart 路径。已在仓库管理的 9Router 镜像源码加入受保护、容器 loopback 的确定性协议适配层（Ogg/Opus→16 kHz WAV、Data URI、结构化错误和五分钟有界文字缓存）。OpenClaw pinned WhatsApp 入站 ASR 失败时会把 null 交给 Agent；新增 source-controlled 受限补丁候选，只对已准入私聊语音用原 WhatsApp 发送路径返回简短文字错误。两者均未部署，尚无真实 DashScope 凭据或 WhatsApp 验收。证据见 `.agent/checkpoints/2026-09-24-amadeus-1.5.3-asr-bridge-and-failure-boundary.md`。

## 2026-09-24：1.5.3 9Router deploy source（未执行 apply）

新增默认 dry-run、显式 `--apply` 的 9Router speech 部署脚本；内含 M204 protected secrets preflight、旧镜像外部归档、SQLite/Compose/env/secret checkpoint、ARM64 immutable image、`--no-build` 切换、双服务 health 和失败时 Compose 回退。真实密钥/地域 URL 不存在，故未构建镜像或切换 live。`kurisu-v1` 目录已以 0700 创建但仍无参考音频/文字。详见 `.agent/checkpoints/2026-09-24-amadeus-1.5.3-9router-deploy-source.md`。

## 2026-09-24：1.5.3 9Router immutable image 工程验收（未切换）

旧镜像已归档至 Avalon。基于 Git commit 的 ARM64 候选镜像已构建并加载到 M204 guest，但生产容器/Compose 仍运行旧 `0.5.81`。isolated `--network none` fixture 发现并修复 9Router entrypoint 降权至 uid 1000 后无法读取 root-owned 0600 secret 的问题；重测通过 bridge 鉴权、ffmpeg 转码、双 health 和断网结构化失败。bridge token 已在仓库外生成并以 uid 1000/mode 0600 安置；DashScope key/地域 URL、dashboard 密码文件及正式音色仍缺。见 `.agent/checkpoints/2026-09-24-amadeus-1.5.3-9router-image-fixture.md`。不把 fixture 成功当作真实 ASR 或 WhatsApp 验收。

## 2026-09-24：M204 Qwen3-TTS 原生服务已安装（全链路仍待验收）

用户放入私人自用的动漫来源参考素材；目录 0700、两文件 0600。WAV 为 PCM16/24 kHz/单声道/46 秒，文字 290 字符。源文件与 TTS token 已在仓库外 mode 0700 的 Avalon checkpoint 备份并核对完整性。正式 LaunchAgent 已通过显式 `--apply` 安装：MPS 热身、中文 MP3、日文 Ogg/Opus、鉴权、guest 到 host health 和进程重启后的再次合成都通过。**这只是私人临时音色与原生 TTS 工程验收**；不宣称原创音色已实现，也不宣称 9Router/WhatsApp 全链路、M204 重启或 1.5.3 release 已完成。见 `.agent/checkpoints/2026-09-24-amadeus-1.5.3-native-tts-live.md`。

## 2026-09-24：9Router STT alias 重启门禁已查明（仅隔离 fixture）

在 network-none 镜像 fixture 中，`0.5.81` 和测试用 `0.5.86` 均表现为：新建 `amadeus-asr` alias 后直接 STT 请求仍被解析为 openai 并返回 400；重启同一容器后才正确路由到 Self-hosted STT，返回预期的断网 `provider_unavailable`。TTS alias 可立即解析。已将一次受保护重启、双 health/401 验证纳入 9Router provisioning 源码和测试；生产未执行 dashboard 变更或重启。见 `.agent/checkpoints/2026-09-24-amadeus-1.5.3-9router-alias-cache.md`。

## 2026-09-24：已有千问 API 已找到，ASR 协议差异待正式确认

用户提示后只读检查发现 9Router 中存在启用的 `Qwen` 自定义 API 节点及 Key，端点属于 `qianwenaiapi.com/compatible-mode/v1`，不是原 Goal 的阿里云 Model Studio 工作空间。短合成音频对该平台 Qwen-Audio-3.0-ASR-Flash 多模态接口的真实请求返回 HTTP 200、非空转录；返回是 top-level `text`/`output.text`，现已在 adapter 源码和测试兼容。受保护的 key/URL 已从 live 9Router DB 复制到 guest secret/env 并留 SQLite/env checkpoint，线上容器未切换。使用该平台取代 Goal 指定的 Alibaba/DashScope 是明确的供应商差异，部署脚本需额外 `--allow-qwenai-upstream`，尚未执行。详情见 `.agent/checkpoints/2026-09-24-amadeus-1.5.3-existing-qwen-api.md`。

1.5.3 千问 API 后续工程验收：基于 `8a47b85` 构建并加载新的 9Router ARM64 immutable 候选镜像，network-none fixture 验证授权、ffmpeg、TTS alias 和重启后的 ASR alias 均通过；线上仍是旧镜像。`--apply` 在未提供 `--allow-qwenai-upstream` 时已验证 fail closed。需由 operator 明确决定能否以现有 qianwenaiapi.com 平台替代 Goal 指定的 Alibaba Model Studio/DashScope，之后才能正式切换并完成真实 9Router/WhatsApp 验收。证据见 `.agent/checkpoints/2026-09-24-amadeus-1.5.3-qwen-api-image-smoke.md`。

## 2026-09-25：9Router 语音镜像首次 apply 自动回退，探针已修正

用户明确同意现有 `qianwenaiapi.com` 作为正式 ASR 上游。首次 9Router apply 已创建受保护 SQLite/Compose/env/secret checkpoint 和旧镜像外部归档、构建新 immutable 镜像；由于验收脚本错误地要求容器内 loopback `/v1/models` 返回 401，健康探针失败并自动恢复旧 Compose/image。真实 Mac 入口仍是 401，旧 9Router/OpenClaw 健康。隔离复制的 live DB 验证新镜像 Router/bridge health 均为 200；源码已改为从 Mac 发布入口验证 API-key 401。待提交后重试 apply，不宣称首次尝试发布成功。见 `.agent/checkpoints/2026-09-25-amadeus-1.5.3-router-probe-rollback.md`。

## 2026-09-25：9Router speech 镜像 live，模型 alias 尚未配置

用户已同意现有 QwenAI 上游。第二次显式 9Router apply 在受保护 checkpoint 后成功；canonical Compose 运行 `local/9router:git-d882528fd59a-20260925T032728Z`。Mac 发布入口 health 200、未授权 models 401，容器内 ASR bridge 与到 M204 TTS 的 health 均 200。短合成音频对**live bridge** 的真实 QwenAI 请求返回 200/非空转录，约 8 秒；私人音频和密钥未外传或记录。仍缺 9Router 原生 STT/TTS 连接/alias。已查明 upstream 受保护 CLI 管理 token，可不重置 dashboard 密码，由源码脚本使用。证据见 `.agent/checkpoints/2026-09-25-amadeus-1.5.3-router-live-and-cli-auth.md`。

1.5.3 9Router alias provisioning 首次尝试在受保护数据库备份预检处因嵌入的 guest Python 换行转义错误而失败，**未写入 provider/alias、未重启现网**。源码已改为 raw string，并新增编译实际生成脚本的回归测试；提交后重试。证据见 `.agent/checkpoints/2026-09-25-amadeus-1.5.3-provider-checkpoint-preflight.md`。

## 2026-09-25：9Router 原生 STT/TTS 全部 live，OpenClaw 尚未切换

受保护 checkpoint `/DATA/AppData/9router/backups/voice-1.5.3-20260925T040813Z` 保存旧 DB/Compose/env/image 元数据；前后 SQLite integrity 均为 ok。旧 `amadeus-asr` Chat Combo 已退休，Self-hosted STT/TTS 各一条连接，两个逻辑 alias 生效并在重启后验收。Mac 合成短语音直接调用真实 9Router 标准 `/v1/audio/transcriptions` 返回 200/非空转录；`/v1/audio/speech` 返回 200/有效 MP3。OpenClaw 仍为旧 config/image，`VERSION=1.5.2`。发现 pinned OpenClaw 镜像缺 ffmpeg，WhatsApp MP3→Opus 发送将失败；已加入 Dockerfile 依赖，必须构建 immutable OpenClaw image 后再接入。证据见 `.agent/checkpoints/2026-09-25-amadeus-1.5.3-router-speech-routes.md`。

## 2026-09-25：单一 OpenClaw 验收候选部署门禁

9Router 两个原生逻辑语音路由已真实 HTTP 200 验收，但 OpenClaw 旧镜像缺 ffmpeg，WhatsApp MP3→Opus 尚不能交付。Dockerfile 已声明 ffmpeg/libopus。原 deploy 脚本要求 VERSION 超过 live，不能在真实 WhatsApp 验收前假装发布 1.5.3；新增显式 `--apply --candidate --build-auto`：仍只切换 canonical **一个** runtime、做原有 backup/build/health，不发 1.5.2 的错误 release 通知，也不执行 release-only maintenance。静态与 dry-run 测试通过，尚未 apply。见 `.agent/checkpoints/2026-09-25-amadeus-1.5.3-candidate-deploy-gate.md`。
