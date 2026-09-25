# 2026-09-25 — Voice formatting, Chinese release notices, and external storage gate source fix

## Changes

- Added `--identity-only` to `scripts/storage-preflight.sh`. It retains host volume UUID and sentinel validation, then independently confirms the sentinel and destination visibility/access in the OrbStack guest without requiring or statting the legacy Immich migration source.
- Switched post-deploy Docker log-policy and storage-maintenance gates to identity-only validation. Copy-first migration checks remain source-strict.
- Added regression coverage: valid external identity plus missing migration source passes identity-only preflight; volume UUID mismatch still fails.
- Changed Japanese voice length guidance to a flexible target of around 100 words, not a hard requirement; the configured TTS maximum remains binding.
- Ensured visible Chinese and Japanese lines have a blank line between them, with tests for both existing and synthesized Japanese lines.
- Translated current release notes into Chinese and require Chinese user-facing content in release-note validation, ensuring deployment notices cannot have English-only updates.

## Validation

- `scripts/test-amadeus-version.sh` — passed, including English-only rejection.
- `scripts/test-migration-readiness.sh` — passed.
- `scripts/test-storage-runtime.sh` — passed, including new identity-only fixtures.
- `node scripts/test-patch-openclaw-whatsapp-voice-lifecycle.mjs` — passed.
- `node scripts/test-openclaw-bilingual-voice.mjs` — passed.
- Amadeus plugin `typecheck` and tests — passed (33 tests).
- `pnpm check:secrets` — passed.
- `git diff --check` — passed.

## Not done

All report-writing maintenance modes now capture preflight locally and create an external report directory only after identity passes. A fixture proves a failed post-deploy identity check neither invokes guest cleanup commands nor creates report files. No version bump, release commit, push, CasaOS deployment, external log-policy apply, or storage cleanup was performed. Runtime mutation remains subject to a separate explicit release/apply step and a fresh backup/checkpoint.
