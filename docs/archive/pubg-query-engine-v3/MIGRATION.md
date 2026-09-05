# PUBG Query Engine V3.2 — Migration and Rollback

更新时间：2026-09-03（Asia/Shanghai）

## 1. Migration Strategy

V3.2 是 V3/V3.1 的 additive extension：

```text
Platform Adapter
      ↓
Shared PUBG Prelude
Identity → Context → Planner → Schema → Selector → Router
                              ├─ report/rank/strongest/weakest/compare/trend/detail
                              │    → existing QuerySubgraph
                              └─ review_match
                                   → ReviewSubgraph
```

V2 Workflow、V3 Query Core、`pubg_cache`、历史 Match Store 和 V3.1 Platform Adapter 均保留。没有把 Telemetry 下载塞入普通 Query 路径。

## 2. Delivered V3.2 Stages

| Stage | 结果 |
| --- | --- |
| Shared Prelude / operation router | 已完成；普通 V3 与 `review_match` 分流 |
| Review schema / MatchSelector | 已完成；latest/earliest/ordinal/from-end/filtered/ranked/active/previous/next |
| Match Picker / callback | 已完成；ASC ordinal、短 token、same-chat/expiry binding、deterministic resume |
| Telemetry Worker | 已完成；download、gzip decode、parse、normalize、feature extraction、JSON Feature Store |
| Review Facts / fights / operations | 已完成；FACT/DERIVED/ANALYSIS/FUN、evidence、0~3 key operations/player |
| Vehicle / Heavy Weapon / Special Events | 已完成；Panzerfaust、ROCKET_UNUSED、证据约束的载具多杀 |
| Review Presentation | 已完成；Sections → Telegram/KOOK renderer，按 section 拆分消息 |
| Active Match Context | 已完成；active match、review ResultSet、previous/next 和 profile follow-up |
| V3/V3.1 regression | 源码和运行检查通过；真实平台入站烟测仍需外部事件 |

## 3. Live Resources

### Runtime

- CasaOS Compose：`/var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml`
- Host source compose：`pubg-query-engine-v3/deploy/docker-compose.yml`
- Current image：`local/pubg-query-engine-v3:3.2.2-accuracy`
- Container：`pubg-query-engine-v3`，port `5310`，当前 `healthy`
- Persistent data：`/DATA/AppData/pubg-query-engine-v3/data`
- Secret：`/DATA/AppData/pubg-query-engine-v3/secrets/pubg-api-key`，只读挂载到容器

### n8n

- `PUBG Data Gateway v3`：`pubg-data-gateway-v3-20260902`
- `PUBG Sync Matches v3`：`pubg-sync-matches-v3-20260902`
- V2 Gateway/Sync/今日战绩资源保留用于回滚

### LangBot

- Current plugin：`local/pubg-stats` manifest `3.2.1`
- Artifact：`docs/pubg-query-engine-v3/pubg-stats-v3.2.1-accuracy.lbpkg`
- Current LangBot runtime image：`langbot-local:4.10.8-kook-fix-ssh10`

## 4. Data Preservation

- 未删除 `pubg_cache`、V2/V3 Match Store、V3.1 state 或 n8n workflows。
- Context/ResultSet 仍为 JSON Store；session 由 platform/chat/sender/domain 隔离。
- Feature Store key 为 `matchId + parserVersion + featureVersion`。
- Feature Store 当前 3 条真实记录已经完成 compact；派生 facts/evidence 保留，normalized events 不持久化。
- Compact 前 Feature Store 已备份到 `/DATA/AppData/pubg-query-engine-v3/backups/features-before-compaction-20260903.json`。

## 5. Rollback Procedure

回滚应在 Ubuntu CasaOS 中执行，且只恢复明确的 app/plugin 引用：

```text
1. 备份当前 compose 与状态（如需操作审计）。
2. 将 /var/lib/casaos/apps/pubg-query-engine-v3/docker-compose.yml 的 image
   恢复到备份中的 V3.1/V3 image。
3. 在 ubuntu 执行：
   orb -m ubuntu -u root bash -lc 'cd /var/lib/casaos/apps/pubg-query-engine-v3 && docker compose up -d'
4. LangBot 通过正常插件管理恢复旧 artifact；必要时恢复
   langbot-local:4.10.8-kook-fix-ssh7 和 V3.1 plugin package。
5. 保留 /DATA/AppData/pubg-query-engine-v3/data、Feature backup、pubg_cache
   和所有 n8n workflows，然后验证旧 /pubg 与 V2 Gateway。
```

已有回滚材料：

- Engine：`/DATA/AppData/pubg-query-engine-v3/backups/v3.1-before-v3.2-20260903`
- Accuracy patch：`/DATA/AppData/pubg-query-engine-v3/backups/accuracy-patch-v3.2.2-before-deploy-20260903`
- LangBot：`/DATA/AppData/langbot/backups/pubg-v3.2-before-20260903`
- V3.1 source：`docs/pubg-query-engine-v3/v3.1-snapshot-20260903`

不要用 `git reset --hard`、`git checkout --` 或删除整棵 data 目录来回滚。

## 6. Known Migration Debt

- Mastra 官方 Storage adapter 尚未配置；Runtime 继续使用受控 JSON Context/ResultSet/Feature Store。
- n8n Data Table 仍承担 Match Store 与 Sync State；后续可替换成精确 Repository，不改变 Query/Review Core。
- Telemetry 第一版不覆盖完整 Loot、Healing、Position Analytics、2D/3D Replay。
- 真实 Telegram/KOOK 非 Bot 入站与客户端显示需要外部成员事件，当前属于 `BLOCKER_EXTERNAL`。
