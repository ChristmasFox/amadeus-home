# Post-Voice candidate owner handset acceptance — 2026-09-26

- Following explicit question whether the WhatsApp phone received exactly one Japanese PTT, visible text was not duplicated, and an ordinary typed message did not trigger voice, the owner answered “没有问题” (no problem). This is the owner-side confirmation of those three requested observations; no message contents, transcript, JID or voice bytes are recorded here.
- Sanitized post-candidate transport evidence recorded separately in `.agent/checkpoints/2026-09-26-post-voice-real-whatsapp-candidate.md`: two audio inbounds, each followed by one media-send event, inbound-to-media 22.577s/20.743s; TTS 9.331s/9.907s. This is not a statistical real-world p95.
- Accepted configuration is original A private ~46s profile, official Qwen3-TTS 1.7B MPS/FP16, Auto language, Interactive LaunchAgent. Owner rejected short D and MLX for voice character. No new Voice feature or extra runtime was added.
- OpenClaw candidate and TTS source-sync checkpoints remain available; this acceptance closes the handset/typed-boundary gate for the candidate, not the final release build/report/checkpoint gate.
