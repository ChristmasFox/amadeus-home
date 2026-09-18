# 当前任务

更新时间：2026-09-18（Asia/Shanghai）

执行唯一目标：完成 OpenClaw Amadeus 全能力迁移。旧 LangBot/n8n/旧插件/旧通知路径全部
退出；OpenClaw/Kurisu 是唯一 Agent runtime。PUBG plugin/domain、当前 9Router、Product
Radar、changedetection、media adapter 和必要聊天入口按边界保留。

## VPS Read-only Capability + Daily Report 子目标（2026-09-18）

当前实现状态：`LIVE_DEPLOYED_REPORT_SMOKE_PASS_INTERACTIVE_INBOUND_PENDING`。Amadeus 已加入五个只读 VPS native
tools 和 `skills/vps`：KiwiVM 固定 service/live/raw-usage API，固定 SSH uptime/resource
probe，固定 Caddy/Xray/Hysteria2/frps service probe；没有 restart/stop/start/reinstall/password
reset/任意 shell/关键词路由。流量状态原子持久化在 `/data/vps-usage-state.json`，以成功 counter/time
为 baseline 并保留 quota/reset 元数据；失败保持上一份成功数据并返回 stale/error。

部署模板已声明外部 KiwiVM credentials、VPS read-only SSH key、known-hosts mount，迁移脚本已
加入 secret 校验、状态 checkpoint、工具/Skill preflight 和 09:30/23:00 Asia/Shanghai VPS
report cron。受限 SSH key/user 和固定 probe 已在 `amadeus-gateway` provision 并通过插件真实
调用验证；KiwiVM secret 已放入 CasaOS 外部 secrets，最新镜像已 apply。Gateway 自然语言 smoke
实际调用五个 VPS tools 且无失败；晚间 cron 已通过 WhatsApp provider 返回真实 sent message，报文
包含十格流量条、增量和四个服务。仍待用户从真实 WhatsApp 入站发送一条自然语言 VPS 查询，以
完成最终聊天入口证据；在该证据出现前不得宣称 Definition of Done。

## 跨渠道 Identity 子目标（2026-09-18）

当前实现状态：`DEPLOYED_LIVE_REAL_INPUT_PENDING`。新增 platform-neutral
`packages/identity` SQLite 库和 Amadeus native Identity tools：
`identity_resolve`、`identity_get_person`、`identity_bind_channel`、
`identity_add_alias`、`identity_link_account`、`identity_list_candidates`、
`identity_confirm_candidate`，以及 `skills/identity`。预设从仓库外
`identityPresetsFile` 导入；文件在 OpenClaw 运行后新增或修改时，会按文件指纹在下一次 Identity
tool 调用前安全刷新，已确认数据不会被预设覆盖；Telegram/WhatsApp sender/account/conversation metadata 只从
OpenClaw trusted context 读取，生产 ID/JID 不进入 Git。

2026-09-18 follow-up 已补上 OpenClaw typed `before_dispatch` → tool context 的短时 reply
metadata bridge，并在 `agent_end` 清理；只保留可信 channel-native sender id，按 session 隔离，
不保存消息正文或显示名。Pinned OpenClaw 2026.9.4 的 Telegram bundle 和外部持久化 WhatsApp
channel package 现在也通过 source-controlled、版本锚定补丁，把 Telegram `text_mention` 的
真实 user ID、同一会话内已由 trusted sender metadata 观察到的 `@username` 对应 ID、WhatsApp
`mentionedJid` 和稳定 sender JID 送入同一 `toolBindings.identity.mentions`/sender context；不从
prompt、昵称、手机号文本或未观察到的用户名推断，过期/冲突用户名 fail closed。该 follow-up 已随
`c33684a` 构建并 apply；随后 `29ad1b9` 增加外部 preset 文件的运行时安全刷新，`1ccd6f0`
补上 PUBG plugin 缓存 IdentityStore 的同等刷新，并完成选择性 build/apply；线上镜像为
`local/openclaw-amadeus:git-1ccd6f09c6f1-20260918103442`，runtime inspect 已确认
`before_dispatch` 和 `agent_end` 两个 typed hook 在线。

