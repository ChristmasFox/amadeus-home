## 2026-09-26：Amadeus 1.5.9 群聊日语 TTS guard 已正式部署

- `VERSION=1.5.9`，release commit `3f9171f` 已 push；`./scripts/deploy-openclaw.sh --apply --build-auto` 已完成受影响 OpenClaw image 构建和 CasaOS 切换。
- live image：`local/openclaw-amadeus:git-3f9171f47b19-20260926043743`；rollback checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926043743`；evidence：`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260926043743`。
- OpenClaw healthy、restart=0，Product Radar healthy；live runtime 已确认 `amadeus-whatsapp-japanese-tts-input-v1` marker，WhatsApp 已重新连接并监听 DM + all groups；release owner outbox smoke 已 sent。
- `doctor.sh` strict 仍有 1 个已知非阻断失败：可选 `media-organizer-adapter` 缺席；`DOCTOR_STRICT=0` 下其余健康、存储、日志和外部卷检查通过。
- 真实群聊音频入站已在 2026-09-26 12:43 Asia/Shanghai 观察到；最终验收仍需用户确认收到的音频是否只有一段日语、文字是否不再嵌套重复。

详见 `.agent/checkpoints/2026-09-26-amadeus-1.5.9-formal-release.md` 与 `.agent/tasks/2026-09-26-whatsapp-group-voice-tts-guard.md`。

## 2026-09-26：定位 WhatsApp 群聊中日双语被合成两段的问题（源码 guard 待发布）

- 群聊 `/tts status` 为 `Chat override: default`、`Provider: openai`、最近一次 `openai:success(ok)`；这排除了群级 TTS 开关/Provider override 作为首要根因。
- pinned OpenClaw 2026.9.4 的 Auto-TTS 在缺少 `[[tts:text]]...[[/tts:text]]` 时会把整段可见回复送入 TTS。voice Skill 虽要求 directive，但模型若漏写，中文摘要和日本語行会一起合成。随后现有 WhatsApp visible-text postprocessor 会把整段 `spokenText` 填回 `日本語：`，导致 `日本語：中文：... 日本語：...` 的重复显示。
- 已在 `scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs` 增加 WhatsApp inbound voice 的 deterministic 日文行选择：优先取最后一个含假名的 `日本語：` 行作为唯一 TTS 输入；找不到则不合成。delivery guard 同时拒绝已经是双语/多行的 `spokenText`，避免发送混合 PTT。
- `pnpm test:openclaw-voice-lifecycle`、`pnpm check:architecture`、`pnpm check:secrets` 和 `git diff --check` 通过。
- 当前 live 仍是 `local/openclaw-amadeus:git-b54c2ed84ee4-20260925195233`，本次修复尚未 build/deploy；待发布后用真实群聊验收，不清空群聊记忆。

详见 `.agent/checkpoints/2026-09-26-whatsapp-group-japanese-tts-input-guard.md` 与 `.agent/tasks/2026-09-26-whatsapp-group-voice-tts-guard.md`。

## 2026-09-25 UTC：Amadeus 1.5.8 语音恢复已由用户确认正常

- 用户在 1.5.7 部署后反馈收到中日文字但没有语音条。根因已定位到 TTS，不是文字格式：OpenClaw 对 9Router `/v1/audio/speech` 等待 120 秒后超时；9Router 报 `fetch failed` 并锁定 self-hosted TTS。Mac Qwen 服务 health 虽为 ready，但旧推理一直占用串行 inference lock，90 秒短句烟测也超时。历史 `>320` 字日语合成记录耗时约 223 秒，超过固定 120 秒窗口。
- 1.5.8 将“约 100 词”改为**软性上限而不是输出目标**；常规日语语音建议约 150 日文字符内，长细节放中文摘要，保留既有 120 秒 timeout/lease，不靠延长等待掩盖慢合成。
- Release commit `b54c2ed` 已 push；正式 apply 使用 live OrbStack `nyannyan`（本机 `orb list` 唯一的 Ubuntu Noble VM），OpenClaw image `local/openclaw-amadeus:git-b54c2ed84ee4-20260925195233`，Product Radar 复用既有 image。checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925195233`；evidence `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925195233`。
- OpenClaw/Product Radar health、NAS SSH smoke、中文 owner release 通知与 outbox smoke 通过。修正后的 external identity-only gate 与 post-deploy bounded maintenance 都通过；Docker Compose 校验通过，Immich healthy。日志策略本次只剩全局 `/etc/docker/daemon.json` 缺失警告；所有受管容器仍通过 per-container `local/20m/5` 检查。没有重启 OrbStack、没有修改媒体内容。
- TTS LaunchAgent 首次 `manage-qwen3-tts.sh --apply` 在 `launchctl bootstrap` 报 I/O error；检查确认服务已停止，随后手动 `launchctl bootstrap gui/501 .../com.amadeus.qwen3-tts.plist` 成功。health 恢复 ready；本机短句合成返回 HTTP 200 / audio-mpeg（24,812 bytes），容器经 9Router 的同一 TTS 路径返回 HTTP 200 / audio-mp3（22,796 bytes），均约 8 秒。随后用户确认“现在正常了”，WhatsApp 端到端语音回复验收通过。
- `doctor.sh` 当前仅报告可选 media-organizer-adapter 缺席；外部存储身份和 Immich upload 挂载边界通过，其余服务 health 通过。

详见 `.agent/checkpoints/2026-09-25-amadeus-1.5.8-formal-release.md`、`.agent/checkpoints/2026-09-25-amadeus-1.5.8-whatsapp-voice-acceptance.md` 与独立的 daemon log-policy follow-up。

## 2026-09-25 UTC：外部存储门禁 warning 根因已定位（只读检查）

1.5.6 部署后的 `LOG_POLICY=warning` 和 `POST_DEPLOY_MAINTENANCE=warning` 不是因为 Avalon 磁盘掉线：本机 `diskutil` 确认 `/Volumes/Avalon` 已挂载，配置 UUID 匹配、设备与 root 分离，sentinel 也匹配。实际失败点是两项 post-deploy 检查复用迁移型 `storage-preflight.sh`，还要求 Ubuntu/OrbStack guest 内存在旧 Immich 源 `/DATA/Gallery/immich`；只读检查发现该路径在 guest 缺失（旧源保留在 guest 外）。预检随后把 source stats 失败和 free-space unknown 汇总成模糊的“verified external storage unavailable”。

因此 Docker 日志策略没有应用，post-deploy cleanup/GC 没有执行；未绕过门禁、未修改 runtime 或 Avalon 媒体数据。下一步是让这些 post-deploy callers 在需要时验证挂载 UUID/sentinel/目标路径，而不要把 legacy migration source 当作前置条件；迁移复制检查仍须保留 source 校验。详见 `.agent/checkpoints/2026-09-25-postdeploy-storage-gate-diagnosis.md` 与更新后的 `.agent/tasks/2026-09-26-post-deploy-storage-gate.md`。
## 2026-09-25 UTC：Amadeus 1.5.6 正式发布完成

Owner 在 1.5.5 hotfix candidate 上确认“现在好了”后，明确要求正式发布。按唯一版本入口从 1.5.5 patch bump 至 1.5.6，release commit `bdcc07c` 已 push；`./scripts/deploy-openclaw.sh --apply --build-auto` 正式部署完成。

OpenClaw image：`local/openclaw-amadeus:git-bdcc07c43afc-20260925183945`（UTC 2026-09-25 18:39:45；Asia/Shanghai 2026-09-26 02:39:45），Product Radar 复用现有 image。回滚 checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925183945`，已验证 WhatsApp npm projects 目录备份（71,207,880 bytes）；部署 evidence `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925183945`。OpenClaw/Product Radar health、NAS SSH smoke 通过；OpenClaw healthy/restart=0、WhatsApp linked/connected/healthy，唯一 runtime 在线。正式 release outbox sent，outbox smoke passed。Live image 已确认包含 Japanese audio Skill、active-lease 注入和 Chinese-only PTT fail-closed guard；四个 WhatsApp lifecycle/FIFO/text/audio-guard markers 各一次，monitor `node --check` passed。

发布后两项非阻断 warning 再次发生：verified external storage 不可用，故 Docker log policy 未应用，post-deploy storage maintenance/GC 未执行；没有绕过门禁。详见外部 evidence 的 `log-policy.log` 与 `storage-maintenance.log`，跟进任务 `.agent/tasks/2026-09-26-post-deploy-storage-gate.md`。可选 media-organizer-adapter 缺席，本次 network smoke 跳过；它不影响语音功能但其媒体 capability acceptance 仍独立 pending。

1.5.5 candidate 已由 owner 实际验收，1.5.6 同代码正式发布完成；后续无需再做同一规则的候选确认。详见 `.agent/checkpoints/2026-09-25-amadeus-1.5.6-formal-release.md`。

## 2026-09-25 UTC：1.5.5 日语语音注入 hotfix 候选已部署，待实测

Owner 反馈正式版语音仍为中文。脱敏 trace 的最新 inbound audio 对应 Chinese-only assistant final，没有 `日本語：` 行和 TTS directive。根因已定位：pinned OpenClaw 2026.9.4 `message_received` mapper 不传 `runId`，而旧 tracker 强制要求 runId，所以语音 Skill 没有注入该实际请求。

已修 tracker：音频入站若 runId 缺失，先用可信 sessionKey 暂存，随后在当前 `before_prompt_build` 绑定真实 runId，并在 `agent_end` 清理；WhatsApp/audio gate、10 分钟 TTL、128 项上限和 typed-only 防泄漏保持。回归测试模拟 pinned event/context 都无 runId，确认 voice Skill 注入，结束后 typed-only 不继承。

Hotfix commit `24f9d0b` 已 push，并以同版本 `VERSION=1.5.5` 做单实例 candidate apply。OpenClaw image `local/openclaw-amadeus:git-24f9d0bff630-20260925175320`，rollback checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925175320`；checkpoint manifest 确认备份 WhatsApp npm projects 目录（71,206,995 bytes）。OpenClaw healthy/restart=0，WhatsApp linked/connected；唯一 runtime。实机 bundle 已含 Japanese policy、session-key fallback 与 agent_end cleanup，生命周期/FIFO/日文文字三个 WhatsApp markers 各一次。

**尚无 hotfix 后的手机端实测**。请再发一条语音并明确说“请用汉语回答”：应收到日语 PTT、与其一致的日文行和中文摘要；文字输入保持原行为。通过实测前不 bump 到 1.5.6。详见 `.agent/checkpoints/2026-09-25-amadeus-1.5.5-japanese-audio-injection-hotfix-source.md`。

## 2026-09-25 UTC：Amadeus 1.5.5 正式发布已部署

用户明确要求将语音音频固定为日语后“正式发布”。`VERSION` 已按唯一入口从 1.5.4 patch bump 至 1.5.5，release commit `07918b6` 已 push，正式部署通过 `./scripts/deploy-openclaw.sh --apply --build-auto` 完成。

OpenClaw image：`local/openclaw-amadeus:git-07918b6aea33-20260925164645`（UTC 2026-09-25 16:46:45；Asia/Shanghai 2026-09-26 00:46:45），Product Radar 镜像复用。CasaOS 回滚 checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925164645`；外部部署 evidence：`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925164645`。OpenClaw/Product Radar health 通过，OpenClaw restart=0，WhatsApp linked/connected/healthy；唯一 runtime 仍在线。正式 release outbox 状态为 sent。

发布后日志策略和存储维护仍被 verified external storage gate 阻止，分别记录 `LOG_POLICY=blocked; verified external storage is unavailable` 与 `REASON=verified external storage gate failed`；没有绕过门禁，也未执行日志策略/GC。该重复 warning 记录在 `.agent/tasks/2026-09-26-post-deploy-storage-gate.md`。本次正式发布按 owner 直接授权，没有单独候选阶段；**新规则的真实手机端语言行为仍待用户实测**：语音输入明确要求汉语时音频应仍为日语，typed-only 文字行为应保持不变。见 `.agent/checkpoints/2026-09-25-amadeus-1.5.5-formal-release.md`。

## 2026-09-26：Amadeus 1.5.4 正式发布已部署

Owner 已确认日文可见文字修复“没问题了”。按唯一版本入口将 `VERSION` 从 1.5.3 patch bump 至 1.5.4；release notes 已只保留本次说明。release commit `ac179bb` 已 push，并以 `./scripts/deploy-openclaw.sh --apply --build-auto` 完成 CasaOS 正式部署。

正式 OpenClaw image：`local/openclaw-amadeus:git-ac179bbd28b9-20260925161434`；Product Radar 镜像复用。外部 rollback checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925161434`；部署 evidence：`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925161434`。OpenClaw 与 Product Radar health、NAS SSH smoke 均通过；OpenClaw restart=0，WhatsApp linked/connected/healthy；WhatsApp lifecycle、ingress FIFO、Japanese visible-text markers 各一次且 monitor `node --check` 通过。唯一 OpenClaw runtime 保持在线。正式 owner release notice 已送达，outbox smoke 通过。

发布后另有两项非阻断 warning：日志策略和 storage maintenance 都被 verified external storage preflight 阻止，evidence 分别记录 `LOG_POLICY=blocked; verified external storage is unavailable` 与 `REASON=verified external storage gate failed`。因此本次未应用 Docker 日志策略，也未执行 post-deploy storage cleanup；详细追查列为 `.agent/tasks/2026-09-26-post-deploy-storage-gate.md`。可选 media organizer adapter 当前缺席，其网络 smoke 按脚本跳过；不影响本次 WhatsApp voice release，但媒体工具 acceptance 仍独立 pending。

版本 1.5.4 正式部署已完成，语音回复 contract 已 owner 接受。详见 `.agent/checkpoints/2026-09-26-amadeus-1.5.4-formal-release.md`。
## 2026-09-25：语音回复已加日文假名/汉字可见行（1.5.3 候选历史记录，已由 1.5.4 正式发布 supersede）

针对用户要求，voice Skill 现输出中文 summary、自然日文汉字+假名可见行、以及匹配该日文行的音频指令；
PTT 发音和 `日本語：` 行必须一致，难读汉字必要时给括号假名。typed-only 保持原来的简体中文文本路径。
此前连续群语音 FIFO 修复（commit `02fdf49`）也包含在该 image 中，因此新的连续 voice turn 会各自回到普通
inbound/TTS 路径，不走会丢失 auto-TTS 的核心 followup routeReply。

来源 commit `fb1d457` 已 push，并以 `--candidate` apply 到唯一 OpenClaw：
`local/openclaw-amadeus:git-fb1d4578bafe-20260925152845`。恢复点
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925152845`，已验证包括完整挂载的
`/DATA/AppData/openclaw/config/npm/projects`（约 71,205,506 bytes）；部署证据在
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925152845`。OpenClaw healthy/restart=0，
WhatsApp linked/connected，ingress-FIFO marker 1 次，镜像 Skill 包含新 `日本語：` 书写规则。匹配 tests、
typecheck、architecture、secrets gates 均通过。

该时点 `VERSION=1.5.3`，为同版本 pre-acceptance candidate；之后用户实测反馈缺少可见日文行，已按上方记录修复、接受并正式发布 1.5.4。候选原计划重测一条 voice DM 和两条连续群 voice：每条应有一个日文 PTT + 一条中文 summary，并额外看到与 PTT 内容一致的日文汉字/假名行；
顺序 FIFO，输入状态覆盖每轮 PTT 与文字发送。该历史验收记录已被 `.agent/checkpoints/2026-09-26-amadeus-1.5.4-formal-release.md` supersede。

## 2026-09-25：9Router 应用层重复代理已关闭

旧机 source-freeze SQLite 确认应用层代理 disabled。M204 保留旧机容器启动代理环境，
通过受保护本地 API 关闭应用层出站代理并清空应用层 URL/no-proxy；外部恢复点
`/DATA/AppData/9router/backups/app-proxy-off-20260925T045736Z`。服务重启后 health 200、
API 鉴权 401、真实 chat HTTP 200 且仅观察到代理 :7897 出站。一次成功不关闭此前的
间歇 DNS/代理回退调查；不要关闭 TLS 证书验证。

