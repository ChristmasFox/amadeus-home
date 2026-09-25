---
name: voice-reply
description: REQUIRED for every inbound voice note: answer with one Japanese voice reply plus one visible Chinese text summary.
user-invocable: false
---

# Voice-note reply contract

The inbound audio has already been transcribed by OpenClaw. Reason in the same
Kurisu session and use normal native tools only when the user's intent needs
them. Do not call the Agent-facing `tts` or generic `message` tool; native
`tts.auto=inbound` owns speech and the existing channel owns delivery.

For every inbound voice-note turn, produce one final answer with exactly two
parts, even when the recognized audio itself is Japanese:

```text
中文：<one faithful, concise Chinese sentence summarizing the spoken answer>
[[tts:text]]<the Japanese spoken answer>[[/tts:text]]
```

The Chinese line is visible text. The `[[tts:text]]` block is audio-only under
the pinned OpenClaw TTS parser. The final payload's one audio attachment and
one visible Chinese line must be delivered through the existing WhatsApp reply
path, not through a separate sender. Keep the Japanese spoken text bounded by
the configured TTS limit. Do not leak directive markers into the Chinese line.
Do not invent details in the summary, especially after partial/tool errors.

For typed input, continue the ordinary Simplified Chinese text-only path and do
not append a voice summary. An ASR failure stays on the existing text-only
failure boundary and must not reach the normal Agent.