PUBG plugin 已在边界消费 canonical Person 的 `provider=pubg` account；没有 binding、没有
PUBG account、alias 仍是 observed candidate 或解析歧义时，返回明确 identity error，不再把
群成员的“我”静默解析成默认队伍。`team=true` 是显式队伍请求。源码、配置、Skill、本地测试和
trusted channel metadata 的 CasaOS build/apply 均已完成；线上运行
`local/openclaw-amadeus:git-1ccd6f09c6f1-20260918103442`。最近真实 WhatsApp 群入站已调用
`identity_resolve(self)` 并返回 `unbound / trusted_channel_identity_is_not_bound`，随后没有调用
PUBG tool；用户已提供 4 个 WhatsApp 人员的昵称、别名和 PUBG 外部账号，外部 preset 已加载为
4 个 Person、8 个 alias、4 个 `provider=pubg` account。随后按用户明确授权通过现有
`identity_bind_channel` 逻辑，为当前 `secondary` 群账号写入 4 人各自的 LID/手机号 confirmed
binding，共 8 条；自然语言请求是否主动调用 alias resolver、真实群内 PUBG 端到端体验和重启后
持久化仍需继续验收。

### 昵称匹配链路修复（2026-09-18）

本轮已确认失败点不是 Identity 数据：已确认昵称和 PUBG account 均存在，真实群聊失败是模型在
“胶昨天战绩”“猴昨天战绩”前直接生成了未确认回复，没有调用 `identity_resolve` 或 PUBG tool。
源码现已把昵称请求固定为 `identity_resolve(alias/mention/reply)` → `personIds` → PUBG tool：
PUBG/Identity Skill、Identity/PUBG tool descriptions 和 Amadeus `before_prompt_build` 静态上下文
均已补上强制顺序与示例，并增加对应 hook/description 回归断言。Amadeus/PUBG typecheck、build、
定向测试、`git diff --check` 和 secrets scan 已通过；已随 `083f26b` 构建并 apply 新镜像
`local/openclaw-amadeus:git-083f26b1fb13-20260918125134`，runtime 已确认
`before_prompt_build` 注册、三个相关 Skill eligible/model-visible。仍待真实群聊重新发送昵称
战绩请求，确认本轮实际产生 `identity_resolve` → PUBG tool 调用。无投递 smoke 已确认这条
工具链已发生，但暴露出第二层配置问题：此前登记的 `SG_Labmem007/008/004` 与现有
`SG_LabmemNo007/008/004` production team names 不一致，导致 canonical player ID 未命中，
随后官方 exact lookup 返回 `identity_pubg_account_unresolved`。当时的临时兼容 alias 已在用户
随后更正原始账号后撤回：三个账号的正确值是 `SG_LabmemNo007`、`SG_LabmemNo008`、
`SG_LabmemNo004`。本轮同步移除了 Git fixture 和 production team config 中的三个错误 alias，
并把外部 `identity-presets.json` 与 Identity SQLite 的三条 PUBG external account 记录改为
`No` 版本，同时重算对应 `account_id`。修改前可恢复备份为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918130716-identity-pubg-no-correction`；
更正提交 `c3ec1ac` 已构建并 apply，线上镜像为
`local/openclaw-amadeus:git-c3ec1acca74d-20260918130917`，部署恢复点为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918130917`。部署后发现 preset 原子替换
留下了 root-only 权限，已将该外部文件恢复为运行时 `node(1000):node(1000)`、`0600`；随后
“胶昨天战绩”和“猴昨天战绩”均实际完成 `read` → `identity_resolve` → `pubg_query_stats`，
各 3 次调用、0 失败并返回 4 场真实数据。为避免未经请求向群聊发测试消息，最后一步仍由用户
在真实群里发送一句昵称战绩请求完成入口验收。

### 群内预设昵称免确认修复（2026-09-18）

