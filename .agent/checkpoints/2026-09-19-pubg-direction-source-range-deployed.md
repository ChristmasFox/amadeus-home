# Checkpoint: PUBG direction and source range deployment

- Date: 2026-09-19 (Asia/Shanghai)
- Version: `1.1.4`
- Commit: `04e8902`
- Image: `local/openclaw-amadeus:git-04e8902c815a-20260919064258`
- Backup: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260919064258`
- Target: OrbStack `ubuntu` CasaOS `openclaw`

## Changes

- Treat friendly-fire and teammate-action queries as directional `actor → victim` facts;
  “反过来” is an independent query and must not rewrite the previous direction as wrong.
- Add required `dataSourceRange` to every PUBG native tool output. Review facts inherit the
  exact interval from the current fresh search result set.
- Require final PUBG responses to show `dataUpdatedAt` and the source interval, including
  timezone and the 06:00 business-day boundary.

## Verification

- `pnpm test:pubg`: passed (20 domain, 9 plugin, plus identity suite)
- `pnpm typecheck:pubg`: passed
- `pnpm build:pubg`: passed
- `pnpm build:amadeus`: passed
- `pnpm check:secrets`: passed
- `git diff --check`: passed
- Deployment: `Amadeus 1.1.4 migration completed.`
- Live: `openclaw` is `running/healthy`; Amadeus, PUBG, Telegram, and WhatsApp registered.
- Live bundle contains the directional-response rules and `dataSourceRange` output contract.
- No unsolicited real group-chat test message was sent.