## 2026-09-25：M204 9Router 启动代理恢复，间歇故障未关闭

旧 Mac 保留 Compose 有大小写两套 HTTP(S)_PROXY 和 NO_PROXY；迁移后 M204 仅有
9Router Settings 出站代理，容器启动环境缺失。Git 模板与 M204 live Compose 已恢复旧机
代理环境合同，保留当前 immutable image、鉴权、媒体桥接与数据库；受保护恢复点为
`/DATA/AppData/9router/backups/proxy-env-20260925T043942Z`。Compose/health/401/环境
验证通过。真实 `arthur-combo` 首次超时并记录代理失败后直连、`ENOTFOUND`，重试 200；
此项仅完成配置一致性，不是端到端稳定性结案。DNS/代理 fail-closed 见待办。

## 2026-09-24：HostAgent 能耗报告边界收紧（待部署）

针对 16.5% CPU 使用率同时报告 SoC 33.3 mW 的不一致观测，确认 `powermetrics`
短窗口值只代表估算的 SoC 子系统功率，不能作为整机功耗或以 load/CPU 占比反算 W。
本次修正采样解析：缺失的 CPU/GPU/ANE 字段保留 null，不伪装为 0；负的 combined
功率降级。macos-host Skill 明确禁止据此推断时钟门控或把瞬时 W 积分为未经测量的 kWh。
已做本地单测；没有执行 M204 安装、CasaOS 重启或真实外部电表验收。要获得整机 W/kWh，
仍需由用户确认外部电表/智能插座的型号或 Home Assistant 实体，并做连续采样验收。

## 2026-09-24：9router OpenAI/Codex 上游连接已恢复

9router 曾将 OpenAI/Codex 的上游 TLS 请求直接出站，M204 guest 对该路径返回
`ECONNRESET`，客户端看到 500，9router 日志记录 502。代理连通性测试确认
`http://host.orb.internal:7897` 可用；已在 9router 持久化 Settings 中开启该 HTTP 出站代理，
并配置 localhost、Docker 服务名和 LAN 网段为 no-proxy。

Codex provider test 返回 `valid=true`，实际 `gpt-6-astra` chat completion 返回 HTTP 200。
Kiro refresh token 的 `invalid_grant` 仍是独立凭据问题，未修改 Kiro 配置。

## 2026-09-24：9router LAN 访问和密码恢复已完成

M204 CasaOS 的 9router 已从 guest loopback 发布切回 LAN：仓库模板
`infra/docker/homelab/9router/docker-compose.example.yml` 与 live
`/var/lib/casaos/apps/9router/docker-compose.yml` 使用 `0.0.0.0:20128`，保留
`NINE_ROUTER_PORT` 覆盖能力；frpc 公网配置不包含 9router 映射。`192.168.5.3:20128` 的
`/api/health`、`/login` 返回 200，未认证 `/v1/models` 返回 401。

因用户未知旧 dashboard 密码，先在外部恢复点
`/DATA/AppData/9router/backups/access-recovery-20260924T141346Z` 保存 compose、env 和 data，
再通过 CLI token 边界重置并设置临时密码。登录和认证 dashboard smoke 已通过；临时密码不进入
仓库或 checkpoint。

## 2026-09-24：Amadeus 1.5.2 SoC 功耗采集已启用，整机交流功率待外部电表

1.5.2 已部署。root-only `powermetrics` LaunchDaemon 已在 M204 运行并原子更新固定快照，
用户级 HostAgent 校验 30 秒新鲜度。OpenClaw owner host-status 返回 supported；实测样本约
0.016–0.471 W，字段标明 `scope=soc` / `accuracy=estimated_soc_not_wall_input`。该值只覆盖
CPU/GPU/ANE 的 SoC 估算，不能视为 Mac mini 整机交流输入功率。

Apple 官方将 Mac mini 整机功耗定义为从墙上电源测量并包含电源与系统损耗；准确整机 W 仍需
外部电表或智能插座。当前仓库未发现已配置的仪表集成，等待用户提供设备型号或 Home
Assistant 实体后接入。此前基于 CPU、内存等负载估算的 8–15 W 不是 M204 实测值。

## 2026-09-24：Amadeus 1.5.1 Longbridge 日历范围热修复待部署

M204 当前 live OpenClaw/Product Radar 为 1.5.0 镜像；OAuth state、官方 SDK token cache、
MacHostAgent 和 owner channels 已验证。live `amadeus_market_session` 发现 Longbridge
`301600 too many query days`；真实 SDK 探测显示 ±14 天成功而 ±21 天失败。源码已收窄为前后
14 天，显式 start/end 不变，版本已按唯一入口从 1.5.0 推进到 1.5.1。

1.5.1 尚未部署。提交推送后需重建 ARM64 镜像、保留 rollback checkpoint、执行 apply 和
真实 market/host/notification smoke。部署脚本的 dry-run 不发通知；apply 健康检查后发送一次
`amadeus-release:1.5.1`，外部存储维护 gate 失败时还会追加 warning。media adapter 缺失和
Avalon 外部存储 gate 仍按 pending/blocked 记录，不创建替代服务。

## 2026-09-24：Amadeus 1.4.9 OAuth、HostAgent 与镜像验收进行中

M204 已完成 Longbridge OAuth client 注册、浏览器 PKCE 授权和 code exchange；canonical state 与官方
SDK token cache 已同步到外部 `/DATA/AppData/openclaw/data`，HostAgent bearer health 返回 200。官方
SDK ARM64 binding 的 glibc 2.39 约束已由 Dockerfile 私有 loader 处理，构建镜像的 Node 与 SDK import
smoke 已通过。第一次 apply 在切换前发现 M204 没有 `media-organizer-adapter` 容器，部署脚本现会显式
跳过该外部服务并保留 pending 记录，不伪造替代服务。

Longbridge OAuth operator flow 已按当前官方 OAuth 2 流程补齐 S256 PKCE、scope=3 和 callback
state 校验；短期 verifier 只写入外部 0600 请求状态，成功交换后删除。OpenClaw 仍不参与浏览器
授权，token/refresh state 仍在 `/DATA/AppData/openclaw/data` 外部路径。新增回归测试通过；部署脚本的
`--dry-run` 不发通知，`--apply` 会在健康检查后写入并尝试发送一次 `amadeus-release:1.4.9` owner
smoke notification；发布后日志/存储维护失败时还会追加 warning notification。证据见
`.agent/checkpoints/2026-09-24-amadeus-1.4.9-oauth-and-glibc-runtime.md`。

## 2026-09-24：Amadeus 1.4.9 OAuth PKCE operator flow（历史记录）

Longbridge OAuth operator flow 已按当前官方 OAuth 2 流程补齐 S256 PKCE、scope=3 和 callback
state 校验；短期 verifier 只写入外部 0600 请求状态，成功交换后删除。OpenClaw 仍不参与浏览器
授权，token/refresh state 仍在 `/DATA/AppData/openclaw/data` 外部路径。新增回归测试通过；当前
M204 尚未执行用户级 HostAgent `--apply`，也没有 Longbridge client id 或 MacHostAgent token，因此未安装
HostAgent、未执行 OpenClaw 1.4.9 apply。部署脚本的 `--dry-run` 不发通知，`--apply` 会在健康检查后写入并尝试
发送一次 `amadeus-release:1.4.9` owner smoke notification；发布后日志/存储维护失败时还会追加
warning notification。证据见 `.agent/checkpoints/2026-09-24-amadeus-1.4.9-pkce-operator-flow.md`。

## 2026-09-24：WhatsApp direct session identity fallback 已部署

修复后 14:17:47 控制轮确认消息到达并只出站一次，但 adapter 未传 `senderId`/`senderE164`，
identity tool 连续失败。commit `805e6b4` 现从可信 host 生成的 WhatsApp direct session key
恢复 peer identity，仅允许 direct key；22 个 Amadeus tests、typecheck、build、secrets 与 diff
check 通过。M204 当前 healthy 镜像为 `local/openclaw-amadeus:git-805e6b4-20260924064816`，
等待重启后的下一轮 marker；最终 cutover 仍未提交。

## Current Goal — Amadeus 1.4.8 Operation Skuld final cutover and memory continuity

2026-09-24 M204 runtime readiness progress：现场确认 `Amadeus-M204`、`nyannyan`、canonical
`/Users/nyannyan/agent-monorepo`、GitHub `origin/main`（本地 `3a41867`）和 Node/pnpm/Python/
tmux/cloudflared 均符合 workstation addendum，工作区 clean。OrbStack `nyannyan` guest 的
Docker/Compose/CasaOS、Avalon UUID/sentinel（含只读 fsck 通过）、Product Radar、Immich
PostgreSQL restore/API/vector extension/四容器、FashionSigLIP MPS 均已现场验证。Product Radar
绑定 loopback `127.0.0.1:5315`，Immich 绑定 loopback `127.0.0.1:2283`。Owner-channel acceptance
仍 pending；media-organizer-adapter 因只有 state archive 而无可重建 image/compose 仍未恢复，
`DESTINATION_AUTHORITY=NO`，没有执行最终 cutover token。详见
`.agent/checkpoints/2026-09-24-m204-runtime-readiness-progress.md`。

2026-09-24 WhatsApp relink completed on M204: channel status is `linked/healthy/connected`; Telegram remains `ready/connected`. The detached relink worker and its child login processes were stopped after successful linking, so no duplicate login session remains. A bounded recent log window shows six direct WhatsApp inbound markers and six sent-message markers with no extra send marker, but this is not the required single controlled acceptance and does not prove reply content, owner identity, or tool policy. Telegram still has no inbound/outbound activity timestamp. Owner-message acceptance and final-reply correctness remain pending; final cutover is not committed. Evidence: `.agent/checkpoints/2026-09-24-whatsapp-activity-awaiting-telegram.md`.

2026-09-24 Phase 12 passed and Phase 13 is partial. The old Mac `ai.openclaw.gateway` LaunchAgent was disabled and booted out; its plist remains for rollback-only and port `18789` is closed. A fresh unique-runtime probe reports source OpenClaw/Gateway process count 0, one M204 candidate, and `OPENCLAW_ACTIVE_RUNTIME_COUNT=1`. M204 now runs the canonical Compose (healthy, `unless-stopped`, LAN port `18789`) with persisted session isolation (`visibility=self`, `dmScope=per-account-channel-peer`, `groupScope=per-group`) and both owner channels enabled. Telegram is ready and connected. WhatsApp's restored session is server-side logged out; a relink session is waiting for QR scan, so WhatsApp real inbound/outbound and duplicate-response acceptance are not yet passed. Final source retirement/cutover remains uncommitted.

2026-09-24 owner-ingress approval received, but Phase 12 remains blocked. The exact `APPROVE_OWNER_INGRESS_SWITCH_1_4_8` token was supplied; a fresh read-only audit still found the old Mac `ai.openclaw.gateway` LaunchAgent/process active (loopback `18789`, iMessage-only), while M204 has one safe candidate. The gate therefore reports `OPENCLAW_ACTIVE_RUNTIME_COUNT=2` and `UNIQUE_RUNTIME_GATE=BLOCKED`. No owner/public ingress or canonical-config write was performed. M204's effective migration-safe config is the mounted `/run/openclaw-migration/openclaw.json` overlay with loopback binding, Telegram/WhatsApp disabled, `tools.sessions.visibility=self`, and owner delivery disabled. Operator classification/handling of the old Mac Gateway is required before rerunning the gate; this approval does not authorize final source retirement.

2026-09-23 completion update: Phase 7 source freeze is complete for the Amadeus CasaOS runtime. `SOURCE_FROZEN=YES`, the source CasaOS OpenClaw container and Amadeus owner ingress are off, active Avalon-bound consumers are stopped, and the source filesystem has been synced. Avalon has since been physically moved and is verified on M204; destination Phase 8 host/guest preflight passed. A post-freeze audit found a separate macOS `ai.openclaw.gateway` LaunchAgent still running local-only with iMessage enabled; it uses host-local `~/.openclaw` config, not the CasaOS state, and its production-authority relationship remains unclassified. The isolated Phase 10 migration-safe loopback candidate may be tested with every owner/public ingress and owner delivery disabled; classify the LaunchAgent and recheck the unique-runtime gate before Phase 12 owner ingress activation. Final encrypted secret bundle, independently verified cold snapshot, and 16-service HomeLab backup are recorded in `.agent/checkpoints/2026-09-23-openclaw-source-frozen.md`. No destination production runtime or authority switch occurred.

Phase 8 approval has been received and the destination preflight passed. M204 host/guest verified the expected UUID/filesystem/sentinel, capacity, content, artifact hashes, and host/guest write probes. The guest restart completed; six non-Avalon staging containers returned and have no Avalon bind. Keep Avalon consumers and production authority off until their restore/cutover gates pass. Evidence: `.agent/checkpoints/2026-09-23-avalon-destination-preflight.md`.

2026-09-23 Phase 9 OpenClaw cold-state restore passed on M204. The source cold snapshot and encrypted secret bundle were reverified on the destination before apply. Restore matched the authenticated workspace/state and credential evidence; both the Identity and PUBG SQLite databases reported `ok`. The previously reported 84 session/JSONL and 6 transcript counts are invalid: the continuity audit matched arbitrary path substrings and included cache/code assets. The actual primary agent session/transcript store is SQLite. A later read-only destination check found 52 session nodes, 5,684 transcript events, 5,506 active events, 1 archive row, and 2,827 FTS chunks; see the recall audit checkpoint. The restore retained its protected rollback checkpoint and owner/public ingress remained disabled. The old Mac `ai.openclaw.gateway` LaunchAgent remains active and unclassified; do not pass the unique-runtime gate or enable owner ingress until resolved. Evidence: `.agent/checkpoints/2026-09-23-openclaw-destination-restore.md`.

Phase 10 runs on M204 in migration-safe mode: the current immutable ARM64 image is `local/openclaw-amadeus:git-238bb65-20260923171901` with matching host/guest digest, merged preflight passed, container healthy, all channels disabled, no published ports, and owner delivery disabled. The previous image is retained by protected Compose backups. `tools.sessions.visibility=self` is active, so session recall cannot widen across conversations. Phase 11 identity routing passes, and a no-scope reverse probe confirms that a direct-only or group-only fact is not returned from another session; the model calls `identity_resolve(reference=alias)` before `sessions_search` and does not use global `memory_search` first. The two user-specified scoped facts were not written to global `MEMORY.md`; real direct/group channel acceptance remains pending until trusted conversation scope is available. The old Mac host-local LaunchAgent is still unclassified; recheck the unique-runtime gate before any owner ingress. Evidence: `.agent/checkpoints/2026-09-24-conversation-scope-guard.md`.

### Phase history and pre-freeze audit notes

以下各阶段记录中的运行时状态截面于 source freeze 前采集；与当前状态冲突之处以上方完成记录及最终 checkpoint 为准。

