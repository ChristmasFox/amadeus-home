# Deploy fixed Japanese voice-audio language policy

- Status: source rule and tests updated; deployment/real acceptance pending.
- Request: voice-response audio must stay Japanese even if the user asks for Chinese speech; ordinary text-message behavior remains unchanged.
- Source: `plugins/amadeus/skills/voice-reply/SKILL.md`; tests in the Amadeus manifest and pinned bilingual TTS fixture.
- Current live release remains Amadeus 1.5.4. This source-only change has not been built or applied.
- On explicit apply authorization: use `./scripts/amadeus-version.sh bump patch` for 1.5.5, replace release notes, run release tests/typecheck/architecture/secrets, commit/push, dry-run, then apply a single-runtime OpenClaw release with external rollback checkpoint and health checks.
- Acceptance: (1) voice user asks “用汉语回答” and audio is still Japanese PTT with matching visible Japanese line + Chinese summary; (2) typed-only Chinese message still gets the previous text behavior and no TTS/Japanese row.
