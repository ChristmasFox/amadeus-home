# Typed voice semantic modality candidate — 2026-09-28

## Source

- Commit: `235387f` (`fix(amadeus): strip modality metadata from outbound text`)
- Branch: `main`, pushed to `origin/main`
- Runtime: OpenClaw `2026.9.4`, sole Agent runtime

## Candidate deployment

- Image: `local/openclaw-amadeus:git-235387f23d2e-20260928043207`
- Host: OrbStack machine `nyannyan`
- Rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928043207`
- Post-deploy evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260928043207`
- OpenClaw health: passed; Product Radar health: passed; NAS read-only smoke: passed
- WhatsApp: linked, connected, and listening after restart

## Semantic modality boundary

- Removed the previous typed prompt regex classifier.
- `before_prompt_build` initializes the current WhatsApp typed turn as `replyModality=default` and provides the model semantic protocol plus the canonical `skills/voice-reply/SKILL.md` body.
- The same Agent turn chooses `voice` or `default` from the complete request and emits one hidden `[[amadeus:reply-modality=...]]` control line.
- The runtime records that decision under the current run/session, gates missing `[[tts:text]]` recovery on `voice`, strips every modality control line from outbound text before delivery, and clears the state at `agent_end` or TTL.
- Verified inbound WhatsApp voice turns continue to use the existing lease and do not synthesize a lease from typed text.

## Verification

- Amadeus full test suite: passed (36 tests)
- Typed modality/lease tests: passed
- OpenClaw 2026.9.4 lifecycle and TTS fixtures: passed
- Exactly-one-audio fixture, missing-marker recovery, ordinary translation/default, and inbound voice preservation: passed
- Architecture check, secrets scan, build, and diff check: passed

## Acceptance

The owner confirmed the post-deploy WhatsApp text and voice behavior is
normal. This closes handset acceptance for the candidate:

1. typed `发语音告诉我今天西安天气` → one audio plus the existing bilingual visible contract;
2. `你的语音怎么实现的？` → text only;
3. `把你好翻译成中文和日文` → text only;
4. a following ordinary turn → `default` with no inherited audio.
