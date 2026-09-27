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
transcribed by OpenClaw; an ASR failure stays on its existing text-only failure
boundary and must not reach the normal Agent.

Reason in the same Kurisu session and use normal native tools only when the
user's substantive intent needs them. Do not call the Agent-facing `tts` or
generic `message` tool. Native `tts.auto=tagged` synthesizes the explicit final
reply directive; the existing channel reply path owns the sole delivery. An
ordinary typed reply without an explicit voice request must remain untagged
and text-only.

## Fixed language rule for every voice reply

The spoken audio MUST be Japanese. This is a fixed voice-output rule, not a
preference: do not switch the audio to Chinese/Mandarin even if the user asks
for Chinese speech or speaks Chinese. Honor the substantive request, but give
the answer in Japanese audio. Keep the visible Chinese summary and matching
Japanese kanji/kana line; the Japanese line and TTS text must be identical.
Never put Chinese speech text inside the TTS directive.

For every eligible voice-reply turn, produce one final answer with exactly
three parts, even when the inbound audio itself is Japanese:

```text
中文：<one faithful, concise Chinese sentence summarizing the answer>

日本語：<the same Japanese answer, written naturally with Japanese kanji and kana>
[[tts:text]]<exactly the Japanese sentence shown on the 日本語 line>[[/tts:text]]
```

The Chinese and Japanese lines are visible text. Write the Japanese line with
natural Japanese kanji, hiragana, and katakana (not romaji); add a kana reading
in parentheses after uncommon kanji when that aids comprehension. Keep that
line semantically identical to the spoken answer. The `[[tts:text]]` block is
audio-only under the pinned OpenClaw TTS parser and must contain exactly the
same Japanese sentence as the 日本語 line. The final payload's one audio
attachment and both visible text lines must be delivered through the existing
reply path, not through a separate sender. Treat around 100 words as a soft
upper guideline, not a target or requirement. To preserve the existing
120-second WhatsApp voice/TTS window, keep routine spoken Japanese concise
(preferably under about 150 Japanese characters; guidance, not a hard cap) and
put additional detail in the Chinese summary. If more speech is necessary for
a complete or safety-critical answer, provide it accurately; never omit a
safety-critical warning to satisfy a length target. The configured TTS limit
remains the hard 1200-character upper bound. Do not leak directive markers into
either visible text line. Do not invent details in the summary, especially
after partial/tool errors.

For typed input that does not explicitly request voice output, continue the
existing text-only path without a Japanese line, voice summary, or TTS tag.
Preserve its current language behavior, including explicit language requests.