- Authoritative scope: `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`. Repository-side hardening/release work and Phase 7 source freeze are complete. Stop before Phase 8 until separate Avalon-move approval is received.
- Phase 1 is implemented: Git context lives under `integrations/openclaw/workspace-seed/`; runtime `/DATA/AppData/openclaw/workspace` is authoritative and prepare seeds only absent paths. Existing files, permissions, symlinks, directories, and `memory/**` are preserved. Explicit sync is plan-only by default and allows one approved file per apply.
- Focused workspace/architecture/session-isolation tests, `pnpm check:architecture`, Python/shell syntax checks, `git diff --check`, and secrets scan pass. Architecture fixtures confirm active old-host and retired-runtime references remain rejected while explicit negative policy text is allowed. Phase evidence: `.agent/checkpoints/2026-09-23-openclaw-workspace-seed-only.md`.
- The 1.4.8 release base (`3d9985c`) is committed and pushed. This follow-up fixes the secret-bundle import/restore policy contract and tracks the HMAC helper plus its end-to-end fixture.
- Phase 2 defines the complete state boundary and records read-only source discovery. WhatsApp credentials are included in the encrypted secret bundle, with approved replacements checkpointed rather than deleted.
- Phase 3 cold snapshot/verify/restore tooling is implemented and fixture-tested. Secret-bundle continuity now matches every opaque credential path, content hash, mode, and source owner; an authenticated HMAC binds that private record set into the snapshot manifest without exposing per-file hashes. Restore normalizes and verifies the OpenClaw runtime owner `1000:1000`.
- Phase 4 evidence emitters are implemented. Live source hashes are deferred until exact source-freeze approval; destination equality is deferred until approved restore. Full `pnpm build`, `pnpm typecheck`, and `pnpm test` pass, along with secrets scan, version check, syntax, and diff checks. Legacy secret bundles can be rewrapped beside their immutable originals; the current-format rewrap passes authentication, full import/decrypt metadata checks, and restore dry-run. `migration-readiness.sh` now performs those real checks against the newest bundle. The 2026-09-23 source bundle's recorded capture time is unknown and remains so in the provenance; a final export is still required after freeze. Clean `7c93b7e` readiness reports 0 failures/0 warnings and doctor reports 0/0. Audit: `.agent/checkpoints/2026-09-23-openclaw-prefreeze-gate-audit.md`.
- Latest full HomeLab backup is verified (16/16 MIGRATE services; 22/22 checksums). M204 guest/Docker/CasaOS and six loopback-only staging services are healthy; unauthenticated 9Router `/v1/models` returns the expected 401, and destination OpenClaw/Product Radar are absent. Source Avalon UUID/sentinel pass; M204 host and guest have no Avalon mount. The rewrapped current-format secret artifact passes real import/restore verification, but its original capture time is unknown; a final export must occur after source freeze. Source remains active; no final cold snapshot/export, destination OpenClaw restore, or owner ingress switch occurred. The exact `APPROVE_SOURCE_FREEZE_1_4_8` token is still required at the Goal boundary.

## 当前状态 — 2026-09-23 M204 非 Avalon 服务恢复（进行中）

- M204 host 已在 `en0` 使用 `192.168.5.3`。Avalon 已连接并由 M204 host 挂载，UUID/sentinel 匹配；guest restart 已完成，`/Volumes` VirtioFS 对 Avalon 的读写恢复。Host/guest 容量、哨兵、Immich media root、最终冷快照和 secret bundle 哈希、HomeLab manifest 及 host/guest 写探针均通过，Phase 8 已通过。Guest Avalon 可用约 985G（13%，低于 20% warning 阈值）。六个 loopback staging 容器已恢复，确认无 Avalon bind。Phase 9 OpenClaw cold-state restore 已通过；目标 OpenClaw/Product Radar 未启动，源 CasaOS OpenClaw 已冻结，生产 authority 未切换。目标内部 `/DATA` 尚余约 374G。
- 最终完整备份：`/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-source-freeze-20260923T111228Z`。16 个 MIGRATE 服务、38 个 artifacts 均通过，22/22 checksums 通过；包含 Immich `pg_dump -Fc` 和 Filebrowser `/database`、`/config` 卷。此前 `20260923T045305Z` 备份仍保留；更早 `044715Z` 备份缺 Filebrowser `/config`，不作为恢复源。
- 重启后目标六项服务 Changedetection、9Router、Filebrowser、Xiaoya、AriaNG、Dashdot 均为 running；Filebrowser 与 Changedetection 报 healthy，其余仅记录容器 running，尚未复验 UI。六项均 loopback-only/无宿主端口且 mount inspection 确认没有 Avalon bind。9Router 未授权 `/v1/models` 的 401 是预期鉴权。Filebrowser 可写 `/DATA` 全视图；Xiaoya 的 SQLite 检查通过；Dashdot guest-root bind 为只读；aria2 后端尚未恢复。
- Xiaoya/Filebrowser/AriaNG/Dashdot image 和 data 经受控 staging 传输。Docker 28.2.2 → 29.8.1 导入后 image ID 被归一化，但 source/target 的 platform、创建时间、全部 RootFS layer digests 和完整 image Config 一致。M204 guest 直连 Docker Hub 超时，因此镜像由源端保存并离线导入；传输 SHA-256 匹配。Xiaoya 私有 AppData 目录为 `700 root:root`。
- Homarr 与 xiaoyakeeper 暂缓，二者都需要 RW Docker socket；Homarr 还发现受保护 secret bundle 尚未覆盖的 `AUTH_SECRET`、`SECRET_ENCRYPTION_KEY`。运行态、决策和验收证据见 `.agent/checkpoints/2026-09-23-m204-service-restore-phase2.md`。
- 直接 Avalon consumers（Immich、media-organizer-adapter、Emby、qBittorrent、aria2、Jellyfin、Alist）保持停止，直至实际磁盘挂载并通过 UUID/sentinel/storage preflight。OpenClaw/Product Radar 受单一 runtime/切换门禁；frpc/Nginx Proxy Manager 受 ingress 门禁；v2raya 另需 host-network 评估。
- OpenClaw cold state 已恢复并与来源快照校验一致；详细计数、rollback checkpoint、失败恢复副本保留、owner-ingress-off 与 Phase 10 候选状态见 `.agent/checkpoints/2026-09-23-openclaw-destination-restore.md`、`.agent/checkpoints/2026-09-23-migration-safe-compose-preflight.md`。旧 Mac 的 `ai.openclaw.gateway` LaunchAgent 仍 active；Phase 10 migration-safe mode 可隔离验证，分类与唯一 runtime gate 必须在 Phase 12 owner ingress 前通过。
- 备份脚本现将卷映射读取放在独立 FD，避免 OrbStack 子进程消费 stdin 导致漏归档；fixture 回归模拟 stdin 消耗并校验两个 Filebrowser volume artifacts。阶段证据：`.agent/checkpoints/2026-09-23-m204-service-restore-phase1.md`。

## 历史记录 — 2026-09-23 M204 服务恢复准备（已过时）

- 已备份源端 16 个 MIGRATE 服务；备份根目录为 `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T025614Z`。校验和、3 份 service-aware SQLite 快照、Immich `pg_dump -Fc` restore-list、加密 secret bundle rehearsal 均通过。备份工具修复覆盖精确 9Router live image、Xiaoya bind 数据与 Alist named volume、缺失路径 fail-closed。
- 9Router 数据归档内的 `data.sqlite` + WAL 在临时副本上 `integrity_check=ok`；泛化 AppData tar 曾报告读取期间文件变化，只作为应急配置归档，不用作数据库权威副本。
- 已从源端 live Docker mount 清点出 7 个直接绑定 Avalon 的服务：Immich、media-organizer-adapter、Emby、qBittorrent、aria2、Jellyfin、Alist。配置继续固定 `/Volumes/Avalon`；实际挂盘并验证身份/sentinel 前不启动这组服务。
- 用户允许先恢复非 Avalon 服务，但源端仍是唯一权威运行时。OpenClaw/Product Radar 等有双跑/重复通知风险的服务以及 frpc/NPM 入口服务遵循各自切换门禁；不会因“无直接 Avalon mount”就提前并行开放。
- M204 的 OrbStack app 进程存在，但 canonical guest 的 Orb CLI 无响应且 Avalon 未挂载；目标尚未恢复业务容器、数据或 secret。等待用户从 M204 OrbStack UI 启动 `nyannyan` guest 后继续。

## 2026-09-22：Amadeus-M204 SSH 访问与终端代理基线（进行中）

用户已显式开始新 Mac 的迁移准备。专用 ED25519 SSH key 已在控制端创建，目标用户
`nyannyan` 已安装其公钥；`ssh amadeus-m204` 实测登录到 `Amadeus-M204` 成功。目标基线为
macOS 27.0 / arm64 / Apple M6 / 24 GiB RAM，根卷约 386 GiB 可用。目标本地 `127.0.0.1:7897`
已验证为同时支持 HTTP CONNECT 和 SOCKS5 的 mixed proxy；`/Users/nyannyan/.zshrc` 已写入可逆
受管终端 proxy block，交互 zsh HTTPS smoke 经代理返回 HTTP 200。

目标当前仍是 clean-host bootstrap 状态：先前由非交互 SSH `PATH` 造成的 `orb` missing 观察已被
更正，实际 CLI 为 `/usr/local/bin/orb`。当前 `orb list` 只显示运行中的 canonical `nyannyan`
noble/arm64 guest；普通 user（UID 501、用户名/hostname `nyannyan`）和 `-u root`（UID 0）的
read-only probes 都通过，`/home/nyannyan` 存在且来宾为 Ubuntu 24.04.5 LTS。因此 destination guest
identity contract 已满足。目标 host 已安装 Homebrew、Node `24.21.0`、pnpm `11.19.0`、Python
`3.11.16`、tmux 和 cloudflared；clean monorepo 已 frozen-lockfile install，非敏感 host profile 已
指向 `nyannyan` / `/Volumes/Avalon`，`bootstrap.sh --check` 通过。guest 内 Docker `29.8.1`、Compose
`v5.5.1`、CasaOS `v0.4.15`、`/DATA/AppData`、`/var/lib/casaos/apps` 和 `amadeus_network` 已就绪，
CasaOS 核心服务 active 且 gateway HTTP 200；OrbStack LXC 的静态 `polkit.service` 失败已记录，未阻断
核心 CasaOS 服务。source-side `migration-readiness.sh` 当前 0 failure / 0 warning、`OPERATION_SKULD=READY`。
`/Volumes/Avalon` 尚未挂载，所以当前只可进入 storage attachment/preflight，不可恢复 secret/data、启动业务
runtime 或 cutover；旧 Mac 的 CasaOS runtime 仍唯一权威，`MAC_MINI_CUTOVER=NOT_EXECUTED`。

目标 Git SSH clone 已验收：用户明确授权目标专用 ED25519 key 作为 GitHub 账号级 Authentication key
使用。初始标准 `git@github.com` clone 失败是因为 target config 仅定义了 alias，且配置文件随后被外部
流程缩为 2-byte 空配置；已备份后改为标准 `github.com` host 使用专用 target-local key，并在 repo local
config 固定 `core.sshCommand`。`git ls-remote` 与 `git pull --ff-only` 成功，clean monorepo 位于
`/Users/nyannyan/agent-monorepo`，origin 为 `git@github.com:ChristmasFox/amadeus-home.git`，验收后
`main` clean at `e9c648d`。没有复制控制端的任意 Git key 或 token。

历史 release/checkpoint 中的 `DESTINATION_MUTATED=NO` 表示当时的 release acceptance 事实；当前应以本记录为准：
`TARGET_HOST_BOOTSTRAP_WRITES=ssh-authorized-key,terminal-proxy,github-account-key,github-standard-ssh-config,clean-monorepo-clone`，无运行时迁移写入。

## 2026-09-21：Amadeus 1.4.5 Operation Skuld final release completed

Amadeus 1.4.5 is released and pushed. Current `main` is clean at `41acb87`; release version is
`1.4.5`. The canonical CasaOS host in OrbStack `ubuntu` is running
`local/openclaw-amadeus:git-47ce26ae82a3-20260921153903`; Product Radar reused its live
`git-16a8c15d727f-20260921082428` image under the affected-only build policy.

Live acceptance passed: doctor has 0 failures/0 warnings; migration readiness reports
`OPERATION_SKULD=READY`; exact 9Router artifact restore rehearsal, scheduler loaded checks, service-aware
SQLite snapshots, fresh Immich PostgreSQL logical dump, encrypted secret restore rehearsal, manifest/
runbook consistency, and safe scheduled GC passed. Storage truth is recorded as `critical` for the
OrbStack guest/internal targets and `warning` for external Avalon, with free bytes above the explicitly
acknowledged 10 GiB hard minimum; no fake healthy state was emitted.

Immich live media remains `/Volumes/Avalon/immich/data`, legacy `/DATA/Gallery/immich` remains
retained, and source reclaim is `PENDING`. Mac mini cutover is `NOT EXECUTED`. Full sanitized evidence
is in `docs/reports/AMADEUS_1_4_5_DEPLOYMENT.md`; external runtime artifacts remain under the
Operation Skuld backup root.

## 2026-09-22：Amadeus 1.4.6 Operation Skuld Cutover Readiness（已完成）

目标文件：`docs/AMADEUS_1_4_6_OPERATION_SKULD_CUTOVER_READINESS_GOAL.md`。

修复 Immich remote checksum equivalence bug（rsync zero-changes 验证）和 storage growth telemetry bug（heredoc MACHINE 变量展开）。新增 7 个切换准备工具链脚本和 2 个测试脚本。Migration manifest 更新为 schemaVersion 3，记录目标身份 Amadeus-M204 / nyannyan（OrbStack: nyannyan，Ubuntu 24.04，strategy: clean-orbstack-ubuntu-guest）。migration-readiness.sh 新增 4 个 1.4.6 gate（destination identity、preparation tooling、checksum fix、telemetry fix），28 个 gate 全部通过。

`VERSION=1.4.6` 已提交并 push；live CasaOS apply 完成，OpenClaw image `local/openclaw-amadeus:git-5baad9571dfc-20260922120543`，Product Radar 复用。Doctor 0/0，`OPERATION_SKULD=READY`，所有 1.4.6 required fields 已输出。Mac mini cutover 未执行，Immich source reclaim 仍 PENDING，destination 未被修改。

部署 evidence：`docs/reports/AMADEUS_1_4_6_DEPLOYMENT.md`；checkpoint：`.agent/checkpoints/2026-09-22-amadeus-1.4.6-cutover-readiness-deployed.md`。

## 2026-09-21：1.4.5 hardening execution state（Phase 0-4 source implementation）

Current target is Amadeus 1.4.5 Operation Skuld final hardening. Phase 0 re-audit is complete
against clean `main` (`0f9521c`) and the canonical CasaOS host in OrbStack `ubuntu`. The live
external volume is near the configured warning threshold (approximately 11% free), so the 1.4.4
`healthy` storage state is not authoritative and must be corrected in source/runtime evidence.
The retained Immich source remains untouched and Mac mini cutover remains explicitly unexecuted.
Phase 0-4 source implementation is now complete: tracked secret migration scripts and non-recursive
fresh-clone runner, real storage severity/history and safe retention GC, service-aware SQLite/
PostgreSQL backup registry, HomeLab explicit classifications and encrypted secret coverage,
manifest/runbook contract checks, and fresh Immich reclaim verification are in Git worktree.
Targeted fixtures pass; fresh clone, full release gate and live acceptance remain. Phase progress is
compactly tracked in `.agent/EXECUTION_PLAN.md`; validation scope is governed by
`docs/VALIDATION_MATRIX.md`.

# Project State

## 2026-09-24：Amadeus 1.4.9 Longbridge OAuth 已就绪，运行时镜像待部署

M204 已完成 Longbridge OAuth client 注册、浏览器 PKCE 授权和 code exchange。canonical state
与官方 SDK token cache 已写入 `/DATA/AppData/openclaw/data` 外部边界并保持 `0600`；HostAgent
用户级 LaunchAgent 已安装，带 bearer token 的 `/health` 返回 HTTP 200。OAuth operator 脚本已修复
Node 24 的 stdin 读取兼容性，并在 `NODE_USE_ENV_PROXY=1` 下完成 token exchange。

官方 `longbridge@5.1.0` ARM64 binding 需要 glibc 2.39；pinned OpenClaw Debian 12 镜像为 2.36。
Dockerfile 已加入 SHA-256 固定的 Ubuntu 24.04 `libc6 2.39` 私有 loader，构建出的 Node wrapper
可在不替换系统 libc 的情况下成功 import 官方 SDK。验证镜像尚未切换 live CasaOS；当前 live
容器仍为旧镜像，市场工具的 live quote/session、重启持久化与 owner notification smoke 待部署后完成。

## 2026-09-24：WhatsApp 身份桥接修复已部署，修复后验收待重发

