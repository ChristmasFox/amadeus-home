# PUBG 最近一局刷新与增量缓存（source checkpoint）

- 时间：2026-09-19 Asia/Shanghai
- 版本：Amadeus 1.0.1
- 状态：已通过 CasaOS apply，运行态核对通过；真实 WhatsApp 群聊入口待用户触发

## 变更

- `pubg_search_matches` 的 `recentN` 查询强制刷新玩家比赛列表。
- `last_n_matches` 统计强制刷新同一列表。
- 同步时把 SQLite 中已有的 matchId 传给 API client；Match API 只请求新增比赛，成功详情写回缓存。
- 无新增比赛时保留并使用本地缓存详情，同时更新同步状态和覆盖范围。
- Skill、native tool description 和 Kurisu workspace context 禁止“最近一局”复用旧 matchId。
- 发布通知版本递增到 `1.0.1`，正文记录本次世界线修正。

## 验证

- `pnpm test:pubg`：Identity 10、PUBG domain 11、PUBG plugin 9，全部通过。
- `pnpm typecheck:pubg`：通过。
- `pnpm build:pubg`：通过。
- `pnpm check:secrets`：通过。
- `git diff --check`：通过。

## 线上验收边界

本 checkpoint 同时保留 apply 前源码验证和下方实际部署证据；不得把本地测试当作真实 WhatsApp 入站验收。

## 部署结果

- 提交：`db0a2df`
- immutable image：`local/openclaw-amadeus:git-db0a2dfa5c75-20260918164913`
- CasaOS backup：`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918164913`
- OpenClaw/Product Radar health：passed；运行态容器均为 `healthy`
- `MEDIA_ADAPTER_NETWORK`、`NAS_SSH_READONLY_SMOKE`、`OWNER_WHATSAPP_OUTBOX_SMOKE`：passed
- Product Radar image 复用：`local/product-radar:git-5fd139d3e58d-20260918081806`
