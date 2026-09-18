# OpenClaw PUBG account correction checkpoint

- Date: 2026-09-18 (Asia/Shanghai)
- Scope: Correct the three user-supplied PUBG external account IDs to include `No`.
- Correct mapping: `SG_LabmemNo007`, `SG_LabmemNo008`, `SG_LabmemNo004`.
- Git fixture: removed the stale aliases `SG_Labmem007`, `SG_Labmem008`, and `SG_Labmem004` from `packages/pubg-domain/config/default-team.json`.
- Runtime: updated `/DATA/AppData/openclaw/data/identity-presets.json`, `/DATA/AppData/openclaw/secrets/pubg-team.json`, and the three corresponding Identity SQLite `external_accounts` rows; the three derived `account_id` values were recalculated from the corrected keys.
- Backup: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918130716-identity-pubg-no-correction`.
- Verification before image apply: PUBG plugin typecheck passed; PUBG plugin tests passed (9/9); PUBG domain tests passed (9/9); `pnpm check:secrets` passed; `git diff --check` passed.
- Source commit: `c3ec1ac` (`fix(pubg): correct confirmed account names`).
- Image: `local/openclaw-amadeus:git-c3ec1acca74d-20260918130917`.
- CasaOS checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918130917`.
- Deployment result: OpenClaw/Product Radar health, plugin preflight, media-adapter network, NAS read-only smoke, and owner outbox smoke passed.
- Post-deploy permission repair: restored `/DATA/AppData/openclaw/data/identity-presets.json` to `node(1000):node(1000)` with mode `0600` after the root-run atomic correction temporarily made it unreadable to the container user.
- No-delivery live agent smoke: `胶昨天战绩` and `猴昨天战绩` each completed `read` → `identity_resolve` → `pubg_query_stats`, 3 tool calls, 0 failures, and returned 4 matches. No unsolicited group message was sent.
