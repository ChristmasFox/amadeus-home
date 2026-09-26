# Current Task — Post-Voice Engineering & TTS Performance

Date: 2026-09-26. Authoritative scope: `docs/AMADEUS_POST_VOICE_ENGINEERING_PERFORMANCE_GOAL.md`.

- Phase 0: production 1.5.9 source and rollback verified; Voice branch fast-forwarded into canonical `main` and pushed. New short-lived branch: `work/post-voice-engineering-performance`.
- Phase 1: reduced startup context and ordinary development ceremony; old diaries retained in `docs/history/`. Local checks and commit still pending.
- Next, in phase order: targeted verification/wall-time measurements; TTS instrumentation and bounded-queue evaluation; controlled reference/language matrix; MLX PoC; patch shrink; Docker caching; optional audio packaging; candidate acceptance and final release.
- Do not change TTS model/profile/language/backend before the baseline and measurement gates. No timeout increase, new Voice features, or second runtime.

Open items requiring independent evidence: owner confirmation of the 1.5.9 group audio/text result; real MPS/MLX benchmark and owner listening; runtime acceptance and production release. The optional media adapter is absent; strict doctor reports this known non-Voice failure. Historical details remain in `docs/history/` and `.agent/checkpoints/`.
