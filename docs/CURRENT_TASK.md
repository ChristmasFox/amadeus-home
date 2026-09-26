# Current Task — Post-Voice Engineering & TTS Performance

Date: 2026-09-26. Authoritative scope: `docs/AMADEUS_POST_VOICE_ENGINEERING_PERFORMANCE_GOAL.md`.

## Current phase

Phases 0–3 and 5–7 have verified source/benchmarks; **Phase 4 B remains safety-incomplete**. The optional Phase 8 decision is recorded. The original A (~46s private reference) with community **1.7B MLX 8-bit ICL**, Auto language and Interactive scheduling is the **single live 1.6.0 release configuration**. Owner accepted this exact A+MLX timbre in direct listening, then confirmed real WhatsApp one Japanese PTT, nonduplicated visible text and ordinary typed input without voice. D remains rejected. No second Agent/sender, timeout increase, profile switch or direct-Opus shortcut.

## Measured evidence and limits

- A/MPS→A/MLX kept the same protected reference and OpenAI-compatible endpoint, replacing only the backend in one LaunchAgent. HTTP short 20-run A/MLX p50 3.30s/p95 3.52s; normal five-run p50 5.42s. Four real post-switch voice turns: TTS 5.95/5.82/7.53/6.42s, inbound→media 15.27/12.01/22.18/21.35s. These are not a real p95. One later real voice survived synthetic queue contention; a synthetic request, not the real request, returned bounded `503 tts_busy`.
- MLX `vmmap` cold/real footprint peak 18.4 GiB on 24 GiB host; swap rose ~3 GiB on cold switch, then declined while memory pressure recovered. Monitor this risk; protected exact A/MPS rollback is `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/protected-performance/pre-a-mlx-candidate-20260926T123834Z`.
- Four B reference matrix configs were safety-aborted at 110s, so five warmed successes are **not** claimed for them. The published numeric report explicitly marks this gap; no B promotion. BuildKit patch-only candidate improved 39s→3s, with no CasaOS build/restart for ordinary edits.

## Remaining Goal item

1. Amadeus 1.6.0 full gates, immutable CasaOS switch, protected checkpoint, owner notification and post-release real WhatsApp voice/typed acceptance passed. Canonical `main` fast-forwarded/pushed; both merged work branches were retired. Live OpenClaw release image source `c730b49` is an ancestor of main.
2. Four B reference matrix configurations remain **safety-incomplete** under the 110s watchdog. Follow `.agent/tasks/2026-09-26-b-icl-reference-matrix.md` for a clean, matched private B reference and an isolated five-run benchmark. Do not invent timings, increase timeout, stress live TTS during user traffic or mark the full Goal complete while this explicit item remains.
3. Continue read-only MLX memory-pressure/swap observation. The released A+MLX remains live with protected exact A/MPS rollback unless a real regression is observed.

Known non-Voice doctor issue: optional `media-organizer-adapter` absent. Historical evidence is in `.agent/checkpoints/` and `docs/history/`; do not treat earlier MPS-selection checkpoints as the current runtime instruction.
