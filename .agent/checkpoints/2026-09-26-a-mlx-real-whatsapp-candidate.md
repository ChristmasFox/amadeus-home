# A+MLX real WhatsApp candidate observation — 2026-09-26

- After the owner-requested one-engine A+MLX/Auto switch, a real WhatsApp audio inbound was observed at 20:47:07.185 Asia/Shanghai and one `Sent media reply` at 20:47:22.455: inbound→media **15.270s**. No other media-send event appeared in the inspected window. This is transport evidence, not a handset-quality verdict.
- Sanitized native TTS log for that turn: input bucket `<=80`, generated audio 6.800s, queue 0.2ms, MLX model 5.8999s, WAV serialization 2.6ms, MP3 encode 44ms, total **5.947s**, RTF 0.868. No text, transcript, user ID, JID or audio bytes entered Git. A single real turn is not p50/p95.
- Same `com.amadeus.qwen3-tts` MLX LaunchAgent remained healthy; `vmmap` footprint ~3.3 GiB idle, prior cold peak 17.5 GiB, `memory_pressure -Q` 71% free, swap used ~6.01 GiB (below the ~6.75 GiB immediate post-switch observation). This is not long-term memory proof.
- Owner phone-side timbre/visible text/no-duplicate verdict and typed-not-triggering-TTS are still pending. Protected MPS rollback: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/protected-performance/pre-a-mlx-candidate-20260926T123834Z`.