修复前的 WhatsApp 控制标记只观察到一条回复，但 `identity_bind_channel` 因缺少可信 sender
metadata 返回 `trusted_sender_metadata_unavailable`，未计入 acceptance。commit `a62b2bd` 已让
`before_dispatch` 记录当前入站 sender（5 分钟 TTL），并由 identity context 在工具上下文缺少
`requesterSenderId` 时使用该桥接；E164 fallback 仅限 WhatsApp。定向 test/typecheck/build、
secrets scan 和 diff check 均通过。M204 已加载并运行
`local/openclaw-amadeus:git-a62b2bd-20260924131000`，容器 healthy，owner channels 已重新连接，
修复后 WhatsApp 控制验收等待同一精确 marker 的新一轮私聊消息。

当前门禁：`WHATSAPP_ACCEPTANCE=pending_post_fix_resend`、`TELEGRAM_ACCEPTANCE=pending`、
`DUPLICATE_RUNTIME=not-finalized`、`DESTINATION_AUTHORITY=NO`，最终 token
`COMMIT_SKULD_CUTOVER_1_4_8` 未提供且未执行。运行时回滚 checkpoint、Immich source 和旧 Mac
rollback-only 资产保留；`media-organizer-adapter` 仍未恢复。

M204 workstation handoff 的 pre-cutover 复核也已通过：主机/用户为 `Amadeus-M204`/`nyannyan`，
canonical repo clean，origin 与远端 `main` 一致且 GitHub SSH `git ls-remote` 成功；Node/pnpm/
Python/Git/tmux/cloudflared、OrbStack `nyannyan`、Docker/Compose/CasaOS 和 bootstrap check 均通过。
本机非敏感 profile 指向 `nyannyan`、`nyannyan` 用户和 `/Volumes/Avalon`。旧路径只出现在源迁移映射、
测试 fixture 或禁止性文档中；owner acceptance 和最终 cutover 仍按上方门禁等待。

更新时间：2026-09-21（Asia/Shanghai）

## 当前执行：Amadeus 1.4.4 Operation Skuld 存储与运行时收口（已完成）

目标文件：`docs/AMADEUS_1_4_4_OPERATION_SKULD_STORAGE_RUNTIME_HYGIENE_GOAL.md`。
源码已加入外置 8TB 存储身份与容量 preflight、Immich copy-first/checksum/cutover/reclaim
边界、9Router/Immich/changedetection 迁移清单、metadata-only secret inventory、加密 bundle
导出与恢复演练、service inventory、Docker logging policy、受保护 GC、storage health scheduler
及动态版本 readiness。`VERSION=1.4.4` 已提交并 push；live CasaOS、Immich 外置媒体迁移、
DB backup、日志/GC、scheduler、doctor/readiness 与 owner evidence 均已完成。旧 Immich 源仍
保留，Mac mini cutover 不在本轮。

live evidence：`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-1.4.4-live-20260921T111052Z`。
Immich 源/目标均为 77,726 个文件、130,486,455,925 bytes，切换后的外置盘可用空间约 473 GB；
数据库 dump 可由 live PostgreSQL image 的 `pg_restore --list` 校验。旧源约 130.49 GB，状态为
`SOURCE_RECLAIM_PENDING`，没有执行删除或 reclaim。最终 `doctor` 0/0，`OPERATION_SKULD=READY`，
两个 release/cutover owner `.sent.json` 已确认。Docker daemon 默认日志策略为 `local/20m/5`，
原 `/etc/docker/daemon.json` 已外置备份并保留原有键。

## 当前执行：Amadeus 1.4.3 WhatsApp 私聊隔离（已部署）

根因已确认：WhatsApp DM 未配置 `session.dmScope`，OpenClaw 默认把不同对端复用到
`agent:main:main`；sender tool policy 并不隔离上下文。源码现固定
`dmScope=per-account-channel-peer`、`groupScope=per-group`，部署预检会拒绝共享 DM scope，
并保留非 owner 只读工具 allowlist（`web_search`、`web_fetch`）。

`VERSION=1.4.3`、implementation commit `4c61b1e` 已部署到 CasaOS `ubuntu`。live image 为
`local/openclaw-amadeus:git-4c61b1ef2b02-20260920155823`，Product Radar 复用
`local/product-radar:git-4d11f3e02074-20260920153810`，checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920155823`；OpenClaw/Product Radar
healthy，运行时 session scope 已独立核验。部署通知稳定 key 为 `amadeus-release:1.4.3`，对应
生产 outbox `.sent.json` 已确认。旧共享 `agent:main:main` 不再承接 WhatsApp DM，暂保留未删除。

## 当前执行：Amadeus 1.4.2 Worldline 与 Operation Skuld（已部署）

目标文件：AMADEUS_1_4_2_WORLDLINE_UNIFICATION_AND_SKULD_READINESS_GOAL.md。
当前源码已加入统一的 WorldlineNotificationIntent、正式主题词汇、确定性主题 policy、
validated owner presentation 和 owner outbox producer inventory；Product Radar generic core
保持平台/主题中立，Product Radar、市场、媒体、HomeLab、PUBG sync、VPS、Codex/release 均在
边界适配结构化事实。Host profile、Amadeus network、FashionSigLIP inventory、Skuld manifest、
迁移 runbook、backup/checksum metadata 和只读 readiness rehearsal 已加入。

`VERSION=1.4.2`、release notes、全量 `pnpm test`/`typecheck`/`build`、secret scan、architecture
fitness、migration-readiness test、脚本语法和 OpenClaw/Product Radar 生产镜像构建均已通过。
implementation commit `af54e7d` 已 push，并已完成当前 CasaOS `ubuntu` apply；live health、preflight、
structured owner outbox smoke、doctor 和 `OPERATION_SKULD=READY` 均通过。deployment evidence 位于
`docs/reports/AMADEUS_1_4_2_DEPLOYMENT.md`。Operation Skuld 仅准备执行清单，不执行 Mac mini
切换；真实自然语言入口与最终用户回复不伪造验收。

## 当前目标

当前唯一产品目标是 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md：把仍有价值的旧
LangBot/n8n/通知能力迁移到 OpenClaw/Kurisu 原生 Amadeus plugin 与独立服务，保留
PUBG plugin/domain、当前 9Router 和必要聊天渠道，删除旧执行路径。

## 2026-09-20：WhatsApp 全量私聊与非 owner 工具隔离（已完成）

- WhatsApp 顶层及 `secondary` 账号当前为 `dmPolicy=open`、`allowFrom=["*"]`、
  `configWrites=false`；Telegram DM 仍为 allowlist。`commands.ownerAllowFrom` 未改变。
- `tools.toolsBySender["*"]` 只允许 `web_search`、`web_fetch`；owner 的 e164 sender policy 为
  `allow=["*"]`，因此非 owner 私聊不会获得文件/exec/节点/自动化/媒体/插件等服务器写入面，
  owner 仍保留完整工具 profile。
- Product Radar 的 create/update/delete/pause/resume/run/context_set/context_clear 已增加
  `senderIsOwner` 门禁。源码最终 commit 为 `4d11f3e`，live 镜像为
  `local/openclaw-amadeus:git-4d11f3e02074-20260920153810` 与
  `local/product-radar:git-4d11f3e02074-20260920153810`。
- 配置前备份：`/DATA/AppData/openclaw/backups/whatsapp-dm-open-20260920T152658Z`；发布
  checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920153810`。最终
  config validate、health/preflight、media network、NAS read-only、owner outbox smoke、
  全量 build/typecheck/test 和 `pnpm check:secrets` 均通过。

## 2026-09-20：Immich 与 9router 更新（已完成）

- CasaOS live compose 已更新：`/var/lib/casaos/apps/immich/docker-compose.yml` 的 Immich
  server 与 machine-learning 从 `v2.5.3` 升至 `v3.2.2`；数据库按官方 VectorChord 迁移路径改为
  `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0`，保留原有
  `/DATA/AppData/immich/pgdata`、`/DATA/AppData/immich/model-cache`、Redis 和
  `/DATA/Gallery/immich` 媒体挂载。
- `/var/lib/casaos/apps/9router/docker-compose.yml` 当前使用仓库 Dockerfile 构建的
  `local/9router:0.5.81`；该镜像基于固定的 `decolua/9router:0.5.75` 安装 npm `9router@0.5.81`，
  使用直接 server 入口运行。端口 `20128`、`/DATA/AppData/9router/data` 和运行时 secret 均未改变。
- 更新前恢复点：Immich 数据库 dump/compose 位于
  `/DATA/AppData/immich/backups/pre-update-20260920T132238Z`；9router data/compose 位于
  `/DATA/AppData/9router/backups/pre-update-20260920T132238Z`，旧 9router 镜像保留为
  `decolua/9router:rollback-20260920T132238Z`。
- npm 0.5.81 切换恢复点：`/DATA/AppData/9router/backups/pre-npm-0.5.81-20260920T142239Z`；
  旧运行镜像另保留为 `local/9router:rollback-0.5.75-20260920T142239Z`。
- `docker compose config --quiet`、Immich 四个容器 healthy、VectorChord/pgvector/旧 vectors
  扩展可用、Immich `/api/server/ping` 返回 `pong` 均通过；公网 Immich 返回 200，9router
  dashboard 返回 200，未带 API key 的 `/v1/models` 保持预期 401。未修改媒体文件、Caddy、frps、
  OpenClaw 或 Cloudflare 配置。

## 2026-09-20：Amadeus 1.4.1 live release 已完成

PUBG 的 10 个 native tools 由唯一 `PUBG_PRESENTATION_REGISTRY` 覆盖，工具 envelope 保留原始
facts/evidence 并额外返回 validated `presentation` 与 deterministic `displayText`；周期复盘由
Domain 消费新鲜 `resultSetId` 并按搜索顺序逐局获取，partial/no-match 不被补成确定事实。Owner
outbox 新写入只接受结构化 contract，长消息分片保留 facts、更新时间、closing 和幂等 key；旧
`title/message` 只在 pending drain 读取兼容。SOUL、架构递归扫描和版本算法 fixtures 已同步。
当前 `VERSION=1.4.1`，implementation commit `032e314` 已 push；live OpenClaw image 为
`local/openclaw-amadeus:git-032e31477b45-20260920065322`，Product Radar 复用
`local/product-radar:git-7d85bc10f15d-20260920041059`，外部恢复 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920065322`。health、preflight、外围 smoke、
legacy runtime retirement 和 `doctor.sh`（0 failure / 0 warning）均通过。真实 Telegram/WhatsApp
自然语言入口和最终用户回复未通过未经请求的群聊消息伪造，仍记录为 pending。

## 2026-09-20：PUBG 队友动作/误伤批量 Telemetry contract（1.4.0 已部署）

真实 WhatsApp trajectory 审计确认，“昨天队内误伤情况详情”和“昨天007踢了004几脚”均只
触发 `pubg_search_matches`，没有进入 Telemetry；基础 Match API 的 `coverage=OK` 被误读为
细节完整，现有单局 `pubg_get_review_facts` 也没有周期批量能力。新增的
`pubg_query_team_damage` 在 Domain 内完成语义周期解析、Match refresh、逐局 Telemetry ensure、
全方向/定向聚合、KICK/PUNCH 筛选及 partial/null 语义，Skill/plugin manifest/preflight 已同步。
本地 Domain 22/22、Plugin 9/9、全仓 build/typecheck/test、architecture、secrets 和 workflow verify
均通过。版本 `1.4.0` 的实现提交 `6ee03d0` 已 push 并完成 CasaOS apply；live OpenClaw image
为 `local/openclaw-amadeus:git-6ee03d0617fd-20260920044911`，Product Radar 复用
`local/product-radar:git-7d85bc10f15d-20260920041059`，外部 checkpoint 为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920044911`。

部署和独立 live 核验均通过 OpenClaw/Product Radar health、媒体网络、NAS 只读、owner outbox、
旧 runtime retirement、`pubg_query_team_damage` tool/Skill 加载和 `doctor.sh`（0 failure/0
warning）；真实 Telegram/WhatsApp 自然语言入口仍按边界保持 pending。

## 2026-09-20：版本递进规则调整

当前已部署版本保持 `1.4.0`；从下一版本起只使用 `scripts/amadeus-version.sh bump patch`，每次按
`0.0.1` 递增。patch 位为 `0..9`，到 9 时进位到 minor（`0.9.9 -> 0.10.0`）；minor 位为 `0..99`，
到 99 且 patch=9 时进位到 major（`0.99.9 -> 1.0.0`）；不再使用或支持 `bump minor`、`bump major`。
本策略只影响后续 release，
不需要重新部署当前已经匹配 1.4.0 的 live image。

## 2026-09-20：Amadeus 架构收敛 Phase 1-2（已完成）

远端新增的 `docs/AMADEUS_ARCHITECTURE_CONVERGENCE_GOAL.md` 已 rebase 到当前 `main`。
Amadeus 仍是单一 OpenClaw plugin，但 `src/index.ts` 已变为 thin bootstrap，Identity、Product
Radar、Media、NAS、HomeLab、KOOK、Market、Notification、VPS 各自拥有 registration module，
shared wrapper/lifecycle 负责公共边界。global `before_prompt_build` Identity/PUBG guidance 已删除；
capability workflow 已归还各自 Skill，SOUL 只保留 Kurisu persona，workspace AGENTS 只保留通用
runtime invariant，宽泛 meme trigger 已收紧。Phase 1-2 的 Amadeus/Identity/PUBG 定向测试和
typecheck 通过；后续 Phase 3-5 已在下方完成，release/deploy 尚未执行。

## 2026-09-20：架构收敛 Phase 3-5 已完成并已部署

- `packages/presentation` 提供 PUBG 单局/周期复盘与 owner notification 三类 contract，包含 runtime
  validation、evidenceRefs、null/unknown 语义、北京时间友好 formatter 和 deterministic renderer。
- Owner outbox producer 已统一为结构化 `owner_notification`；OwnerNotifier 发送/重试前 hard validation，
  旧 `title/message` pending 文件只在读取时兼容迁移。PUBG review tool 返回 validated presentation，
  market/media/HomeLab/PUBG sync/Product Radar/Codex hook 均已迁移。
- PUBG 03:00/09:00 relative-period、explicit range 与 calendar report 分离回归通过；PUBG plugin local
  display fields 使用统一 formatter，默认正文不输出实现时区/日界线 metadata。
- 已加入根 `AGENTS.md` ownership matrix/checklist、`docs/CAPABILITY_TEMPLATE.md`、
  `scripts/check-architecture.mjs` + fixture，并在 `workflow:verify` 中运行。
- 本地 `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm check:secrets`、architecture/workflow tests
  和 `git diff --check` 全部通过；版本 `1.3.0` 的实现提交 `7d85bc1` 已 push 并已完成 CasaOS apply。

## 2026-09-20：架构收敛 1.3.0 live release evidence

- live OpenClaw image：`local/openclaw-amadeus:git-7d85bc10f15d-20260920041059`；Product Radar image：
  `local/product-radar:git-7d85bc10f15d-20260920041059`。
