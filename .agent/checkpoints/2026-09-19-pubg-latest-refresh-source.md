# PUBG 最近一局刷新与增量缓存（source checkpoint）

- 时间：2026-09-19 Asia/Shanghai
- 版本：Amadeus 1.0.1
- 状态：源码与本地验证完成，等待 CasaOS apply

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

本 checkpoint 记录 apply 前源码状态。部署完成后必须补写实际 immutable image、CasaOS backup checkpoint、health/preflight 和 smoke 结果；不得把本地测试当作真实 WhatsApp 入站验收。
