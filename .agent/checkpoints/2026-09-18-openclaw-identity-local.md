# OpenClaw 跨渠道 Identity 本地实现

日期：2026-09-18（Asia/Shanghai）
状态：IMPLEMENTED_LOCAL_NOT_DEPLOYED

## 目标与边界

为 Telegram、WhatsApp 群聊和私聊增加共享的 canonical Person identity。OpenClaw/Kurisu
仍是唯一 Agent runtime；Identity 是 platform-neutral package 和 Amadeus native tools，
不是第二个 router、runtime、sender 或历史消息库。生产身份数据仍必须放在运行时 `/data`
外部持久化路径，仓库只保留无真实身份的 preset 示例。

## 已实现

- 新增 `packages/identity` SQLite 存储：`persons`、`channel_identities`、`aliases` 和
  `external_accounts`，支持 preset、trusted sender/mention/reply、群级 alias、observed
  candidate 和 Arthur-confirmed binding。
- Amadeus 新增 `identity_resolve`、`identity_get_person`、`identity_bind_channel`、
  `identity_add_alias`、`identity_link_account`、`identity_list_candidates`、
  `identity_confirm_candidate`，并新增 `skills/identity`。
- confirmed channel binding、confirmed alias、provider account link 和 candidate confirm
  受 owner/Arthur gate；observed alias 只能进入 candidate，不能直接成为权威身份。
- PUBG plugin 只在边界把 `provider=pubg` external account 转成 Domain selector；未绑定、
  缺少 PUBG account、候选或歧义时 fail closed，不再静默使用默认队伍。`team=true` 只能由
  明确的队伍请求使用。
- `identity.sqlite` 和 preset 配置已接入 Amadeus/PUBG manifest、Compose example、部署
  preflight、README 和 workspace guidance；没有把个人 channel ID、手机号、JID 或 secret
  写入 Git。

## 本地验证

- `pnpm build && pnpm typecheck && pnpm test`：PASS（identity 3、PUBG plugin 6、Amadeus
  4，以及其余 workspace tests）。
- `pnpm check:secrets`：PASS。
- `git diff --check`：PASS。
- OpenClaw PUBG plugin manifest validate：PASS；Amadeus 的动态 `definePluginEntry` 入口仍
  不满足 CLI 的静态 authoring metadata validate，因此以 manifest/tool contract 测试和本地
  Amadeus tests 为证据，不把该 CLI 失败误记为线上验证。
- shell/Python syntax checks：PASS。

## 尚未完成

没有重新构建或 apply CasaOS，没有重启线上 OpenClaw，也没有执行真实 Telegram/WhatsApp
sender binding、PUBG account link、重启后持久化和群聊不打扰验收。当前线上 image 不包含本
轮 Identity 变更；后续操作见 `.agent/tasks/2026-09-18-openclaw-identity-live-acceptance.md`。