- external checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260920041059`。
- deploy 输出：OpenClaw/Product Radar health、media adapter network、NAS read-only、owner WhatsApp
  outbox smoke 和 retired runtime 检查全部 PASS；`doctor.sh` 0 failure / 0 warning。
- live runtime：Amadeus loaded with 19 native tools and owner notification worker；PUBG loaded with 8
  tools；全部新增 capability Skills、PUBG/owner presentation bundle 和六个预期 cron 已核实。
- 未发送未经请求的真实群聊测试消息；真实用户入口自然语言验收继续保持 pending，未把工具/preflight
  证据伪装成 inbound/final-reply 验收。

## 2026-09-20：VPS Caddy 多服务公网入口已恢复

- 根因：Cloudflare DNS 已指向 VPS，但 `/etc/caddy/Caddyfile` 缺少已有 frps 映射的
  `jellyfin`、`aria`、`qb`、`monitor` 和 `9router` HTTPS site，Cloudflare 返回 `525`。
- 已补齐 Caddy 路由：`jellyfin.nyannyan.top` → `127.0.0.1:8097`、`aria.nyannyan.top` →
  `127.0.0.1:6880`、`qb.nyannyan.top` → `127.0.0.1:8080`、`monitor.nyannyan.top` →
  `127.0.0.1:61208`、`9router.nyannyan.top` → `127.0.0.1:20128`；此前 Immich 路由为
  `immich.nyannyan.top` → `127.0.0.1:2283`。
- `caddy validate`、平滑 reload、Let’s Encrypt 证书签发和 Cloudflare 公网回源均通过；frps
  `7000` 控制通道、HomeLab frpc 及各服务容器未重启。9Router API 未带 key 时保持 `401`。

## 2026-09-19：美股指数开收盘通知（历史，已由 1.4.9 替换）

- 这一历史实现已在 1.4.9 source phase 中移除；原有通知幂等 key 和 owner outbox 语义保留，
  由 Longbridge-only overview/session workflow 接管。

## Amadeus 版本管理（历史记录，2026-09-19）

当时产品版本为 `1.2.0`，唯一版本源是根目录 `VERSION`；`scripts/amadeus-version.sh` 曾负责
校验和按 patch/minor/major 递增，该历史策略已被上方统一 `bump patch` 进位规则取代。
`RELEASE_NOTES.md` 必须与版本标题一致，并且只写本次版本的简短
新增/修复，不累计历史内容。部署完成 owner 通知自动读取其正文，标题为 `Amadeus <版本> · 世界线收束`，
正文最后追加一次 `El Psy Kongroo.`；`RELEASE_NOTES.md` 不应自行重复写该句，部署边界会做去重保护。

## 部署通知结尾去重（2026-09-19，已部署）

- 根因是 1.1.5 发布说明正文包含 `El Psy Kongroo.`，而部署脚本无条件追加，导致 owner 部署通知出现两遍。
- `scripts/deploy-openclaw.sh` 现在会移除发布说明中独立的同名结尾，再统一追加一次；1.1.7 发布说明不再手写该句。
- 版本 `1.1.7`、提交 `e85ff3c` 已通过 `--apply --build-auto` 部署；复用镜像
  `local/openclaw-amadeus:git-fdf331cbca89-20260919071937`，恢复 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919072713`。实际 owner smoke 通知已核实
  全文只出现 1 次结尾语；live `running/healthy`，health、preflight、媒体网络、NAS 只读和 owner
  outbox smoke 均通过。

## PUBG 全部时间统一北京时间（2026-09-19，已部署）

- 根因是查询边界内部已经正确使用 UTC 表示的 `Asia/Shanghai 06:00` 业务日，但最终展示直接输出
  UTC 时钟组件并误标为 `Asia/Shanghai`，因此出现 `22:00`；不是 9/18 22:00 之后的比赛被排除。
- PUBG tool 现在保留 UTC 原始字段作为机器证据，并输出 `dataUpdatedAtLocal`、`asOfLocal`、各时间字段
  的 `*Local` 版本，以及 `dataSourceRange.fromLocal/toLocal`；所有用户可见时间必须使用这些北京时间字段。
- D-mail 的 `数据更新时间` 同样按 `Asia/Shanghai` 展示；回归覆盖 UTC 到北京时间的换算和用户可见契约。
- 本地 PUBG Domain 20/20、Plugin 9/9、Identity 10/10、Amadeus 11/11、受影响 typecheck/build、
  `pnpm check:secrets` 和 `git diff --check` 已通过。版本 `1.1.5`、提交 `fdf331c` 已通过
  `--apply --build-auto` 部署；线上镜像为 `local/openclaw-amadeus:git-fdf331cbca89-20260919071937`，
  恢复 checkpoint 为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919071937`；live 容器为
  `running/healthy`，bundle 已核实北京时间字段和规则，部署 health、preflight、媒体网络、NAS
  只读和 owner outbox smoke 均通过。未发送未经请求的真实群聊测试消息。

## PUBG 方向性结果与来源时间范围（2026-09-19，已部署）

- 队友误伤、踢击、拳击等关系事实统一按 `行为者 → 受害者` 处理；“反过来”是独立查询，
  不会把另一方向的正确结果渲染成错误，也不会把两个方向合并。
- 每个 PUBG native tool 输出增加必填 `dataSourceRange`；Telemetry 复盘从当前刷新搜索的
  result set 传递精确来源区间，并要求最终回复同时展示 `dataUpdatedAt`、来源时间范围、时区和
  06:00 业务日边界；比较查询分别展示两个分段。
- 本地 PUBG Domain 20/20、Plugin 9/9、Amadeus 11/11、build/typecheck、`pnpm check:secrets` 和
  `git diff --check` 已通过。
- 版本 `1.1.4`、提交 `04e8902` 已通过 `--apply --build-auto` 部署；线上镜像为
  `local/openclaw-amadeus:git-04e8902c815a-20260919064258`，恢复 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919064258`；容器 `running/healthy`，
  live workspace、Skill、native bundle 和启动日志均已核实新契约。

## PUBG 路由事实强制走工具（2026-09-19，已部署）

- 只要消息被识别为 PUBG 并路由到任一 PUBG native tool，用户可见事实必须来自本轮工具返回的
  持久化 SQLite 缓存/更新结果；禁止从会话里的旧 assistant 文本、旧 tool result 或旧复盘结论直接回答。
- 上下文只用于解析人物、时间范围、查询范围和明确的比赛引用；默认查询先刷新比赛发现，再读取缓存，
  只请求新增 Match 或缺失 Telemetry。`refresh=false` 仅在用户明确要求 cache-only 时使用。
- workspace `AGENTS.md`/`SOUL.md`、PUBG Skill、native tool descriptions 和插件回归均已同步；本地
  PUBG Domain 20/20、Plugin 9/9、Amadeus 11/11、build/typecheck/secrets scan 通过。
- 版本 `1.1.3`、提交 `36020fc` 已部署；线上镜像为
  `local/openclaw-amadeus:git-36020fc00a21-20260919062713`，恢复 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919062713`；容器 `running/healthy`，live
  bundle 已核实新规则。

## PUBG 周期复盘排序修复（2026-09-19，已部署）

- 改动范围仅为 `packages/pubg-domain`、`plugins/pubg` 的工具契约和 Skill；全局 OpenClaw/Amadeus
  意图路由没有改动。
- 有周期 selector 且未显式指定顺序时，Domain 默认 `startedAt ASC`；`recentN`/最近一局默认
  `startedAt DESC`；显式 `sort` 保持最高优先级。
- PUBG Domain 新增顺序回归，验证周期返回 `m1,m2`、recent 返回 `m2`；本地 Domain 20/20、Plugin
  9/9、Amadeus 11/11、build/typecheck/secrets scan 均通过。
- 提交 `956853c`、版本 `1.1.2` 已部署；线上镜像为
  `local/openclaw-amadeus:git-956853caa816-20260919060947`，恢复 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919061408`；live 容器
  `running/healthy`，PUBG plugin/tool description/Skill 已在容器内核实。

## PUBG Telemetry 复盘新鲜度修复（2026-09-19，已部署）

- LLM 负责识别 PUBG 操作和周期，工具接受结构化 `relative_period` selector；Domain 确定性解析
  `Asia/Shanghai` 的 `06:00`–次日 `06:00`，不让模型直接计算午夜时间戳。
- `pubg_search_matches` 在 selector/recentN 存在时强制刷新；`pubg_get_review_facts` 必须携带当前
  会话 5 分钟内、由刷新搜索产生且包含目标 Match 的 `resultSetId`，旧会话 facts 不再可直接复用。
- Telemetry 语义为 `HIT`、`FETCHED`、`UNAVAILABLE`；成功抓取使用
  `cacheStatus=FETCHED/cacheLookup=MISS/availability=AVAILABLE`，`cacheLookup=MISS` 不等价于缺少数据。
- 回归验证已通过：PUBG Domain 19/19、Plugin 9/9、受影响 typecheck；版本为 `1.1.1`。
- 提交 `5eaf652` 已通过 `--apply --build-auto` 部署；线上镜像为
  `local/openclaw-amadeus:git-5eaf65238c58-20260919053516`，恢复 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919053516`。容器为 `running/healthy`，
  live bundle、插件注册、hourly `5 * * * *` 与 daily `0 0 * * *` cron 均已核实；部署 health、
  preflight、媒体网络、NAS 只读和 owner outbox smoke 通过。真实 Telegram/WhatsApp 群聊复盘仍待
  用户触发验收。

## PUBG Telemetry 小时预取与 D-mail 汇总（2026-09-19，基础能力已部署）

- `pubg_prefetch_telemetry` 每小时刷新所有配置玩家的比赛列表；Match API 只获取 SQLite 中没有的比赛详情，Telemetry 只处理新对局或到期重试对局，持久化 `HIT/FETCHED/UNAVAILABLE`、重试状态和每轮账本。
- `FETCHED + cacheStatus=FETCHED + cacheLookup=MISS + availability=AVAILABLE` 明确表示缓存为空但官方请求成功、数据已写入缓存；`UNAVAILABLE` 才表示当前不可用。所有 PUBG plugin 输出增加 `dataUpdatedAt`，Skill 要求最终回复携带数据更新时间。
- `pubg_telemetry_sync_report` 统计上一自然日 `00:00–24:00`（Asia/Shanghai），每天 00:00 由 `Amadeus • D-mail` owner 通知发送，正文保留计数、更新时间、重试状态并以 `El Psy Kongroo.` 结尾；交互 PUBG 业务日仍是 06:00。
- 预取默认每轮最多 20 场、并发 2；玩家发现每小时 1 次。官方限制说明见 [PUBG API Rate Limits](https://documentation.pubg.com/en/rate-limits.html)，设计不依赖高频请求。

### Live 状态（已部署，首轮回放通过）

- 提交 `4cf3f40` 已通过 `--apply --build-auto` 部署；线上镜像为
  `local/openclaw-amadeus:git-4cf3f4011d61-20260919045321`，恢复 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919045321`。
- live 已加载 8 个 PUBG native tools；`amadeus-pubg-telemetry-hourly` 为每小时第 5 分、
  `amadeus-pubg-sync-daily` 为每天 00:00，均使用 `Asia/Shanghai`、isolated session 和
  明确 allow-list。每日通知只允许 `pubg_telemetry_sync_report` → `amadeus_notify_owner`。
- 首次手动回放 hourly cron 成功且 `deliveryStatus=not-requested`：
  `dataUpdatedAt=2026-09-19T04:56:42.167Z`、`discoveredMatchCount=118`、
  `newMatchCount=0`、`fetchedCount=0`、`unavailableCount=0`、`pendingCount=0`。
  SQLite 已创建 `telemetry_prefetch_attempts`、`telemetry_prefetch_runs`，账本为 1 次成功运行，
  当前 feature rows 仍为 75；首个真实 00:00 owner D-mail 和真实群聊回复验收待发生。

## PUBG 查询边界加固（2026-09-19，已部署，真实入口验收待完成）

- PUBG 业务日已确定为 `Asia/Shanghai` 的 `06:00`–次日 `06:00`；Domain 默认、配置模板、插件 manifest、Skill、按日聚合和 compare 分段统一该口径。
- API 玩家发现失败时，如果 SQLite 已有比赛缓存，查询返回 `partial`/`STALE` 并保留可用 rows；没有本地覆盖时仍返回 `SOURCE_UNAVAILABLE`/error。
- `pubg_get_review_facts` 现在按 `playerIds` 裁剪人物、队伍摘要、细节事实和 evidence；`queryResolved` 记录实际人物范围。
- 排名、Chicken Index、highlight、trend 和 compare delta 保留未知值为 `null`，不再把未知数据当作零。
- 本地验证：`pnpm test:pubg` 35/35、受影响 build/typecheck、`pnpm check:secrets` 和 `git diff --check` 通过。提交 `1c2a585` 已通过 `--apply --build-auto` 部署，线上镜像为 `local/openclaw-amadeus:git-1c2a585b2eef-20260918172435`，恢复 checkpoint 为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918172435`；live `businessDayStart=06:00`，健康、PUBG runtime tools、owner outbox 和外围 smoke 均通过。仍待真实 Telegram/WhatsApp 群聊入口验收。

## 最新 follow-up（2026-09-19，已部署）

- Owner outbox 已在插件边界隔离手动 VPS cron：检测到 isolated cron session 的
  `:run:manual:` 标记时，正式 `vps-report:<date>:<period>` 会被改写为独立 manual key；正式
  09:30/23:00 运行仍使用稳定 key。部署脚本和 `skills/vps` 也已同步 manual key 约束。
- `prepareIdentitySubject(team=true)` 已修复为保留完整 stats 查询参数，只替换 player identity；
  新回归覆盖 team + selector + metrics + groupBy 等组合，修复此前线上返回
  `plugin_runtime_error`/`SOURCE_UNAVAILABLE` 的路径。
- 部署成功 owner smoke 文案已改为 `Amadeus 迁移验收 · 世界线收束`，并明确 WhatsApp owner
  outbox 的 sent marker 才是送达验收事实。
- 提交 `05b3be7` 已通过 `--apply --build-auto` 部署到 CasaOS；线上镜像为
  `local/openclaw-amadeus:git-05b3be7caa7a-20260918161553`，恢复 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918161553`。健康、插件 preflight、
  owner outbox、Product Radar、NAS smoke 均通过。
- 部署后无投递回放：全队昨天查询返回 11 场、工具失败 0；“胶昨天战绩”成功完成
  `identity_resolve` → `pubg_query_stats`、工具失败 0，并正确返回无比赛记录。未向真实群聊
  发送未经请求的测试消息。

### PUBG 最近一局刷新与增量缓存（2026-09-19，已部署）

