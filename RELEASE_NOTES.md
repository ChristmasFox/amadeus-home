# Amadeus 1.4.5

Operation Skuld 的最终可靠性收口：

- 修复 fresh-clone 可重建边界，跟踪全部迁移脚本与此前被忽略的 PUBG domain source，并加入非递归 fresh-clone rehearsal。
- 让 storage health 真实消费容量阈值，记录 90 天增长历史；weekly maintenance 使用 safe apply，落实 image/checkpoint retention，禁止 generic destructive prune。
- 将 SQLite consistent snapshot、Immich `pg_dump -Fc`/restore-list、9Router isolated restore 与 service-aware backup registry 纳入迁移证据。
- 完成 HomeLab service classification、metadata-only encrypted secret coverage、Manifest/Runbook contract check，并强化未来 Immich source reclaim 的 fresh one-way verification；旧源仍保留，Mac mini cutover 未执行。
- 开发验证改为 scope-aware targeted checks、bounded command evidence、affected-only image scope 与单次 final full release gate。

验证：最终 release gate 将运行 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm check:secrets`、architecture、fresh-clone rehearsal 与 canonical CasaOS live acceptance。