随后真实群聊 transcript 显示，模型虽然调用了 `identity_resolve`，但传入
`scope=group`；Identity 旧实现把这个 scope 当成 group-only，因此查不到属于全局预设的
“胶/猴”，返回 `alias_not_found` 后才要求用户确认 PUBG ID。本轮已改为 group alias 优先、
找不到时回退全局预设 alias，并在 Skill/tool guidance 中明确预设成员无需二次确认。提交
`6ec7538` 已构建并 apply，线上无投递 smoke 的“胶昨天战绩”已实际完成
`read` → `identity_resolve` → `pubg_query_stats`，3 次调用、0 失败并返回 4 场真实数据；
未知或 observed candidate 仍保持确认门槛。

### 第一人称 PUBG 身份解析修复（2026-09-18）

新的真实群聊 transcript 显示，当前发送者的可信 WhatsApp LID
`263376739561510@lid` 已绑定到 `Arthur`，外部 PUBG 账号也已是
`SG_LabmemNo007`；但处理“我昨天战绩呢”时，模型错误把请求生成成 `team=true`，跳过了
`identity_resolve(reference=self)`，随后误报 Arthur 未绑定账号。本轮已在 Amadeus dispatch
guidance、Identity/PUBG Skill 和 `pubg_query_stats` description 中明确：`我/我的/本人/自己`
必须先解析当前可信发送者并把 `personId` 传给 PUBG tool；`team=true` 仅用于用户明确要求全队，
不能用于第一人称请求。提交 `f4abc5d` 已构建并 apply，线上镜像为
`local/openclaw-amadeus:git-f4abc5dafb60-20260918132941`，恢复点为
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918132941`。Identity 10、PUBG domain 9、
PUBG plugin 9、Amadeus 10 定向测试及受影响 typecheck/build、secrets scan 和部署 smoke 均通过；
未向真实群聊发送未经请求的测试消息，仍待用户触发一条“我昨天战绩”完成入口验收。

## 当前进度

- 代码阶段：PASS。新增 native plugins/amadeus、owner outbox、VPS 只读通知、
  Codex hook 和 CasaOS 模板；Product Radar 已去掉旧通知依赖；OpenClaw owner 工具策略改为
  `tools.profile="full"`，不再用只包含 PUBG 的严格 allowlist。全局 workspace 已收敛为
  架构、工具真实性、通知和安全原则；PUBG 领域规则全部下沉到 `plugins/pubg` skill，SOUL
  不再固化 PUBG 能力清单。
- 本地测试阶段：PASS。最新 apply 前 build、typecheck、测试和 secrets scan 复跑通过：
  Identity 9、PUBG domain 9、PUBG plugin 8、Amadeus 10、Product Radar 51。
- 部署脚本阶段：PASS。scripts/deploy-openclaw.sh 已改为显式 apply 的一次性迁移入口，包含
  checkpoint、当前 OpenClaw secret 校验、镜像构建、旧 app/data 退休、VPS report cron 和 owner
  WhatsApp smoke；不再从旧 LangBot DB 或旧路径做运行时 fallback。Codex hook 已修复为实际
  使用远端 owner outbox，且不再因缺少 `os` 导入而静默丢弃事件。
- 真实切换阶段：PASS。最新镜像已在 OrbStack Ubuntu CasaOS 运行；OpenClaw、Product Radar、
  media adapter、NAS 只读 smoke、VPS report cron 和 owner WhatsApp outbox 均通过。
- 部署后阶段：PASS。基础迁移 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918082357`；Telegram username/trusted
  channel metadata 的最新 checkpoint 为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918101625`；旧 LangBot/n8n
  容器、app/data 路径和 KOOK watchdog timer 已退休。全局上下文、Codex hook、内部服务
  proxy bypass 和自然语言工具选择均已完成 live 复核。
- Identity preset refresh 部署阶段：PASS。最新 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918103442`；OpenClaw、Product Radar、
  media adapter network、NAS 只读 smoke 和 owner WhatsApp outbox smoke 均通过。外部
  `identity-presets.json` 已由用户提供的 4 人映射填充并经运行时读取验证；当前 Identity 表为
  `persons=4`、`aliases=8`、`external_accounts=4`、`channel_identities=8`。本次绑定前的可恢复
  备份为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918203921-identity-bind`；
  身份数据仍留在 CasaOS 外部运行时目录。
- 部署构建优化阶段：PASS。`scripts/deploy-openclaw.sh` 新增
  `--build-auto`、`--build-openclaw`、`--build-radar` 和 `--no-build`；按 live image 的
  Git commit 选择性构建，并对未构建镜像做 stale check。该流程已用于本次 Identity reply
  bridge，线上镜像和恢复点见上述 Identity 状态及
  `.agent/checkpoints/2026-09-18-openclaw-identity-reply-bridge-deployed.md`。

- VPS live acceptance 阶段：PASS（真实入站查询待用户触发）。最新 checkpoint 为
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918122319`，线上镜像为
  `local/openclaw-amadeus:git-e15607cdbbfb-20260918122319`。两个 VPS cron 为
  `30 9`/`0 23 Asia/Shanghai`，allowlist 仅包含四个 VPS read tools 与
  `amadeus_notify_owner`；OpenClaw 重启后 schedule、VPS usage baseline 和 progress-bar prompt
  均保留。VPS 晨间报告首次暴露的 cron owner-context bug 已由 `c1fe427` 修复；随后 VPS 晚间报告真实发送并以
  `sent` marker 与 WhatsApp provider message ID 验证。最新 `e15607c` 将十格进度条设为 Skill
  和已有 cron 的硬格式。CPU throttling 若 API 返回 unknown 必须继续标为 unknown，不得当作健康。

