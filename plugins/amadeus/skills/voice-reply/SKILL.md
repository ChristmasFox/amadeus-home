---
name: voice-reply
description: REQUIRED for every inbound voice note: answer with one Japanese voice reply, one visible Japanese kanji-kana line, and one visible Chinese text summary.
user-invocable: false
---

# Voice-note reply contract

The inbound audio has already been transcribed by OpenClaw. Reason in the same
Kurisu session and use normal native tools only when the user's intent needs
them. Do not call the Agent-facing `tts` or generic `message` tool; native
`tts.auto=inbound` owns speech and the existing channel owns delivery.

## Fixed language rule for voice replies

For every reply triggered by an inbound voice note, the spoken audio MUST be
Japanese. This is a fixed voice-output rule, not a preference: do not switch
the audio to Chinese/Mandarin even if the user explicitly asks for a Chinese
spoken reply or speaks Chinese. Honor the user's substantive request, but give
the answer in Japanese in the audio. Keep the existing visible Chinese summary
and matching Japanese kanji/kana line; the Japanese line and TTS text must
remain identical. Never put Chinese speech text inside the TTS directive.

This rule applies only to voice output. For typed-only input, preserve the
existing ordinary text-message behavior, including the user's explicit
language request. Do not add a voice reply, Japanese line, or voice summary to
typed-only messages.

For every inbound voice-note turn, produce one final answer with exactly three
parts, even when the recognized audio itself is Japanese:

```text
中文：<one faithful, concise Chinese sentence summarizing the answer>

日本語：<the same Japanese answer, written naturally with Japanese kanji and kana>
[[tts:text]]<exactly the Japanese sentence shown on the 日本語 line>[[/tts:text]]
```

The Chinese and Japanese lines are visible text. Write the Japanese line with natural Japanese kanji, hiragana, and katakana (not romaji); add a kana reading in parentheses after uncommon kanji when that aids comprehension. Keep that line semantically identical to the spoken answer. The `[[tts:text]]` block is audio-only under the pinned OpenClaw TTS parser and must contain exactly the same Japanese sentence as the 日本語 line. The final payload's one audio attachment and both visible text lines must be delivered through the existing WhatsApp reply path, not through a separate sender. Treat around 100 words as a soft upper guideline, not a target or a requirement. To preserve the existing 120-second WhatsApp voice/TTS window, keep routine spoken Japanese concise (preferably under about 150 Japanese characters; this is guidance, not a hard cap) and put additional detail in the Chinese summary. If more speech is necessary for a complete or safety-critical answer, provide it accurately; never omit a safety-critical warning to satisfy a length target. The configured TTS limit remains a hard upper bound. Do not leak directive markers into either visible text line.
Do not invent details in the summary, especially after partial/tool errors.

For typed input, continue the existing text-only path and do not append a voice
summary. Preserve its current language behavior, including explicit language
requests. An ASR failure stays on the existing text-only
failure boundary and must not reach the normal Agent.
