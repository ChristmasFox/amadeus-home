# WhatsApp group yesterday-stats identity guard checkpoint

- Date: 2026-09-18 Asia/Shanghai
- Problem: a real WhatsApp group request for yesterday's stats was delivered to
  OpenClaw, but the model used the sender's display name as `playerNames`,
  producing `unknown_player`; the resolved yesterday window itself was correct.
- Fix:
  - `integrations/openclaw/workspace/AGENTS.md` now forbids using transport
    sender/profile/push names, phone numbers, JIDs, or quoted attribution as a
    PUBG identity.
  - `plugins/pubg/skills/pubg/SKILL.md` states that unqualified “yesterday/my
    stats” requests omit `playerNames` and `playerIds` and use the configured
    team/default subject.
  - `plugins/pubg/src/index.ts` describes `playerNames` as explicit PUBG names
    or configured aliases only.
- Runtime backup: `/DATA/AppData/openclaw/backups/openclaw-pubg-identity-guard-20260918-114335`
- Runtime image: `local/openclaw-pubg:identity-guard-202609181145`
- Verification:
  - typecheck, PUBG tests (14 total), build, secret scan, and `git diff --check`
    passed;
  - OpenClaw container healthy;
  - config validate passed with no warnings;
  - PUBG plugin loaded with six tools;
  - public `/healthz` returned `{"ok":true,"status":"live"}`.
- Pending: one new real WhatsApp group query for “昨天战绩” to verify the
  model omits sender-derived `playerNames` and delivers the configured-team
  result.