- `pubg_search_matches` 对 `recentN` 查询强制刷新玩家比赛列表；`last_n_matches` 统计同样强制刷新。
- Match API 只请求本地缓存中不存在的新比赛，成功后写入 SQLite；没有新比赛时不重复请求详情，直接从缓存返回最新结果。
- Skill、tool description 和 Kurisu 上下文均要求“最近一局/最后一局”先重新搜索，禁止复用上一轮旧 `matchId`；搜索响应的 `queryResolved.refresh` 提供可核对的刷新与缓存计数。
- 本地 PUBG 定向测试已通过；版本从 `1.0.0` 递增到 `1.0.1`。提交 `db0a2df` 已通过 `--apply --build-auto` 部署；线上镜像为 `local/openclaw-amadeus:git-db0a2dfa5c75-20260918164913`，恢复 checkpoint 为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918164913`。OpenClaw/Product Radar health、媒体 adapter network、NAS 只读 smoke 和 owner WhatsApp outbox smoke 均通过；真实 WhatsApp 群聊入口仍待用户触发验收。

## VPS 只读能力子目标（2026-09-18，live 已部署，真实入站查询待验收）

- `plugins/amadeus` 已新增五个结构化、只读 native tools：`amadeus_vps_service_info`、
  `amadeus_vps_live_status`、`amadeus_vps_usage`、`amadeus_vps_system_status`、
  `amadeus_vps_services`，并新增 `skills/vps`。OpenClaw 负责自然语言意图和多工具组合，
  plugin 不实现关键词路由。
- KiwiVM 仅调用固定 `getServiceInfo`、`getLiveServiceInfo`、`getRawUsageStats`；VEID/API key
  从仓库外 JSON secret 文件读取，使用表单 POST，不进入 URL、日志或工具结果。SSH 仅执行固定
  uptime/load/memory/rootfs probe 和 Caddy/Xray/Hysteria2/frps `systemctl is-active/is-enabled`，
  使用独立 key、known-hosts 和受限 SSH user，不暴露通用 shell。
- `/data/vps-usage-state.json` 原子持久化 `lastSuccessfulCounter` 与 `lastSuccessfulAt`，并保留
  返回 stale 完整流量事实所需的上次 quota/reset 元数据；成功查询返回
  used/total/remaining/usedPercent/resetAt/delta/history，API 失败保留上一份成功数据并返回
  `stale/error`，不会把失败当成 0。
- 部署模板和迁移脚本已加入三份 VPS secret mount、状态 checkpoint、VPS Skill preflight，
  并声明 09:30/23:00 `Asia/Shanghai` VPS report cron；KiwiVM secret、受限 SSH key 和
  known-hosts 已在 CasaOS 外部就绪。最新 image/checkpoint 已 apply，Gateway 自然语言 smoke
  实际调用五个 VPS tools 且无失败；晚间 report 已通过真实 WhatsApp provider message ID 和
  outbox `sent` marker 验证，未使用 Telegram/KOOK/group fallback。首次 cron owner-context
  拒绝已由 `c1fe427` 修复，十格流量条硬格式由 `e15607c` 修复。受限 SSH probe/key 已在
  `amadeus-gateway` provision 并通过真实插件调用验证；仍待用户触发真实 WhatsApp 入站查询。

## VPS 订阅流量响应 follow-up（2026-09-19，live 已部署）

- 保留现有 token 和 `/<token>/<format>` URL，不因增加流量显示重新生成订阅链接；动态响应器原样
  返回 `qx.conf`、`server.snippet`、`clash.yaml` 或 `shadowrocket.txt`，并统一设置下载名
  `amadeus-gateway`。
- `Subscription-Userinfo` 和 `X-Amadeus-Gateway-Usage` 使用 KiwiVM 整台 VPS 计数，展示已用、总量、
  剩余、重置时间和 `fresh/stale/unavailable` 状态；当前明确不区分用户、协议或节点。
- 实现与测试在 `infra/vps/subscription/`，Caddy/systemd 模板已同步；新 service 和 Caddy
  均为 `enabled/active`，443/8443 四种原订阅路径正文逐字节保持一致，响应头验证为 fresh。
  apply 前备份位于 `/var/lib/caddy/backups/amadeus-gateway-subscription-20260919084939`，
  外部 KiwiVM credentials 不进入 Git。

## 跨渠道 Identity 实现（2026-09-18，已部署，真实入口验收待完成）

- `packages/identity` 提供 SQLite `persons`、`channel_identities`、`aliases` 和
  `external_accounts`，支持预设导入、跨 Telegram/WhatsApp trusted sender/mention/reply
  绑定、群级 alias 优先级、observed candidate 和 owner-confirmed 升级；不保存完整聊天历史。
- `plugins/amadeus` 新增七个 `identity_*` native tools 及 `skills/identity`。confirmed 绑定、
  alias 和 external account 的写入受 owner/Arthur gate；工具参数是结构化数据，不解析命令或
  关键词。生产身份数据库和预设路径在 `/data` 外部持久化，未把个人 ID/JID 写入仓库。
- `plugins/pubg` 只在 plugin 边界把 Person 的 `provider=pubg` account 转换为配置团队中的
  player id，或通过官方 resolve 得到 account id，再传给 `packages/pubg-domain`；Domain 不
  感知渠道身份。缺少可信 binding/account 时 fail closed，不回退默认队伍。
- 定向 identity、Amadeus、PUBG adapter/boundary 测试和受影响 build/typecheck 已通过；新
  OpenClaw image 已 apply 到 CasaOS，运行时 inspect 显示七个 Identity tools 和 `identity`
  Skill 均 loaded/eligible。线上 SQLite 当前为 `persons=4`、`aliases=8`、
  `external_accounts=4`、`channel_identities=8`；每个当前 secondary WhatsApp 群成员同时保留
  LID 和手机号运行时 binding。
- follow-up 已使用 pinned OpenClaw 2026.9.4 的 typed `before_dispatch` hook 捕获可信
  `replyToSender`，按 session 短时桥接到 Identity tools，并在 `agent_end` 清理；本地测试覆盖
  hook registration、session isolation 和无 metadata 的 fail-closed。`4831659` 又把
  Telegram `text_mention` user ID、同一会话内从 trusted sender metadata 观察到的
  `@username` 对应 ID、WhatsApp `mentionedJid` 和稳定 sender JID 通过同一
  `GatewayRunToolBindings.identity`/sender context 传入；过期/冲突 username fail closed，且不解析
  prompt、昵称或手机号文本。Telegram 镜像 bundle 与外部 WhatsApp package 均已通过版本锚定补丁部署。
- 当前线上镜像为 `local/openclaw-amadeus:git-1ccd6f09c6f1-20260918103442`，恢复 checkpoint
  为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918103442`；外部
  `identity-presets.json` 支持运行后按文件指纹刷新，已确认数据不会被预设覆盖；本次用户提供
  的 4 人昵称/别名/PUBG 映射已加载，随后通过现有 owner-confirmed binding 逻辑完成当前
  secondary WhatsApp 群的 8 条 LID/手机号绑定；线上表计数为 `persons=4`、`aliases=8`、
  `external_accounts=4`、`channel_identities=8`。自然语言 alias resolver 调用和重启后有数据
  持久化仍待用户入口验收。
- 昵称匹配失败的根因已由真实群聊 transcript 定位：模型在“胶昨天战绩”“猴昨天战绩”前没有
  调用 `identity_resolve`，而是沿用旧回复称账号未确认。本轮源码已在 PUBG/Identity Skill、
  Identity/PUBG tool descriptions 和 Amadeus `before_prompt_build` 静态上下文中固定
  `identity_resolve(alias/mention/reply)` → `personIds` → PUBG tool 顺序，并覆盖“胶/猴”示例；
  hook/description 回归断言、受影响 typecheck/build/test 和 secrets scan 已通过；已随 `083f26b`
  构建并 apply `local/openclaw-amadeus:git-083f26b1fb13-20260918125134`，runtime inspect
  已确认 `before_prompt_build` 在线且 `pubg`/`identity`/`amadeus` Skill eligible/model-visible。
  无投递线上 smoke 已确认模型实际调用 `identity_resolve` → `pubg_query_stats`，但第二层发现
  用户提供的 `SG_Labmem007/008/004` 与 production team config 的 `SG_LabmemNo007/008/004`
  不一致，导致 007/008/004 的 canonical player ID 未命中并返回
  `identity_pubg_account_unresolved`。此前同步的临时兼容 alias 已在用户更正原始账号后撤回：
  正确值为 `SG_LabmemNo007`、`SG_LabmemNo008`、`SG_LabmemNo004`。本轮已移除 Git fixture
  和 production team config 中的三个错误 alias，并把外部 `identity-presets.json` 与 Identity
  SQLite 的对应记录改为 `No` 版本且重算 `account_id`。修改前可恢复备份为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918130716-identity-pubg-no-correction`。
  更正提交 `c3ec1ac` 已构建并 apply，线上镜像为
  `local/openclaw-amadeus:git-c3ec1acca74d-20260918130917`，部署恢复点为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918130917`。部署后已修正 preset 原子
  替换留下的 root-only 权限为运行时 `node(1000):node(1000)`、`0600`；“胶昨天战绩”和
  “猴昨天战绩”均实际完成 `read` → `identity_resolve` → `pubg_query_stats`，各 3 次调用、
  0 失败并返回 4 场真实数据。未向群聊发未经请求的测试消息，真实 WhatsApp 入口仍由用户触发验收。
- 真实群聊 transcript 进一步定位到 scope bug：模型传入 `identity_resolve(scope=group)`，旧实现
  把 group 当成 group-only，导致全局预设的“胶/猴”返回 `alias_not_found`，随后错误要求用户
  确认 PUBG ID。本轮已改为 group alias 优先、缺失时回退全局预设 alias，并在 Skill/tool
  guidance 中声明预设成员无需二次确认。提交 `6ec7538` 已 apply，线上无投递 smoke 的“胶昨天
  战绩”实际完成 `read` → `identity_resolve` → `pubg_query_stats`，3 次调用、0 失败并返回
  4 场真实数据；未知或 observed candidate 仍保留确认门槛。
- 第一人称请求的真实群聊 transcript 进一步显示：可信发送者
  `263376739561510@lid` 已绑定 `Arthur`，其 PUBG external account 为 `SG_LabmemNo007`，但模型
  处理“我昨天战绩呢”时错误生成 `team=true`，跳过 `identity_resolve(reference=self)`，随后误报
  Arthur 未绑定账号。本轮提交 `f4abc5d` 已在 dispatch guidance、Identity/PUBG Skill 和
  `pubg_query_stats` description 中强制 `我/我的/本人/自己` 先做 self 解析并传入 `personIds`，
  `team=true` 仅保留给明确的全队请求；已构建并 apply 镜像
  `local/openclaw-amadeus:git-f4abc5dafb60-20260918132941`，恢复点为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918132941`。Identity 10、PUBG domain 9、
  PUBG plugin 9、Amadeus 10 定向测试、受影响 typecheck/build、secrets scan 和部署 smoke 均通过；
  未向真实群聊发送未经请求的测试消息，入口仍待用户触发验收。

## 本轮实现

- 新增 plugins/amadeus：Product Radar、媒体 scan/preview/execute、NAS、HomeLab、
  KOOK current-channel lookup、VPS read-only capability、owner notifier 和 retry worker。
- Product Radar 已去除 LangBot/Telegram/KOOK notification bridge，业务事件改写
  channel-free owner outbox。
- Codex completion/failure/cancel hook 改为写 owner outbox；OpenClaw worker 是唯一
  WhatsApp owner delivery。
- 科技情报早报/晚报能力已从 Amadeus plugin、部署配置和 cron 中删除；VPS 晨间/晚间
  状态通知继续保留，并通过固定只读工具和 owner outbox 投递。
- NAS 控制脚本移到 infra/macos/nas-control.sh，旧 LangBot plugin 源退出主链。
- CasaOS 模板、OpenClaw workspace、部署脚本和配置已切换到 Amadeus。
- 全局 `workspace/AGENTS.md` 只保留架构、工具真实性、会话、owner 通知和副作用安全原则；
  PUBG 身份、selector、Telemetry、比较和证据规则全部位于 `plugins/pubg/skills/pubg/SKILL.md`。
  `SOUL.md` 只描述 Kurisu 的通用行为，不把全局上下文锁成 PUBG-only。
- `openclaw_prepare.py` 只验证 OpenClaw 当前 secret 文件，不读取旧 LangBot DB 或旧凭据；
  Codex hook 会把事件写入远端 OpenClaw owner outbox。
- OpenClaw owner agent 使用 `tools.profile="full"`；WhatsApp owner identity 仍由
  `commands.ownerAllowFrom` 和外部 owner target 注入，新增 native tools 不会再次被 PUBG-only
  allowlist 隐藏。
- 删除/退休清单已落到新部署入口：LangBot、n8n、n8n-sandbox、旧业务插件、旧通知/
  watchdog/workflow/facade 路径。

## 部署构建优化（2026-09-18，已用于本次 Identity 发布）

- `scripts/deploy-openclaw.sh --apply --build-auto` 从 CasaOS 当前容器 image tag 读取 source
  commit：只要 `plugins/pubg`、`plugins/amadeus`、`packages/pubg-domain` 或 OpenClaw
  Dockerfile 变化才构建 OpenClaw；只有 `apps/product-radar` 变化才构建 Product Radar。
- `--apply --no-build` 复用现有 immutable images，但发现业务 source 超出 image commit 时
  fail closed；`--build-openclaw`/`--build-radar` 支持单镜像发布，`--build` 仍是全量入口。
- 选择性发布使用受影响 package 的 build/typecheck/test；本次 `--build-auto` 只重建了
  OpenClaw，复用了未受影响的 Product Radar image。

## 真实切换前 baseline

在本次 apply 前，CasaOS 仍有旧 langbot、langbot_plugin_runtime、n8n、
n8n-sandbox-api，以及独立的 Product Radar、media-organizer-adapter、changedetection、
9Router 和旧 OpenClaw。旧 LangBot Telegram bot 已禁用；KOOK token、NAS SSH key 和
WhatsApp owner target 只在切换脚本中从外部运行状态恢复，绝不打印或提交。

## 前一阶段线上状态（2026-09-18，Identity 发布前）

- 部署配置 Git commit 为 `42ef93a`；当前运行镜像由 `5fd139d` 构建：
  `local/openclaw-amadeus:git-5fd139d3e58d-20260918081806` 和
  `local/product-radar:git-5fd139d3e58d-20260918081806`。
- 最终 checkpoint：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918082357`。
- OpenClaw/Product Radar health、media adapter network、NAS read-only smoke 和 owner
  WhatsApp outbox smoke 均 PASS；历史 briefing cron 已在本轮退休，VPS morning/evening
  cron 保留。
- `tools.profile=full` 且没有 `tools.allow`；WhatsApp 群组是 open、免 mention，并且没有
  群组级 tools/toolsBySender 限制。WhatsApp owner DM 仍为 allowlist，高风险工具继续按
  owner/confirmation policy 保护。
