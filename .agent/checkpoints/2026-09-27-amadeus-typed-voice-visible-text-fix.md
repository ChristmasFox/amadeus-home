# Amadeus typed-to-voice visible-text fix — candidate redeploy

Date: 2026-09-27 local. This is a candidate fix record, not final Goal
completion. No private prompt, sender/group identifier, credential, generated
media, account data, or voice sample is stored here.

## Observed failure

The candidate's read-only OpenClaw transcript showed a real typed WhatsApp
request equivalent to “用语音回我一句” whose assistant delivery had
`audioAsVoice=true` and a tagged TTS text, but the persisted visible text was
empty. A later typed voice request had visible text, proving the behavior was
intermittent. This matched the report that typed voice replies could arrive as
audio only.

The owner further clarified that the missing visible reply was the Chinese
sentence beginning “你家那只脸盘子圆滚滚…” and that no visible Japanese line
was present. The regression fixture now covers this Chinese-only visible-text
shape and verifies that the delivery guard appends the required Japanese line
from the actual spoken text. The pinned OpenClaw TTS pipeline classified every
text-bearing tagged audio payload as a `ttsSupplement`. During final/block delivery, its media-only
normalization can strip `text` after a streamed visible block has or has not
been finalized. The WhatsApp voice guard could not reconstruct the lost
Chinese summary once it had been stripped.

## Source fix

- `scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs` now preserves the
  normal text-bearing payload for typed tagged TTS (`inboundAudio !== true`)
  instead of marking it as media-only `ttsSupplement`. Verified inbound voice
  retains the previous supplement contract.
- `scripts/openclaw-voice-policy.mjs` applies the Japanese visible-text guard
  to typed audio payloads even when supplement metadata is absent, using
  `audioAsVoice + spokenText` as the typed TTS boundary.
- Focused tests now exercise the patched pinned runtime module, proving:
  typed explicit voice → visible Chinese/Japanese text + one audio payload,
  inbound voice → existing supplement contract, ordinary typed text → no TTS.
  Patch/idempotence and WhatsApp delivery fixtures pass.

## Candidate deployment evidence

- Source fix commit: `6c0840a` (pushed to
  `codex/model-capability-adapter-2026-09`).
- Candidate image:
  `local/openclaw-amadeus:git-6c0840a27351-20260927133716`, healthy.
- Applied with the existing explicit candidate release workflow using
  `--apply --candidate --build-auto --full-verify --machine nyannyan`.
  Product Radar was reused; OpenClaw immutable image build/transfer,
  pre-apply checkpoint, Compose switch, health and smoke passed.
- Deployment rollback checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927133716`;
  directory 0700, config and manifests 0600. Post-deploy evidence:
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927133716`
  (0700).
- Live candidate readback confirmed the typed-TTS preservation branch is in
  `/app/dist/runtime-api-zquJnB-O.mjs`, the volume WhatsApp monitor contains
  the typed Japanese guard, OpenClaw is healthy, 9Router PID is unchanged,
  and native TTS remains PID 50062/HTTP 200 ready.
- An in-container loopback provider fixture against the **patched candidate
  runtime** passed: typed reply returned visible text plus audio with no
  supplement stripping; inbound voice retained the existing supplement
  contract. No generated media left the fixture or entered Git.

## Remaining acceptance

Owner re-test is still required for a real WhatsApp typed explicit voice
request, specifically confirming one audio attachment **and** the visible
Chinese summary + Japanese line, with no raw `[[tts:*]]` marker. This fix does
not claim final Goal completion or perform a version bump.
