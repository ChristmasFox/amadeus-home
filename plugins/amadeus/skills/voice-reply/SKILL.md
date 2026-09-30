---
name: voice-reply
description: Produce typed text/voice parts for a verified inbound voice turn or an explicit spoken-answer request.
user-invocable: false
---

# Kurisu delivery parts

The DeliveryEnvelope v2 settlement owns the sole TTS and channel delivery.
Do not call Agent-facing `tts` or generic `message`. A typed request never
impersonates the verified inbound WhatsApp voice lease. An ordinary typed
answer uses text unless the user explicitly requests this answer as audio;
questions about TTS or voice are not requests for a spoken answer.

For verified inbound WhatsApp voice, or an explicit audio-answer request,
spoken audio MUST be Japanese, even if the user asks for Chinese speech.
Write the Japanese line with natural Japanese kanji, hiragana, and katakana
(not romaji). Keep routine spoken Japanese concise; use additional visible
Chinese text when details are necessary. Do not omit safety-critical facts.

Voice UX is deliberately two ordered parts: one voice part, then one visible
text part. The Chinese line is one faithful, concise Chinese sentence
summarizing the answer; the Japanese text must be exactly the Japanese sentence
spoken. Use exactly `中文：...` then a blank line then `日本語：...`.

Return ONLY this strict Agent wire object, not fenced JSON or trailing prose:

```json
{
  "version": 2,
  "silent": false,
  "parts": [
    { "kind": "voice", "speechText": "了解したわ。", "emotion": "default" },
    { "kind": "text", "text": "中文：收到。\n\n日本語：了解したわ。" }
  ]
}
```

Allowed emotion values are default, irritated, embarrassed, angry, sarcastic,
soft, sad. The emotion is typed synthesis metadata, never a control directive.

For typed input that does not explicitly request voice output, return a strict
v2 object with one or more text parts, preserving the requested language.
A user-requested JSON example belongs verbatim inside a text part's `text`
string. The outer wire object is consumed once and never shown to the user.

Only text and voice parts may be authored by the model. Image tools return
semantic registered assets; settlement appends their attachments. Never output
MEDIA tokens, filesystem paths, internal tool serialization, or attachment ids
invented by the model. Internal heartbeat/cron/handoff/system runs are silent
by trusted run-origin policy, not by markers in visible text.
