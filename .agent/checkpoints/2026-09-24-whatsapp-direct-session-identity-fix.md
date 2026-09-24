# 2026-09-24 WhatsApp direct session identity fix

## Failure evidence

After the prior bridge fix, the controlled marker arrived at 14:17:47 and produced one outbound
WhatsApp response at 14:18:34. The run was not accepted because `identity_bind_channel` failed
three times with `trusted_sender_metadata_unavailable`. The live tool context did not carry
`senderId` or `senderE164` from the WhatsApp adapter.

## Fix

Commit `805e6b4` adds a fail-closed direct-session fallback. When the channel is WhatsApp and the
host-generated session key matches `agent:<agent>:whatsapp:<account>:direct:<peer>`, `<peer>` is
used as the current sender only after normal trusted sender fields and the short-lived inbound
bridge are absent. Group and channel keys are rejected, and message text is never consulted.

Verification passed: `pnpm test:amadeus` (22 tests), `pnpm typecheck:amadeus`,
`pnpm build:amadeus`, `pnpm check:secrets`, and `git diff --check`.

## Runtime deployment

- Image: `local/openclaw-amadeus:git-805e6b4-20260924064816`
- ARM64 digest: `sha256:adb9532041682bda8a5b399398b6ee825a86e3e06d5da1a79c33c050813db9bd`
- M204 container recreated and healthy
- Protected external backup: `/DATA/AppData/openclaw/backups/amadeus-openclaw-whatsapp-direct-fix-<UTC>/`

## Current gates

```text
WHATSAPP_ACCEPTANCE=pending_post_fix_resend
TELEGRAM_ACCEPTANCE=pending
DUPLICATE_RUNTIME=not-finalized
DESTINATION_AUTHORITY=NO
OPERATION_SKULD_CUTOVER=NOT_COMMITTED
```

The marker must be sent again after this restart. Rollback assets and Immich source remain preserved;
the final cutover token has not been supplied or executed.
