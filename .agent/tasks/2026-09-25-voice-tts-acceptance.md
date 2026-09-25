# Verify WhatsApp PTT after Amadeus 1.5.8 TTS recovery

- Status: source fix pushed and deployed. Qwen host health and direct short synthesis pass; OpenClaw-container → 9Router → Qwen short-speech smoke passes with a valid audio response in ~8 seconds.
- User acceptance remains pending: send one fresh WhatsApp voice note and confirm it produces the Japanese PTT/voice bar plus the existing Chinese summary and Japanese text separated by a blank line. Keep typed-only behavior unchanged.
- If the voice bar is still absent, collect only that turn's sanitized TTS/9Router result; do not extend the existing 120-second timeout without explicit agreement.
