# OpenClaw PUBG account correction checkpoint

- Date: 2026-09-18 (Asia/Shanghai)
- Scope: Correct the three user-supplied PUBG external account IDs to include `No`.
- Correct mapping: `SG_LabmemNo007`, `SG_LabmemNo008`, `SG_LabmemNo004`.
- Git fixture: removed the stale aliases `SG_Labmem007`, `SG_Labmem008`, and `SG_Labmem004` from `packages/pubg-domain/config/default-team.json`.
- Runtime: updated `/DATA/AppData/openclaw/data/identity-presets.json`, `/DATA/AppData/openclaw/secrets/pubg-team.json`, and the three corresponding Identity SQLite `external_accounts` rows; the three derived `account_id` values were recalculated from the corrected keys.
- Backup: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918130716-identity-pubg-no-correction`.
- Verification before image apply: PUBG plugin typecheck passed; PUBG plugin tests passed (9/9); PUBG domain tests passed (9/9); `pnpm check:secrets` passed; `git diff --check` passed.
- Pending: commit the source correction, build/apply the OpenClaw image, then rerun no-delivery PUBG identity/tool smoke. No unsolicited group message was sent.
