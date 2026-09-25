# Amadeus 1.5.4

Make bilingual WhatsApp voice replies deterministic through the final delivery path.

- Add a visible Japanese kanji-and-kana line derived from the exact Japanese TTS speech, alongside the Chinese summary for voice replies.
- Keep typed-only replies Chinese-only, serialize consecutive voice turns through the normal TTS path, and maintain composing status through final delivery.
