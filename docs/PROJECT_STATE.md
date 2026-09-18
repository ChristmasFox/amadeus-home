# Project State

更新时间：2026-09-18（Asia/Shanghai）

## 当前目标

当前唯一产品目标是 docs/OPENCLAW_AMADEUS_MIGRATION_GOAL.md：把仍有价值的旧
LangBot/n8n/通知能力迁移到 OpenClaw/Kurisu 原生 Amadeus plugin 与独立服务，保留
PUBG plugin/domain、当前 9Router 和必要聊天渠道，删除旧执行路径。

## 最新源码 follow-up（2026-09-18，待部署）

- Owner outbox 已在插件边界隔离手动 VPS cron：检测到 isolated cron session 的
  `:run:manual:` 标记时，正式 `vps-report:<date>:<period>` 会被改写为独立 manual key；正式
  09:30/23:00 运行仍使用稳定 key。部署脚本和 `skills/vps` 也已同步 manual key 约束。
- `prepareIdentitySubject(team=true)` 已修复为保留完整 stats 查询参数，只替换 player identity；
  新回归覆盖 team + selector + metrics + groupBy 等组合，修复此前线上返回
  `plugin_runtime_error`/`SOURCE_UNAVAILABLE` 的路径。
- 部署成功 owner smoke 文案已改为 `Amadeus 迁移验收 · 世界线收束`，并明确 WhatsApp owner
  outbox 的 sent marker 才是送达验收事实。
- 本轮源码验证通过，但未执行 CasaOS build/apply；当前 live image/cron 不因本轮源码修改而变化。

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
