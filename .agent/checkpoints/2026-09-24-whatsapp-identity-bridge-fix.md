# 2026-09-24 WhatsApp identity bridge fix

## Scope

The pre-fix controlled WhatsApp marker `SKULD-WHATSAPP-20260924` was observed in the
direct owner session and produced exactly one assistant response. The run was not accepted:
`identity_bind_channel` returned `trusted_sender_metadata_unavailable`, so owner identity/tool
policy evidence was incomplete.

## Source and verification

- Source commit: `a62b2bd` (`fix(identity): preserve trusted inbound sender metadata`)
- Passed: `pnpm test:amadeus`, `pnpm typecheck:amadeus`, `pnpm build:amadeus`,
  `pnpm check:secrets`, `git diff --check`
- The fix records the current typed inbound sender from `before_dispatch` in a short-lived
  five-minute session bridge. Identity context uses it when `requesterSenderId` is absent;
  `requesterSenderE164` is a fallback only for WhatsApp.

## M204 runtime

- Image: `local/openclaw-amadeus:git-a62b2bd-20260924131000`
- ARM64 digest: `sha256:1ba126e6e740bf572f7c80ab1b1e34bdf9e95e8c138023f7c8a64a990b984875`
- CasaOS Compose was updated and the container recreated; post-restart health is passing and
  Telegram/WhatsApp reconnected.
- External protected runtime backup: `/DATA/AppData/openclaw/backups/amadeus-openclaw-identity-fix-<UTC>/`

## Gates

```text
WHATSAPP_ACCEPTANCE=pending_post_fix_resend
TELEGRAM_ACCEPTANCE=pending
DUPLICATE_RUNTIME=not-finalized
DESTINATION_AUTHORITY=NO
OPERATION_SKULD_CUTOVER=NOT_COMMITTED
```

The user must resend the exact marker in the current WhatsApp private chat for the post-fix
controlled acceptance. The final token `COMMIT_SKULD_CUTOVER_1_4_8` has not been supplied or
executed. Immich source and rollback assets remain preserved. `media-organizer-adapter` has no
rebuildable image/compose and was not replaced.
