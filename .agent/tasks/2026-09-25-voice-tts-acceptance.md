# Verify WhatsApp PTT after Amadeus 1.5.8 TTS recovery

- Status: completed. Source fix pushed/deployed as 1.5.8; Qwen host health and direct short synthesis passed, and OpenClaw-container → 9Router → Qwen short-speech smoke returned valid audio in ~8 seconds. User confirmed “现在正常了” after testing WhatsApp.
- WhatsApp end-to-end acceptance is now confirmed by the user; typed-only behavior remains unchanged.
- Retain the existing 120-second timeout; do not extend it without explicit agreement.
