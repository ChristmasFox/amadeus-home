# OpenClaw PUBG account alias alignment (local)

- Date: 2026-09-18 Asia/Shanghai
- Evidence: the deployed no-delivery agent smoke resolved `胶` correctly and called `pubg_query_stats`, but the PUBG boundary returned `identity_pubg_account_unresolved` because the confirmed external account `SG_Labmem008` did not exactly match the production team name `SG_LabmemNo008`.
- Source change: add the user-confirmed account names `SG_Labmem007`, `SG_Labmem008`, and `SG_Labmem004` as aliases for the existing canonical PUBG players in `packages/pubg-domain/config/default-team.json`.
- Regression test: `plugins/pubg/tests/identity-boundary.test.ts` now verifies that `SG_Labmem008` maps to canonical player `p1` without an API lookup.
- Verification: PUBG plugin typecheck, PUBG plugin tests (9 passed), PUBG domain tests (9 passed), and `git diff --check` passed.
- Pending: back up and update the external CasaOS `/DATA/AppData/openclaw/secrets/pubg-team.json`, then rebuild/apply OpenClaw and rerun a no-delivery smoke plus a real group request.