VPS 子目标当前本地 evidence：`pnpm --filter @agent/amadeus-plugin typecheck`、`build:amadeus`、
Amadeus 10 tests、`bash -n scripts/deploy-openclaw.sh`、`py_compile scripts/openclaw_prepare.py`、
manifest JSON validation 和 `git diff --check` 已通过。
- 昵称匹配修复 evidence：Amadeus 10、PUBG plugin 8 定向测试，受影响 package
  typecheck/build、`pnpm check:secrets` 和 `git diff --check` 已通过；新镜像已 live apply，
  恢复点为 `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918125134`，真实群聊
  端到端无投递工具调用验证已通过（“胶”与“猴”各一次，失败数 0）；未向群聊发送未经请求的
  测试消息，真实 WhatsApp 入口由用户触发验收。

## PUBG-only 根因修复验收

- live `tools.profile=full`，没有 `tools.allow` 严格白名单；WhatsApp 群组为 `open`、
  `requireMention=false`，群组没有 `tools`/`toolsBySender` 限制，因此成员继承完整 OpenClaw
  工具能力，而不是只继承 PUBG。
- `pubg` 6 个工具和 `amadeus` 7 个工具均显示 `origin= bundled`、`trust= bundled`、
  `status=loaded`；这也修复了 Amadeus owner notifier 被非信任插件拒绝的问题。
- WhatsApp secondary account 为 linked/healthy，真实 owner outbox smoke 已生成 sent marker。
  未向群聊发送未经请求的测试消息；群聊能力边界已由 live config 和 plugin/tool inspect 验证，
  可由用户在群内发一条普通能力消息做最终体验确认。

## 迁移后能力选择验收

- OpenClaw 自然语言只读请求成功选择 `amadeus_product_radar`，返回当前 1 个监控项；
  `successfulToolNames` 只有 `amadeus_product_radar`，tool failures 为 0，未发送通知或修改配置。
- Codex hook smoke 已写入远端 outbox 并生成 sent marker；事件没有 channel/recipient/to 字段，
  仍由 OpenClaw owner worker 负责 WhatsApp 送达。
- OpenClaw 内部服务名已加入 `NO_PROXY`，Product Radar 原生工具不会再误走宿主代理；
  `tools.profile=full`、WhatsApp group `open`、免 mention 且无群组工具限制仍保持。

## 不接受的替代

不恢复 LangBot/Mastra/n8n 业务链，不做 shadow/double-run/关键词路由/兼容 fallback；
不把 Telegram/KOOK proactive notification 重新接回；不把真实平台送达用 health、mock、
provider trace 或插件 smoke 冒充。

## 恢复边界

所有旧 app/data、compose、database、OpenClaw config/secrets 和 Codex hook 都必须在
仓库外 dated checkpoint；不删除现有 Avalon media library。媒体工作只允许明确单项并遵循
备份、preview、确认和 collision 检查。
