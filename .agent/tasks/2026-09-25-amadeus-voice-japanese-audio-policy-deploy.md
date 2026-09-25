# Deploy fixed Japanese voice-audio language policy

- Status: source rule and tests updated; candidate deployment/real acceptance pending.
- Request: voice-response audio must stay Japanese even if the user asks for Chinese speech; ordinary text-message behavior remains unchanged.
- Source: `plugins/amadeus/skills/voice-reply/SKILL.md`; tests in the Amadeus manifest and pinned bilingual TTS fixture.
- Current live release remains Amadeus 1.5.4. This source-only change has not been built or applied.
- After explicit apply authorization, first deploy a same-version 1.5.4 candidate using `./scripts/deploy-openclaw.sh --apply --candidate --build-openclaw`, preserving the external rollback checkpoint and verifying health/WhatsApp state.
- Candidate acceptance: (1) send voice input explicitly requesting Chinese speech; expect Japanese PTT matching the visible Japanese kanji/kana line, plus the existing Chinese summary; (2) verify typed-only messages retain previous text behavior, including explicit language requests, without TTS/Japanese rows.
- Only after owner accepts the candidate, bump to `1.5.5` with `./scripts/amadeus-version.sh bump patch`, replace release notes, run all release gates, commit/push, and deploy the formal release.
