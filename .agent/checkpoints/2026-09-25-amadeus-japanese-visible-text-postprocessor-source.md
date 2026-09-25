# 2026-09-25 — Japanese visible voice-text postprocessor source fix

## Report and cause

- Owner tested the already-deployed 1.5.3 candidate and reported that WhatsApp still showed only Chinese.
- The previous change relied on model Skill compliance. Its parser test checked a synthetic correctly formatted answer, but did not guarantee Japanese visible text at the WhatsApp delivery boundary.
- The pinned OpenClaw TTS path carries the actual synthesized phrase as `ttsSupplement.spokenText` (or `spokenText`) alongside media. A media-only supplement may have no visible `text`, while the Chinese summary may already have been delivered separately.

## Source fix

- Added a versioned v3 patch to the WhatsApp monitor `delivery.preparePayload` path.
- For verified inbound voice turns only, if outbound payload contains actual media and nonblank spoken text, append or synchronize `日本語：<spokenText>` into visible `text` before WhatsApp normalization/delivery.
- It uses the actual TTS phrase, so Japanese visible text matches the PTT; existing Japanese label rows are replaced instead of duplicated.
- Typed/non-voice replies and non-media payloads are unchanged.
- Source: `scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs`; regression fixture: `scripts/test-patch-openclaw-whatsapp-voice-lifecycle.mjs`.

## Verification

- `node --check` for patch and regression test passed.
- `node scripts/test-patch-openclaw-whatsapp-voice-lifecycle.mjs` passed, including actual patched `preparePayload` behavior for voice TTS supplement and typed-only cases.
- Applied all three lifecycle transforms to the official npm package `@openclaw/whatsapp@2026.9.4` `monitor` source in a temporary directory; patch anchors, idempotency, and Node syntax check passed.
- `pnpm test`, `pnpm typecheck`, `pnpm check:architecture`, `pnpm check:secrets`, and `git diff --check` passed.

## Runtime and next action

- No CasaOS/runtime mutation was performed for this source fix. Existing candidate remains `local/openclaw-amadeus:git-fb1d4578bafe-20260925152845`; prior rollback checkpoint remains `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925152845`.
- `VERSION` remains `1.5.3`. Do not bump to `1.5.4` until owner accepts the delivered visible Japanese line and consecutive voice FIFO.
- The source change is ready to publish; the CasaOS deployment has not been performed. When explicitly authorized, deploy it as a same-version candidate with the existing backup/checkpoint flow.
- Owner acceptance: one voice DM, two consecutive voice notes in one group (each must have Japanese PTT + matching Japanese kanji/kana line + Chinese summary in FIFO order), and one typed-only Chinese input (Chinese text only).
