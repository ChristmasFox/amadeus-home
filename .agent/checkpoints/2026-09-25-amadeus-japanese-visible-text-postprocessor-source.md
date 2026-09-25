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

## Candidate deployment

- Source commit `b655dba` was pushed to `work/amadeus-1.5.3-voice-io`.
- Applied with `./scripts/deploy-openclaw.sh --apply --candidate --build-openclaw`; this is a same-version candidate, not a formal release.
- `VERSION=1.5.3`; OpenClaw image `local/openclaw-amadeus:git-b655dba924f9-20260925155559`; Product Radar reused `local/product-radar:git-d988000e1c5d-20260924130631`.
- External rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925155559`.
- Deployment evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925155559`.
- Post-apply OpenClaw state: running/healthy, restart count 0; WhatsApp linked/connected/healthy; only one OpenClaw runtime.
- Read-only live check found lifecycle, ingress FIFO, and Japanese visible-text patch markers exactly once in the pinned WhatsApp monitor; `node --check` passed.
- The optional media organizer adapter was absent during this deployment, so its separate network smoke was skipped; this voice change does not depend on it.

## Owner acceptance still required

- Do not bump to `1.5.4` until owner accepts the delivered visible Japanese line and consecutive voice FIFO.
- Send one voice DM, two consecutive voice notes in the same group (each must receive Japanese PTT + matching Japanese kanji/kana line + Chinese summary in FIFO order), and one typed-only Chinese input (Chinese text only).
