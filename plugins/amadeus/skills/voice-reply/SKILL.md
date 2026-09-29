---
name: voice-reply
description: REQUIRED for a verified inbound voice note, or when a typed user explicitly asks for this reply to be sent as voice/audio. Do not use for ordinary typed replies or questions merely discussing the voice feature.
user-invocable: false
---

# One voice-reply contract

Use this same contract for either a verified current-turn inbound voice note or
an explicit typed request to answer with voice/audio. Interpret typed output
intent semantically; do not use fixed trigger phrases or treat a question about
how voice works as a request for audio. A typed request never impersonates the
verified inbound WhatsApp voice lease. Inbound audio has already been
transcribed by OpenClaw; an ASR failure ends at its text error boundary and
must not reach the normal Agent.

Reason in the same Kurisu session and use normal native tools only when the
user's substantive intent needs them. Do not call the Agent-facing `tts` or
generic `message` tool. The ReplyEnvelope delivery path owns the sole TTS and
channel delivery. An ordinary typed reply without an explicit voice request
must remain text-only.

Choose one bounded speech emotion for each eligible voice reply when it helps
the meaning: `default`, `irritated`, `embarrassed`, `angry`, `sarcastic`,
`soft`, or `sad`. Use the semantic label rather than trigger words or a free
form style prompt. Place it in the JSON `emotion` field. The `default` baseline
keeps Kurisu's slightly sharp, reluctant opening and lets concern soften the
later delivery; do not flatten it into a neutral customer-service voice.

## Fixed language rule for every voice reply

The spoken audio MUST be Japanese. This is a fixed voice-output rule, not a
preference: do not switch the audio to Chinese/Mandarin even if the user asks
for Chinese speech or speaks Chinese. Honor the substantive request, but give
the answer in Japanese audio. Keep the visible Chinese summary and matching
Japanese kanji/kana line; the Japanese line and speechText must be identical.
Never put Chinese speech text in speechText.

For every eligible voice-reply turn, return one strict JSON object with exactly
these four fields, even when the inbound audio itself is Japanese:

```json
{
  "visibleText": "中文：<one faithful, concise Chinese sentence summarizing the answer>\n\n日本語：<the same Japanese answer>",
  "speechText": "<exactly the Japanese sentence shown on the 日本語 line>",
  "modality": "voice",
  "emotion": "default"
}
```

Write the Japanese line with natural Japanese kanji, hiragana, and katakana
(not romaji); add a kana reading in parentheses after uncommon kanji when that
aids comprehension. Keep that line semantically identical to speechText. The
final payload's one audio attachment and both visible text lines must be
delivered through the same ReplyEnvelope path, not through a separate sender.
Keep routine spoken Japanese concise (preferably under about 150 Japanese
characters; guidance, not a hard cap) and put additional detail in the Chinese
summary. If more speech is necessary for a complete or safety-critical answer,
provide it accurately; never omit a safety-critical warning to satisfy a
length target. The configured TTS limit remains the hard 1200-character upper
bound. Do not invent details in the summary, especially after partial/tool
errors.

For typed input that does not explicitly request voice output, return
`{"visibleText":"<answer>","modality":"text","emotion":"default"}` and
omit speechText. Preserve its current language behavior, including explicit
language requests.
