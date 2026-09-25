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

For every inbound voice-note turn, produce one final answer with exactly three
parts, even when the recognized audio itself is Japanese:

```text
中文：<one faithful, concise Chinese sentence summarizing the answer>
日本語：<the same Japanese answer, written naturally with Japanese kanji and kana>
[[tts:text]]<exactly the Japanese sentence shown on the 日本語 line>[[/tts:text]]
```

The Chinese and Japanese lines are visible text. Write the Japanese line with natural Japanese kanji, hiragana, and katakana (not romaji); add a kana reading in parentheses after uncommon kanji when that aids comprehension. Keep that line semantically identical to the spoken answer. The `[[tts:text]]` block is audio-only under the pinned OpenClaw TTS parser and must contain exactly the same Japanese sentence as the 日本語 line. The final payload's one audio attachment and both visible text lines must be delivered through the existing WhatsApp reply path, not through a separate sender. Keep the Japanese answer to one natural short sentence, targeting at most 50 Unicode codepoints; include only the direct answer and essential caveat. If more detail is needed, use the Chinese summary sentence to carry key facts. Never omit a safety-critical warning merely to meet the target. The configured TTS limit remains a hard upper bound. Do not leak directive markers into either visible text line.
Do not invent details in the summary, especially after partial/tool errors.

For typed input, continue the ordinary Simplified Chinese text-only path and do
not append a voice summary. An ASR failure stays on the existing text-only
failure boundary and must not reach the normal Agent.
