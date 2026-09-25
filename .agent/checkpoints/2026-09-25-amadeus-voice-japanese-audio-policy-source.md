# 2026-09-25 — Fixed Japanese audio language policy (source only)

## User request

- Voice-output audio must always be Japanese, even when the user explicitly asks for a Chinese/Mandarin spoken reply.
- Text messages must remain unchanged.

## Implemented rule

- Updated the sole capability-owned Skill `plugins/amadeus/skills/voice-reply/SKILL.md`.
- For verified inbound voice-note turns, only the audio spoken language is fixed to Japanese; honor the substantive request, but do not switch spoken audio into Chinese.
- Keep the existing voice reply visible-text contract: one concise Chinese summary, one natural Japanese kanji/kana line, and one TTS directive exactly matching that Japanese line.
- Typed-only messages retain existing language behavior, including explicit language requests, and do not gain TTS/Japanese lines/voice summaries.
- Updated Amadeus manifest test and pinned OpenClaw bilingual voice fixture to assert both the Japanese-audio rule and typed-only preservation.

## Verification and deployment state

- `pnpm typecheck:amadeus` passed.
- `pnpm test:amadeus` passed (Identity 10, Presentation 8, Amadeus 35 tests).
- `node --check scripts/test-openclaw-bilingual-voice.mjs` and `node scripts/test-openclaw-bilingual-voice.mjs` passed.
- `pnpm check:architecture`, `pnpm check:secrets`, and `git diff --check` passed.
- No package build or Docker build was run: the change is Skill text plus assertions, and the workflow plan requested typecheck/tests only; deployment remains explicit.
- No version bump, image build, runtime edit, or deployment was performed for this request.
- Formal version remains `1.5.4` and is unchanged in CasaOS; these source changes are not live yet.
- After explicit deploy authorization, bump patch only through `./scripts/amadeus-version.sh bump patch` (next version `1.5.5`), replace `RELEASE_NOTES.md`, verify, commit/push, then use the formal candidate/release flow as authorized. Do not claim the live voice audio is fixed until post-deploy acceptance.
