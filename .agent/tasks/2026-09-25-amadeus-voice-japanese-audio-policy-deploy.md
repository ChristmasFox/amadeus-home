# Formal release: fixed Japanese voice-audio language policy

- Status: 1.5.5 formal release requested by the owner and in progress.
- User instruction: voice replies always speak Japanese, even if the user asks for Chinese speech; text-message behavior remains unchanged.
- Source rule and tests are in `plugins/amadeus/skills/voice-reply/SKILL.md`, `plugins/amadeus/tests/manifest.test.ts`, and `scripts/test-openclaw-bilingual-voice.mjs`.
- Owner explicitly requested formal release directly; per that direction, do not wait for a separate same-version candidate.
- `VERSION` was advanced from 1.5.4 to 1.5.5 using `./scripts/amadeus-version.sh bump patch`; release notes replaced with this release only.
- Formal deploy: after release gates and commit/push, dry-run then `./scripts/deploy-openclaw.sh --apply --build-auto`; retain checkpoint/evidence, verify health and notification. Post-deploy handset acceptance is still needed for the Chinese-spoken-request case and typed-only unchanged case.
- Final evidence goes in `.agent/checkpoints/2026-09-25-amadeus-1.5.5-formal-release.md`.