- `pubg` 和 `amadeus` 均以 `origin= bundled`、`trust= bundled` 加载；旧 LangBot/n8n
  容器、app/data 路径和 KOOK watchdog systemd timer 已退出。watchdog 可恢复副本位于
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918080449/retired-systemd`。

## 验证证据

- PUBG Domain、PUBG plugin、Amadeus plugin、Product Radar 定向测试已通过；Product Radar
  和 Amadeus typecheck 已通过。
- owner outbox 测试确认事件无 channel/recipient 字段，写入原子且幂等。
- live baseline 只加载 `pubg`，`tools.allow` 只有六个 PUBG tool；这是截图中“其他功能以后再解锁”
  的直接原因，已在 Git 模板和部署 preflight 中修复为 full profile + Amadeus plugin。
- OpenClaw Gateway send RPC 已依据锁定 2026.9.4 协议使用 to，不是 CLI 表面的 --target
  字段。
- scripts/deploy-openclaw.sh --dry-run、三次 apply 路径所需的 shell/python syntax、git
  diff --check、最终全量 build/typecheck/test/secrets scan 已通过；最终 apply 以 exit 0
  完成。
- 本次上下文拆分、部署脚本和 Codex hook 修复的本地 build/typecheck/test/secrets scan 已通过；
  Identity reply bridge 随后由 `56a0df5` 发布，trusted channel metadata 又由 `4831659` 发布，见上方
  Identity 线上状态。
- 自然语言 Product Radar 只读 smoke 成功选择 `amadeus_product_radar` 并返回 1 个监控项；
  Codex hook smoke 的远端 sent marker 已确认，outbox event 无 channel/recipient/to 字段。
- OpenClaw 内部 service names 已加入 `NO_PROXY`，修复代理环境下 Amadeus 工具访问 Product
  Radar 的 fetch failure。
- 本次 `29ad1b9` 的 Identity preset refresh 定向测试、受影响 build/typecheck、secrets scan
  和 CasaOS apply 已通过；线上四张 Identity 表仍为 0 行，等待用户填写外部预设。
- `1ccd6f0` 又使 PUBG plugin 的缓存 IdentityStore 在 preset 文件运行后新增或修改时同步
  刷新；Identity 9、PUBG plugin 8、Amadeus 7 定向测试、受影响 build/typecheck、secrets
  scan 和 live apply 均通过。
- VPS 子目标本地验证：Amadeus typecheck/build、9 个 Amadeus tests、脚本 syntax、manifest JSON
  和 `git diff --check` 已通过；尚未把缺失的 KiwiVM/SSH secret 填入 CasaOS，也没有把未部署
  的代码冒充真实 WhatsApp 报告送达。
- 媒体整理继续受 organize-emby-media Skill 的备份、单项、preview-confirm、碰撞检查
  和不修改现有媒体库约束保护。

## 运行与恢复边界

canonical CasaOS target 是 OrbStack ubuntu，Compose 为
/var/lib/casaos/apps/openclaw/docker-compose.yml 和
/var/lib/casaos/apps/product-radar/docker-compose.yml；OpenClaw data 为
/DATA/AppData/openclaw。真实切换前必须生成
/DATA/AppData/openclaw/backups/amadeus-openclaw-<UTC>，并在本机为 Codex hook 生成外部
备份。旧数据库/credentials 只放 checkpoint，不构成 fallback。
## 2026-09-24：WhatsApp direct identity acceptance 已通过

修复镜像重启后的 WhatsApp 控制验收已完成：15:19:17 收到精确 marker，15:19:44 单次出站；
实时 SQLite/WAL 显示 `identity_bind_channel` 返回 `bound`，无
`trusted_sender_metadata_unavailable`。当前 `WHATSAPP_ACCEPTANCE=passed`，但
`TELEGRAM_ACCEPTANCE=pending`、`DESTINATION_AUTHORITY=NO`，最终
`COMMIT_SKULD_CUTOVER_1_4_8` 未执行。证据见
`.agent/checkpoints/2026-09-24-whatsapp-direct-session-identity-fix.md`。
## 2026-09-24：Operation Skuld WhatsApp-only cutover committed

Telegram acceptance is skipped for this cutover and Telegram remains unchanged in the declaration
and runtime configuration. WhatsApp is the only owner-channel acceptance requirement. The exact
`COMMIT_SKULD_CUTOVER_1_4_8` token has been executed: `DESTINATION_AUTHORITY=Amadeus-M204`,
`SOURCE_AUTHORITY=retired`, and `OPERATION_SKULD_CUTOVER=COMMITTED`. Rollback assets, the old
source, and the Immich source remain preserved for the 72-hour rollback window. Final evidence:
`/Volumes/Avalon/backups/operation-skuld/final-cutover-20260924T074756Z`.
## 2026-09-24：M204 LAN bindings restored

The M204 CasaOS user-facing services are now published on `0.0.0.0` instead of loopback-only
bindings. Product Radar, Changedetection, Immich, 9Router, Filebrowser, Xiaoya, AriaNG, Dashdot,
and OpenClaw respond through both `192.168.5.3` and `192.168.5.50`. Internal database, Redis, and
model services remain unpublished. The pre-change runtime backup is external and recorded in
`.agent/checkpoints/2026-09-24-m204-lan-bindings.md`.
## 2026-09-24：Public services diagnosis

The public Caddy/Cloudflare front ends respond, while the declared service hosts return `502`
because M204 has no running frpc tunnel. The old frpc mapping archive remains available outside
Git; no public ingress restore was performed in this diagnostic pass. See
`.agent/checkpoints/2026-09-24-public-services-diagnosis.md`.

## 2026-09-24：frpc and public backends restored

The M204 guest now runs the restored official frp `0.69.0` binary under `frpc.service`. The
source-freeze config was filtered to remove `9router-tcp` and the unavailable Homarr proxy; the
admin UI and Glances source are loopback-only. The Avalon volume passed the host UUID
`0C2CC618-D273-470C-8036-9AD6A0D967D7`, sentinel, and guest external-device checks before the
Emby, Jellyfin, qBittorrent, and aria2 consumers were started. Glances was rebuilt with a read-only
Docker socket and host PID view.

Public probes now return 200/302 for Immich, Emby, Jellyfin, qBittorrent, aria, and monitor; Claw
returns the expected 403 token gate. `9router.nyannyan.top` has no DNS and no frpc mapping. The
local 9Router dependency is retained only on `127.0.0.1:20128` for OpenClaw compatibility; Homarr
remains stopped. The pre-restore runtime copy is external at
`/Volumes/Avalon/backups/operation-skuld/public-backends-before-20260924T090150Z`.
See `.agent/checkpoints/2026-09-24-frpc-public-restore.md`.
## 2026-09-24：Amadeus 1.4.9 Host & Market Awareness（实现中）

远端 `origin/main` 已从 `744379e` 快进到包含权威目标文档的 `1c2162b`。当前 release source
为 `VERSION=1.4.9`：Amadeus market 已迁移到 Longbridge OpenAPI OAuth 2 唯一市场真相源，
OAuth state 使用 `/data/longbridge-oauth.json` 外部持久化并提供 `ready`、`reauth_required`、
`unavailable` 结构化状态；没有账户、余额、持仓、订单或交易工具。公开 market tool surface 为
overview/quote/intraday/session/movers，symbol、前收/涨跌、session/calendar、数值格式、方向 glyph
和 owner event key 由确定性代码处理；旧市场 provider config/transport/parser/fixtures 已删除。

市场运行时现通过官方 `longbridge@5.1.0` Node SDK 的只读 QuoteContext/MarketContext，SDK native
binary 随目标架构镜像安装；`/home/node/.longbridge` 由外部 `longbridge-sdk-home` 持久化挂载，operator
OAuth exchange 与 SDK refresh 均保持 canonical state 与 SDK token cache 同步。deployment checkpoint
会保存该 cache 的受保护副本，不打印或提交 token。

M204 `MacHostAgent` 已进入 source：macOS 原生 bounded collectors、固定 read-only HTTP routes、
launchd persistence artifact、owner-only OpenClaw status/process tools 和 `powermetrics` 独立 degraded
状态。定向 tests、Amadeus typecheck/test、architecture check 已通过。真实 OAuth 授权、重启持久化、
live Longbridge quote/session、M204 本机 telemetry 对照与 release deploy 仍 pending；本节不宣称
`LONGBRIDGE_AUTH=verified` 或 `MAC_HOST_AGENT=healthy`，直到外部运行时证据写入后续 checkpoint。

## 2026-09-24：1.5.3 Voice I/O source candidate

Goal document is now in the worktree from the remote planning branch. Pinned OpenClaw `2026.9.4` supports native inbound audio transcription and `tts.auto=inbound`; the current live 9Router STT route rejects the existing Chat Combo `amadeus-asr` with HTTP 400. A native macOS Qwen3-TTS service and user LaunchAgent source, example OpenClaw config, and focused mock-backed tests have been added, but no real model/profile was installed. `kurisu-v1` reference pair and speech token are absent. Live OpenClaw/9Router, WhatsApp text path and `VERSION=1.5.2` remain unchanged. Direct ASR/TTS, failure semantics, WhatsApp and reboot acceptance, release and push are pending; see dated checkpoint/task.

The pinned Qwen3-TTS Base model and user venv are now staged outside Git on M204 after an external pre-prep metadata checkpoint. A temporary, non-production system-generated reference produced a real MPS warmup (~71 s), Chinese 24 kHz WAV (~3.5 s after warmup) and authenticated loopback MP3 endpoint response; the temporary audio/key/process were removed. Production profile and token remain absent and no LaunchAgent or CasaOS/9Router/OpenClaw live change was made. An idempotent 9Router speech-provisioning source script is dry-run only until upstream ASR route/credentials are verified. The 1.5.3 acceptance matrix remains open.

The host speech token is now generated externally with mode 0600; only the operator-owned production reference pair and ASR/dashboard credentials still block live speech provisioning. No secret value is in Git or checkpoints.

A source-only ASR protocol adapter now lives with the repository-managed 9Router image because the official Qwen-Audio-3.0-ASR-Flash route uses DashScope multimodal-generation rather than standard multipart STT. The adapter has bounded audio conversion, sanitized error categories and a five-minute transcript-only retry cache. A source-controlled pinned WhatsApp ingress patch candidate short-circuits failed direct voice transcription to a text error before Agent dispatch. Neither patch, the new image nor secret mounts have been applied to live M204. Direct cloud/9Router/WhatsApp acceptance and immutable deployment/rollback evidence remain pending.

A source-controlled explicit 9Router speech deploy path now stages an immutable ARM64 image with external old-image export and protected SQLite/compose/env/secret checkpoint, then updates canonical CasaOS Compose without build and checks both 9Router and ASR bridge health. It is dry-run only so far: guest DashScope key and region/workspace URL are absent; the production `kurisu-v1` directory now exists as an empty mode-0700 folder. Live runtime still serves text through old images; 1.5.3 remains unreleased.

The 9Router speech candidate ARM64 image has now been built from committed source and loaded in the M204 guest, with the previous image exported to Avalon. An isolated no-network fixture verified actual Node 22/ffmpeg startup and bridge behavior. The live container/Compose were not changed. A uid-1000/mode-0600 bridge token is staged outside Git. Missing DashScope key/region URL, dashboard access file and production voice reference still prevent direct paid ASR, provider alias apply and WhatsApp release acceptance.

M204's native Qwen3-TTS LaunchAgent is now installed from committed source with a protected external reference/token backup. Real local MPS and authenticated Chinese MP3/Japanese Ogg-Opus smokes, guest-to-host health and launchd process-restart recovery passed. The user-supplied anime-derived sample is private interim material, not evidence of the Goal's original-voice profile quality or third-party rights. 9Router/OpenClaw live routing and WhatsApp acceptance remain unchanged and pending; `VERSION=1.5.2`.

An isolated real 9Router provider/alias fixture revealed a pinned STT alias cache boundary in both 0.5.81 and evaluated 0.5.86: the logical ASR name resolves to OpenAI until a process restart, while direct Self-hosted STT and TTS aliases behave correctly. Source provisioning now requires healthy ASR/TTS endpoints before writes and restarts once after alias creation, with health/API-key verification. No live provider DB mutation or router upgrade occurred.

The operator's existing Qwen 9Router API key was located in an active custom provider at a `qianwenaiapi.com` endpoint. A private synthetic direct Qwen-Audio-3.0-ASR-Flash request succeeded and exposed a different response shape from Alibaba's example; the bridge now normalizes both. The key and endpoint were copied only into protected guest secret/env paths after a consistent DB checkpoint. This existing Qwen platform is not assumed to be the Goal's Alibaba Model Studio authority. An explicit additional flag gates any production QwenAI deployment. Live 9Router/OpenClaw remain unchanged.

An ARM64 image with the corrected QwenAI response normalization was built from Git and loaded only as a guest candidate; network-none 9Router/TTS/ASR alias fixtures passed. The live provider and OpenClaw images remain unchanged. The source deploy path rejects QwenAI without explicit authority opt-in. A direct synthetic request proved the existing key can transcribe, but the original Goal's Alibaba Model Studio authority is not thereby proven or silently replaced.

The operator approved the existing QwenAI endpoint as the formal ASR upstream. First immutable 9Router speech apply automatically rolled back because its API-key probe erroneously expected a 401 from container-local loopback, which upstream permits. A private isolated live-DB copy confirmed both candidate health endpoints; published Mac ingress still requires 401. The source probe now distinguishes those boundaries. Live 9Router and OpenClaw remain on their old images, `VERSION=1.5.2`; no provider alias or WhatsApp cutover occurred.

Canonical M204 CasaOS 9Router now runs the immutable 1.5.3 speech candidate with protected prior-image and SQLite/compose/secret checkpoint. Router, bridge, TTS connectivity and the external API-key gate passed; a synthetic direct bridge request produced a normalized real QwenAI transcript. The original Chat Combo and missing speech aliases are not yet retired/provisioned. Upstream's protected local CLI token has been verified for read-only admin access and added as the default source-controlled provisioning method, avoiding a dashboard-password reset. OpenClaw/WhatsApp remain on the prior text path and `VERSION=1.5.2`.

First 9Router provider/alias apply failed before state mutation because embedded guest checkpoint code was malformed. The source now compiles that generated script in a regression test and sanitizes failures. Live router image/bridge and existing Chat Combo are unchanged; alias provisioning is still pending.

The live 9Router now has deterministic `amadeus-asr`/`amadeus-tts` Self-hosted provider aliases (old Chat Combo retired) with a protected pre-write SQLite checkpoint. Authenticated direct STT and TTS routes returned normalized transcript and valid MP3 respectively; external API-key protection and DB integrity remain intact. The old OpenClaw image lacks ffmpeg needed by its WhatsApp MP3-to-Opus path, so its Dockerfile now declares that dependency and a new immutable image is required. No OpenClaw voice config or real WhatsApp message has been accepted yet; 1.5.3 remains unreleased.

Because the real WhatsApp acceptance must precede the 1.5.3 version bump, a source-controlled explicit `--candidate` OpenClaw apply mode now deploys one canonical runtime with the same immutable-image/checkpoint/health gates while retaining VERSION=1.5.2 and suppressing release announcement/maintenance. This is not a shadow or second Agent. The ffmpeg-enabled image has not yet been built or applied; WhatsApp voice acceptance remains unverified.

OpenClaw candidate is the sole live Agent with native `tts.auto=inbound`, loaded WhatsApp ingress patch and ffmpeg/libopus, but media ASR was blocked by pinned provider HTTP SSRF protection against the private 9Router DNS name. A temporary provider-scoped policy proved the boundary; source now allows private access only for the fixed internal OpenAI-compatible provider. Independently, the ASR bridge's Node 22 fetch cannot directly resolve QwenAI in the guest; the existing host proxy reaches it, so source opts only the bridge child into Node env proxy. Both changes await new runtime acceptance and do not address the separate general 9Router/Codex proxy instability.

An isolated rebuilt 9Router image fixture verified the proxy opt-in is present on the ASR child only and absent from the Next server. Real QwenAI egress after a production image switch is still pending; the unrelated intermittent Codex proxy issue remains separate.

The single live OpenClaw candidate now reaches QwenAI ASR through its native audio capability and 9Router, and Gateway one-shot TTS returns MP3 through the configured `amadeus-tts` route. The scoped SSRF permission and bridge-only env-proxy opt-in passed live synthetic probes with protected checkpoints; both channels remain connected and no false release notification was sent. These results do not establish real WhatsApp inbound/outbound modality, session continuity, tool-path equivalence, degraded text fallback, reboot, quality or latency matrix. The original-voice preference and separate Codex proxy fail-closed task remain open. VERSION remains 1.5.2 pending full acceptance.

A live Gateway one-shot TTS >1,200-character request fails boundedly, and the live OpenClaw image converts Gateway MP3 into valid Ogg/Opus with libopus. These are local pre-send checks; user-visible long-reply text fallback and actual WhatsApp voice-note delivery remain unproven.

The ASR bridge source now has bounded in-flight singleflight deduplication and privacy-scoped structured logs, with fixtures covering concurrent duplicate calls and no transcript/key leakage. This is not yet deployed; the live path remains healthy on the prior immutable image. Real WhatsApp duplicate delivery and across-restart behavior remain unverified.

The bounded ASR singleflight/privacy-logging image is now the sole live 9Router. A new synthetic native OpenClaw transcription succeeded through it and emitted only sanitized metadata; API-key protection remained 401 from published ingress. This does not establish real WhatsApp retry behavior, text fallback, PTT delivery or subjective voice quality. VERSION is still 1.5.2 pending A–L acceptance.

First genuine WhatsApp voice-note inbound passed through channel admission, native ASR, the normal Agent loop and local Qwen3-TTS synthesis, but WhatsApp PTT send failed repeatedly with ffmpeg exit 127; only a text warning/fallback is evidenced. The Node wrapper's globally exported private glibc library path contaminated its subprocess; an explicit loader-path experiment preserved Longbridge and allowed ffmpeg. The Dockerfile fix and isolated-image fixture source are pending immutable build/apply and real owner resend. Two observed TTS syntheses require duplicate analysis; do not claim case B, real PTT receipt, or 1.5.3 release.

The first loader-path image candidate was rejected at the pinned OpenClaw SQLite worker preflight before Compose changed: explicit loader invocation made `process.execPath` the loader and caused an invalid ELF header for a JS worker. The old single Gateway remains healthy with the known PTT failure. Source now keeps Node's original Longbridge private-glibc launcher for worker compatibility and isolates only Debian ffmpeg/ffprobe via a Node executable clean-environment wrapper. This revision is locally syntax-tested but awaits immutable build, isolated image acceptance, candidate apply and real owner resend; VERSION remains 1.5.2.

An ARM64 image with Node-compatible ffmpeg/ffprobe clean-env wrappers passed isolated worker, Longbridge and actual media child-process tests. It has not yet been deployed; the current single OpenClaw candidate remains healthy but its WhatsApp PTT path is known to fail. The corrected fixture source and checkpoint are pending commit before a protected candidate image apply and real resend.

The corrected worker-compatible ffmpeg/ffprobe image is now the sole OpenClaw candidate with a protected checkpoint. The pinned SQLite worker preflight, health and child ffmpeg ABI check passed; WhatsApp is linked/connected and the native audio/TTS config remains active. This is still VERSION=1.5.2 with no release notification. Post-fix real PTT, handset audibility and A–L acceptance are missing; the first pre-fix owner voice produced only a warning/text fallback.

A second genuine WhatsApp voice note at 13:38:54 on 2026-09-25 reached native ASR, Agent and TTS on the ffmpeg-fixed candidate, but Baileys media upload failed on all hosts five times and PTT delivery is not evidenced. The pinned external WhatsApp package handed an Undici dispatcher to Node's `https.request` media upload; a pinned-anchor, idempotent source patch and deploy-time process restart are now under test. This is still `VERSION=1.5.2`; successful handset voice delivery and duplicate-TTS analysis are pending.

The media-agent fix is now applied to the sole candidate runtime with protected external checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925055122`. Its Node process was restarted despite same-image Compose reuse; gateway health and WhatsApp secondary linked/connected passed, and unauthenticated 9Router models remained 401. No post-patch owner voice ingress/handset PTT is yet evidenced. One pre-patch 13:38 input led to five TTS requests and five failed upload attempts; the exact segmentation/retry trigger remains open. VERSION stays 1.5.2.

