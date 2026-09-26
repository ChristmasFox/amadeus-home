# Current Task — Post-Voice Engineering & TTS Performance

Date: 2026-09-26. Authoritative scope: `docs/AMADEUS_POST_VOICE_ENGINEERING_PERFORMANCE_GOAL.md`.

- Phase 0: production 1.5.9 source and rollback verified; Voice branch fast-forwarded into canonical `main` and pushed. New short-lived branch: `work/post-voice-engineering-performance`.
- Phase 1: completed context/ceremony reduction; historical diaries retained. Architecture/workflow/secrets/diff checks passed in commit `477771a`.
- Phase 2: offline `verify:voice`, `verify:amadeus`, `verify:openclaw-patch` and explicit `accept:voice` entry added; baseline ad-hoc verification 4.01s, new entry 4.05s on this Mac (6 Python tests, 1 optional encoder skip; 4 selected plugin tests plus patch fixtures/typecheck). No model download, MPS, Docker, deploy. Targeted workflow ownership and offline tests pass.
- Phase 3: source instrumentation now separates lock wait, upstream model boundary, WAV serialization, encode, total and RTF. Offline fake-model test covers lock contention; real MPS baseline and bounded-queue evaluation still pending. Next in phase order: controlled reference/language matrix; MLX PoC; patch shrink; Docker caching; optional audio packaging; candidate acceptance and final release.
- Do not change TTS model/profile/language/backend before the baseline and measurement gates. No timeout increase, new Voice features, or second runtime.

Open items requiring independent evidence: owner confirmation of the 1.5.9 group audio/text result; real MPS/MLX benchmark and owner listening; runtime acceptance and production release. The optional media adapter is absent; strict doctor reports this known non-Voice failure. Historical details remain in `docs/history/` and `.agent/checkpoints/`.
