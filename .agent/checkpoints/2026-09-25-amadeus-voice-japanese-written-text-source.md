# 2026-09-25 — Japanese written-text addition for voice replies (source candidate)

## Contract change

- User asked that voice replies also display Japanese in kana + Japanese kanji.
- Existing Chinese summary and Japanese PTT remain. Voice output is now three parts: one faithful Chinese summary line, one natural Japanese kanji/kana text line, and one audio-only TTS directive whose spoken sentence must exactly match the Japanese visible line.
- Use natural kanji, hiragana and katakana rather than romaji; optional parenthesized kana readings for uncommon kanji. Keep the same short spoken-text/safety constraints.
- Scope stays inside the verified WhatsApp audio-run Skill; typed-only replies remain ordinary Simplified Chinese and must not gain Japanese text or TTS.

## Validation

- `scripts/test-openclaw-bilingual-voice.mjs` uses the pinned OpenClaw 2026.9.4 parser to assert Chinese and Japanese visible text survive, the TTS directive yields exactly the matching Japanese sentence, that sentence includes kanji and kana, and typed-only input has no TTS.
- Amadeus manifest test asserts the injected voice Skill includes the Japanese visible-line contract.
- Targeted voice parser and Amadeus plugin tests passed. The source was committed/pushed as `fb1d457` and deployed as a same-version candidate; see `.agent/checkpoints/2026-09-25-amadeus-voice-japanese-written-text-candidate.md`.

## Next

Run full tests/typecheck/secrets, commit/push, build/apply one same-version candidate with an external checkpoint. Owner should verify one voice turn and two consecutive group voice turns: Japanese written line matches the PTT, Chinese summary remains concise, each input receives its own PTT, and later same-session input stays FIFO.