The fresh post-patch owner WhatsApp Opus note at 13:55:15 on 2026-09-25 produced one successful native ASR, three TTS calls and three successful WhatsApp `Sent media reply` log records at 13:56:17/18/39 with no media-upload failure in this attempt. The pinned audio media send branch sets `ptt: true`. Gateway health and WhatsApp linked/connected remained good. This is transport-send evidence, **not handset receipt or subjective quality**; first-send latency was about 62 seconds, and response segmentation (three media sends for one ingress) still needs analysis. Full A–L acceptance and 1.5.3 release remain pending.

Owner confirmed all three post-patch WhatsApp PTT messages arrived and played on the handset. Read-only structured session events explain their count: one inbound voice, two Agent `tts` tool calls (which auto-deliver media), and one final text which `tts.auto=inbound` voiced. The Agent-facing TTS tool is redundant for automatic voice I/O, not three inbound deliveries. A source candidate denies only that Agent tool while retaining the full owner profile and native final-response TTS; this configuration change still needs checkpointed candidate apply and a fresh one-voice/one-PTT owner retest. Do not release before remaining matrix, quality and reboot checks.

The redundant Agent-facing `tts` tool is now denied in the single live candidate through a protected config-only apply (`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925060705`). Pinned config and tool-policy matcher checks passed; live config retains `tts.auto=inbound`, `mode=final`, WhatsApp linked/connected and Gateway health. A new owner note is still required to verify one final-response PTT without explicit `tts` tool calls. VERSION is still 1.5.2.

The 14:11:58 owner voice attempt on the auto-only candidate still caused repeated voice replies. Read-only session metadata shows three Agent `message(action=send, voiceText=...)` calls; the previously denied `tts` tool was not called, and concurrent group inputs were a different session. The generic message tool is a second path around native `tts.auto=inbound`. A source candidate denies both `tts` and `message` to the Agent while leaving the fixed owner outbox and native channel final-response path intact. The user's persona preference is Japanese by default, switching to Chinese only on explicit request; this has been edited only in the SOUL seed and needs protected workspace sync and live retest. No 1.5.3 release yet.

The Japanese-default, no-Agent-side-send candidate is now live on the sole OpenClaw with protected checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925061743`. Live config readback shows `tools.deny=['tts','message']` and `tts.auto=inbound`. After verifying the runtime SOUL hash matched the prior Git seed, the existing explicit per-file workspace sync applied only the new SOUL, and a single Gateway restart loaded it; seed/live hashes match. Gateway health, WhatsApp linked/connected and unauthenticated 9Router models 401 passed. No post-change handset one-PTT or Japanese-response acceptance is yet recorded; VERSION remains 1.5.2.

The 14:22:11 post-deny owner voice had one ASR, one TTS and one WhatsApp media-send log at 14:22:56; the user reports one reply. Its language was still Chinese. Live USER.md retained a stale `Prefer Simplified Chinese.` line and also has other runtime additions, so full-file seed replacement would lose data. Source now updates the Git USER seed and adds a guarded one-line, dry-run-default migration preserving other content; source config explicitly sets `typingMode=instant`, 3-second keepalive. Pinned WhatsApp typing is best-effort and the client's three-dot display is not yet proven; neither language nor typing fix is deployed yet. VERSION remains 1.5.2.

A protected candidate apply at `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925063005` installed explicit instant/3-second typing cadence. The guarded USER.md migration changed only the stale Chinese-preference line after backup, preserving its other runtime additions, then restarted the sole Gateway. Live USER now prefers Japanese, SOUL already preferred Japanese, and global Agent deny/native auto-TTS are unchanged. Gateway health and WhatsApp linked/connected passed. There is no post-migration Japanese handset/typing observation yet; typing presence remains best effort and may stop before slow TTS media delivery. VERSION is 1.5.2.

At 14:34:50 a genuine short owner note was rejected by the selected QwenAI ASR upstream as HTTP 400 with empty JSON; bridge returned `transcription_failed`/502, causing 9Router to lock its sole STT account for 30 seconds. Subsequent STT attempts in that interval failed closed with a concise text error rather than a hallucinated Agent reply. A previously successful audio sample still returned upstream 200, and a second new clip returned upstream 200 and live `amadeus-asr` HTTP 200 after cooldown at 14:39:26. This is input-specific or upstream-specific rejection of the first clip, not evidence of general key failure; upstream provided no usable error explanation. The 400→502 account-lock amplification is an open reliability issue. Japanese and typing handset acceptance remain unverified; VERSION 1.5.2.

The owner's report of Chinese speech matches the 14:43 tool-using WhatsApp voice turn: `identity_resolve` was used, final text had Chinese characters and no Japanese kana, then a single PTT was sent at 14:44:17. A *later* 14:44:52 voice turn produced Japanese-kana final text and a single PTT at 14:45:28, after the user had already reported the earlier Chinese reply. Language policy is therefore inconsistently followed across tool/result/context paths rather than wholly absent. A SOUL-only source candidate strengthens per-turn Japanese default after Chinese input/history/tool results; no runtime apply or fresh handset acceptance yet.

The strengthened SOUL source is now synchronized to the sole live candidate after protected checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925064813`, exact old-seed hash check, explicit SOUL-only sync and Gateway restart. Live/source SOUL SHA matches; Gateway health and WhatsApp linked/connected passed. A fresh isolated CLI session with Chinese input and no Chinese-output request generated Japanese text (27 kana), without channel delivery. This is not proof of the existing WhatsApp session's tool-using language stability or handset voice. VERSION remains 1.5.2.

Owner confirmed the 14:45 PTT was audibly Japanese, but its inbound voice was spoken in Japanese. That trial supports Japanese-in/Japanese-out delivery, **not** the required default-Japanese behavior for Chinese input. The 14:43 Chinese reply after a tool call remains a counterexample. The stronger SOUL candidate applied at 14:48 has not yet received a new real WhatsApp note. A Chinese-input/no-language-request owner trial is the next discriminator; do not mark language policy or case B complete from the Japanese-input trial.

The owner now requests an additional one-sentence Chinese text message whenever an inbound voice note receives a non-Chinese spoken answer. Source candidate uses the pinned native `[[tts:text]]` audio-only directive with one visible Chinese summary and one spoken Japanese segment in the same final Agent payload. The WhatsApp native audio send branch can send a visible caption as a separate text reply; no new sender, Agent runtime, or translation service was introduced. New Amadeus `voice-reply` Skill owns the capability contract, and config explicitly enables text override while retaining inbound/final Auto-TTS. Pinned parser fixture passes, but image build, candidate apply, actual Skill selection, phone order/count, summary fidelity and Chinese-explicit no-extra-text behavior are unverified. VERSION remains 1.5.2.

The bilingual voice Skill/config candidate is now on the sole OpenClaw ARM64 runtime, immutable image `local/openclaw-amadeus:git-6e004aa1eca0-20260925070633`, protected checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925070633`. Gateway/WhatsApp health and Skill eligibility passed. An isolated, non-delivered CLI prompt described as a voice transcript produced a final with one visible Chinese sentence and a Japanese `[[tts:text]]` block. This is model/contract smoke only, not WhatsApp audio admission, TTS synthesis, phone PTT/text order or summary faithfulness. VERSION remains 1.5.2 pending real acceptance.

The 15:10 real audio attempt produced one successful ASR and a Japanese-only final payload with no visible `中文：` line and no `[[tts:text]]` directive; only one PTT was sent, matching the user's missing-text report. So the transport did not drop generated Chinese text—the model never generated it. A system-level SOUL sentence prohibiting unsolicited Chinese translations contradicted the newly requested voice summary. Source removes that blanket conflict (ordinary typed replies still get no unsolicited translations) and strengthens the voice Skill description to MUST apply for every inbound audio turn. No global prompt-injection hook or second sender/Agent was added. Source not yet deployed; bilingual delivery acceptance remains pending.

The user did not receive Chinese text on the first bilingual candidate because the model returned plain Japanese with no `中文：` line and no TTS text block; one PTT only. Removing SOUL's conflicting blanket translation prohibition and making the Skill description more imperative still did not reliably cause automatic Skill use in an ordinary prompt. To keep the output contract inside the owning Skill without adding keyword routing or global SOUL/AGENTS workflow, source now injects that exact Skill body only for the current verified WhatsApp-audio run using pinned OpenClaw `message_received` and `before_prompt_build` hooks. The bounded tracker stores only runId/expiry (10-min TTL/128-entry cap), and ignores typed/other-channel turns. Architecture checks were narrowed to permit only this explicitly guarded module. Source is tested but not yet built/applied; real dual-send acceptance is pending.

The run-scoped voice-Skill injection source `1c98642` is now on the sole ARM64 candidate image `local/openclaw-amadeus:git-1c986422c6fe-20260925073459`, protected checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925073459`. Candidate preflight, Gateway/Product Radar health, plugin registration, voice-reply eligibility, WhatsApp linked/connected passed. No fresh real WhatsApp audio after this restart yet; bilingual phone delivery remains unverified, VERSION 1.5.2.

Owner clarified the language policy: ordinary typed messages keep the previous Simplified-Chinese default; every admitted voice message gets one Japanese PTT plus one concise Chinese text summary. This supersedes the earlier global Japanese-default design and the voice Skill's explicit-Chinese skip branch. Source now restores Chinese text preference in SOUL/USER and makes the voice Skill unconditional for admitted audio. Typecheck, all 35 Amadeus tests, architecture, user preference migration/parser/secrets checks pass; no apply yet. Live workspace SOUL/USER and plugin image remain to be candidate-updated with a protected checkpoint. VERSION 1.5.2.

The clarified final policy is now configured live on the sole candidate: typed text defaults to Simplified Chinese; every WhatsApp voice turn gets a Japanese PTT plus one concise Chinese summary. Commit `415410e` built immutable image `local/openclaw-amadeus:git-415410e34d44-20260925074349`, with protected checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925074349`. After checkpoint, only SOUL was synced following its prior-seed hash match; the guarded USER migration replaced the old Japanese preference line with Simplified Chinese while preserving other lines. The Gateway was restarted and is healthy; WhatsApp secondary remains linked/connected. No post-change real message has yet verified the final behavior; VERSION remains 1.5.2.

Latest latency sample (2026-09-25 15:51:48 WhatsApp **group** voice, not DM): ASR 0.405 s; agent made two 9Router calls, 15.522 s then 10.685 s (26.207 s total), with an intervening `read` Skill call costing a second model round; TTS host synthesis/MP3 took 34.121 s, and channel media delivery completed ~1.91 s later. Total ingress-to-PTT 63.566 s. The final model payload metadata had one Chinese visible summary and one Japanese hidden TTS block, but logs show only one group media send and no matching separate `Sent message` for Chinese text; do not claim sidecar receipt. The 9Router `IN` field was ~475,996 with ~20,249 cached, units unverified. This group session had 2,878 transcript events across 7 days and 64 messages in the current compiled context. Biggest measured bottlenecks are local MPS TTS (~34 s) and two model turns (~26 s). The adjacent 15:52:25 direct text reply is a separate session and not included. Typed Chinese default/Japanese voice + Chinese summary still needs phone-side retest.

Owner confirms Chinese summary text arrived for the 15:51:48 group voice turn, closing one dual-format delivery observation (Japanese hidden audio block + Chinese summary, one media send). Total was still ~63.6 s. A source optimization explicitly tells the verified-audio turn that the entire Skill is already injected and it must not call `read` merely to fetch it again; the prior redundant first Agent round cost ~15.5 s. Source tests pass but this optimization has not yet been built/applied or measured. Qwen3-TTS remains ~34 s, the largest single observed bottleneck.

The first low-risk optimization is live: on verified WhatsApp-audio runs the full canonical voice-reply Skill is already included, and the prompt now explicitly says not to spend a separate model turn calling `read` to retrieve it. Candidate image `local/openclaw-amadeus:git-68a51e2a96ed-20260925081444` is healthy with protected checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925081444`; WhatsApp remains linked/connected. No post-change real voice timing sample yet, so a ~15.5s reduction is an estimate based on prior redundant read round, not an observed result. Qwen3-TTS ~34.1s remains a separate bottleneck. VERSION 1.5.2.

Post-optimization direct-DM sample (2026-09-25 16:19): inbound 16:19:16.518; ASR ~0.702 s; one OpenClaw model call 16:19:17.417–20.889 (3.471 s) with zero tool calls (no repeat Skill read); assistant metadata contained Chinese visible text and one Japanese audio-only block. 9Router TTS issued once; M204 host synthesis+MP3 took 35.162 s, WhatsApp accepted one PTT at 16:19:58.980; total 42.462 s. This confirms the no-read path structurally, but because the earlier 63.566 s sample was a group conversation, the full 21 s reduction is not a controlled comparison. The largest remaining measured segment is TTS; existing host timing combines generation and MP3 encode. No explicit owner handset confirmation for this specific DM's Chinese text yet. VERSION 1.5.2.

The next optimization step is measurement-only: M204 Qwen3-TTS host logs now split `engine_ms` from `encode_ms`, while retaining total time, decoded audio duration and a coarse input-character bucket; no text/audio/reference content is logged. Python tests pass (5 pass; the MP3/Opus test is skipped in the Mac-side test Python because its optional encoder dependency is unavailable there) and secrets scan passes. Source is not yet committed or copied to the live LaunchAgent. Need protected backup of host `service.py`/plist/runtime state, explicit LaunchAgent apply/restart, then fixed Japanese warm/cold benchmark before choosing any model/quality tradeoff.

A direct Japanese-audio block was 68 codepoints and Qwen engine time 35.162s; output encoding was only ~0.2s. Source now guides the voice Skill to use one Japanese sentence targeted at <=50 codepoints, while preserving the direct answer and critical caveat, with detail in the Chinese summary. This may reduce synthesis but is an unmeasured prompt target, not a performance claim. Source not deployed; needs user listen for naturalness and faithful Chinese summary before release.

A soft one-sentence Japanese spoken-text target (<=50 Unicode codepoints, preserving essential caveats) is live in candidate image `local/openclaw-amadeus:git-4861970f0338-20260925083938`, with checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925083938`. Health and WhatsApp linked/connected passed. This is an LLM prompt constraint and has not yet been measured on a new user voice; no speed or quality claim. Need compare safe engine/audio durations and owner audition before release.

M204 TTS host source now logs separated engine/MP3-Opus encode/audio/total timings plus only a coarse input-length bucket. Before applying, external checkpoint `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/timing-20260925T082939Z` saved old service.py/plist/runtime status; after one bootstrap I/O error, manual launchctl bootstrap/enable succeeded, process running and health 200. Live service.py SHA matches Git. Two controlled/synthetic Japanese MP3 samples measured engine/encode 15.840s/0.337s and 39.733s/0.205s for audio 4.72s/5.04s, indicating high engine variance and negligible packaging but too few samples for optimization choice. A new OpenClaw Skill target prefers Japanese speech <=50 codepoints without dropping safety caveats; no voice turn has exercised it since 16:40. Need owner voice for real before/after; typed group text alone is not TTS acceptance.
