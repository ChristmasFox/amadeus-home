# DeliveryEnvelope v2 candidate after native adapter shape fix

Date: 2026-09-30, Asia/Shanghai. Owner authorized apply remains active.
Source: `675d5fbbf974d56988590d8c74867f9e1a6a24e4`.

After Gate A failed on the preceding candidate, the old immutable image and
previous WhatsApp module were restored from protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930095303`; only the
persisted plugin-index SQLite row was restored transactionally, leaving
intervening session state untouched. The private failure log is under the
prior 0700 external evidence directory. The source fix puts the one typed
settlement in the pinned native `replyPipeline.delivery` contract, not
`dispatcherOptions`, and restores the native dispatcher lifecycle fields.
Focused and pinned contract tests, typecheck/build and secrets scan passed.

The repaired candidate applied with new immutable image
`local/openclaw-amadeus:git-675d5fbbf974-20260930101930`. Its protected
rollback checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930101930` (0700 root,
0600 consistent `openclaw-state.sqlite.before`, manifest and registry evidence).
Post-deploy evidence is retained outside Git at
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930101930`.
The official plugin registry refresh and strict Amadeus plugin/Skill preflights,
real Gateway Amadeus registration, health/NAS smoke and owner outbox passed.
Product Radar and 9Router images were not switched. Read-only follow-up showed
WhatsApp linked/running/connected, `tts.auto=off`, and the expected typed
`delivery.observeMessageSent` adapter present. No recurrence of the earlier
TypeError was observed **before** the owner re-test.

**Real owner Gate A re-test is pending.** Do not infer success from image
health or synthetic tests. On any no-reply failure, capture bounded diagnostics
in the protected evidence root and restore this checkpoint/previous immutable
runtime before attempting further WhatsApp messages. Gates B–F and recipient
SHA-256/byte-size equality remain unproven.

## Follow-up: live owner 4x mismatch (18:54 local)

The owner confirmed DM replies and subsequently saw group replies recover
without an operator change. Two earlier group turns settled silent; this is
not a proven group regression fix. Live image remained the same candidate.
Read-only inspection of the macOS asset registry and OpenClaw transcript
metadata found the explicit owner 4x turn invoked `amadeus_image_upscale`
with `scale:2`; host 2x output was faithful to that call. No message bodies,
identifiers, or secrets are retained here. The service contract supports 4x.
The new source constraint/test must be committed and applied via a new
protected checkpoint, then verified with a real explicit 4x owner request.
