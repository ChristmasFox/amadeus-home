# Amadeus typed voice bilingual format fix — candidate redeploy

Date: 2026-09-27 local. Candidate only; no final release or Goal completion.
No private prompt, sender/group identifier, credential, generated media, or
voice sample is recorded here.

## Owner-reported failure and correction

The owner clarified that the visible text was not merely missing a Japanese
line: the response could fail to follow the required bilingual contract. The
required visible format is exactly:

```text
中文：<Chinese summary>

日本語：<Japanese answer>
```

The specific regression example was the Chinese sentence beginning
“你家那只脸盘子圆滚滚…”, with no visible Japanese line. The prior helper
only appended a Japanese line while preserving an unlabeled Chinese source;
its live volume-installed monitor also retained an older helper because the
patcher treated an existing marker as permanently applied.

The source now:

- canonicalizes every eligible typed/inbound TTS visible payload to one
  `中文：...` line plus one `日本語：...` line;
- strips duplicate/stale Japanese labels before rebuilding the exact contract;
- preserves typed text+audio instead of media-only supplement behavior;
- upgrades an already-marked volume-installed WhatsApp monitor when the
  helper implementation changes, while remaining idempotent;
- keeps inbound voice's supplement contract and Japanese-audio fail-closed
  boundary.

Focused tests cover the exact Chinese-only example and pass.

## Candidate evidence

- Source commits: `9f29a23` (bilingual formatting) and `0827daf` (idempotent
  live monitor upgrade), both pushed to
  `codex/model-capability-adapter-2026-09`.
- Candidate image:
  `local/openclaw-amadeus:git-0827dafec807-20260927140017`, healthy.
- Explicit candidate workflow:
  `scripts/deploy-openclaw.sh --apply --candidate --build-auto --full-verify --machine nyannyan`.
  OpenClaw immutable build/transfer, protected checkpoint, Compose switch,
  health and smoke passed. Product Radar was reused.
- New rollback checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927140017`;
  directory 0700, config/manifests 0600. Post-deploy evidence is the matching
  0700 Avalon deployment directory.
- Live readback confirms the typed TTS preserve branch in the candidate
  runtime and the upgraded WhatsApp monitor contains the canonical bilingual
  formatter. 9Router PID remained `1449961`; native TTS remained PID `50062`
  and ready; neither was restarted.

A real WhatsApp re-test is still required to close the acceptance gate. Final
version bump/release must wait for that real confirmation.
