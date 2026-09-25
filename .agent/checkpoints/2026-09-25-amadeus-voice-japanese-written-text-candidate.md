# 2026-09-25 — Japanese kanji/kana voice-text candidate applied

## Candidate

- Source commit: `fb1d457` (`feat(voice): show Japanese kanji-kana summary line`).
- Voice FIFO hotfix commit included: `02fdf49`.
- `VERSION` remains `1.5.3`; this is a same-version candidate, not a new release.
- OpenClaw image: `local/openclaw-amadeus:git-fb1d4578bafe-20260925152845`.
- External rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925152845`.
- Deployment evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925152845`.
- Manifest verifies `/DATA/AppData/openclaw/config/npm/projects` is backed up (about 71,205,506 bytes).

## Contract

For a verified inbound WhatsApp voice run, final answer has one Chinese summary line, one natural Japanese text line in standard kanji/kana (optional parenthesized readings for uncommon kanji), and one audio-only TTS directive whose spoken sentence exactly matches the Japanese text line. Typed-only input remains Simplified Chinese text-only.

## Verification

- Pinned OpenClaw TTS directive fixture and Amadeus manifest test pass; Japanese display line preserves kanji and kana and exact-match TTS source text.
- Formal deploy process passed full tests, typecheck, architecture, and secrets gates before apply.
- After apply: OpenClaw healthy/restarts=0; WhatsApp linked/connected; ingress FIFO patch marker remains present.
- No post-candidate handset acceptance has occurred yet.

## Required owner retest

1. Send one WhatsApp voice DM: expect Japanese PTT, visible Japanese kanji/kana line matching the PTT, and concise Chinese summary.
2. Send two consecutive voice notes in the same group: expect one matching PTT+Japanese line+Chinese summary per input, in FIFO order; composing remains visible through each pair.
3. Send a typed-only Chinese message: expect only the normal Chinese text path, no Japanese line or PTT.

Do not bump `VERSION` to 1.5.4 or call voice acceptance complete until these tests and the remaining A–L/fallback/reboot gates are reviewed.
