# Typed voice modality heartbeat isolation — candidate live

## Source

- Commit: `bce1cc6` (`fix(amadeus): scope reply modality to external user turns`)
- Branch: `main`, pushed to `origin/main`
- Runtime: OpenClaw `2026.9.4`, sole Agent runtime

## Root cause evidence

- The private WhatsApp recipient had no inbound message around the reported
  send. The OpenClaw web heartbeat had `messagesHandled=7` and the transcript
  recorded `[OpenClaw heartbeat poll]` with
  `provenance.kind=internal_system`.
- The 13:04 and 13:34 assistant transcript entries were exactly
  `[[amadeus:reply-modality=default]]\nNO_REPLY`.
- The prior `before_prompt_build` hook admitted every `channel=whatsapp` turn,
  including heartbeat turns. The prefix made core's exact `NO_REPLY` silent
  handling miss the response, so WhatsApp sent the marker plus token.

## Fix

- Use OpenClaw's native `inputProvenance.kind` metadata. Typed modality and
  canonical voice Skill injection now run only for `external_user` turns.
- Keep the verified inbound voice lease path unchanged.
- Strip a modality marker and suppress an exact `NO_REPLY` in the WhatsApp
  postprocessor as a narrow delivery guard.

## Candidate deployment

- Image: `local/openclaw-amadeus:git-bce1cc67fc8a-20260928054649`
- Host: OrbStack machine `nyannyan`
- Rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928054649`
- Post-deploy evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260928054649`
- OpenClaw and Product Radar health: passed
- NAS read-only smoke: passed
- WhatsApp: linked, connected, and listening after restart

## Verification

- Amadeus full test suite: passed (37 tests)
- Heartbeat/internal WhatsApp turns do not receive typed modality metadata: passed
- Marked `NO_REPLY` suppression fixture: passed
- OpenClaw 2026.9.4 lifecycle/TTS fixtures: passed
- Architecture check, secrets scan, build, and diff check: passed

## Remaining acceptance

The next scheduled heartbeat must complete without a WhatsApp outbound message
or a visible modality marker. Owner handset acceptance remains pending for this
heartbeat-specific fix; the prior typed voice and inbound voice acceptance is
preserved in the earlier candidate checkpoint.
