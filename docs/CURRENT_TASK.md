# Current Task — Post-Voice Engineering & TTS Performance

Date: 2026-09-26. Scope and acceptance: `docs/AMADEUS_POST_VOICE_ENGINEERING_PERFORMANCE_GOAL.md`.

## Current phase

Phases 0–7 have source, focused tests, measured benchmarks and protected runtime candidates. Phase 8's optional direct-Opus shortcut was declined: MP3 encode is minor compared with model variance, and native WhatsApp PTT equivalence was not proven. **Current work is the owner-approved A+MLX backend candidate, its real memory/WhatsApp acceptance, then final report and release**, not further Voice feature development.

## Selected configuration and evidence

- Owner retained original A (~46s private reference) and `language=Auto`, rejected D. After comparing the exact A/MPS versus A/MLX direct sample, owner found A+MLX acceptable and requested implementation; live A+MLX handset quality is not yet proven. The host LaunchAgent uses `ProcessType=Interactive`; no model/profile/timeout increase or second runtime.
- Same short-fixture HTTP A/B/A/B: Background reversal p50 10.39s; Interactive 20-run p50 4.48s/p95 5.28s. Post-source-sync five-run p50 4.64s/p95 5.17s. Real post-candidate WhatsApp turns: TTS 9.33s/9.91s; inbound→media 22.58s/20.74s. Owner confirmed one Japanese PTT, nonduplicated text and typed input without voice. These two real turns are not a distribution.
- MPS/MLX controlled matrix and Docker patch-only cache build (39s→3s) are in dated checkpoints. Four B ICL configs were stopped by a 110s fail-closed benchmark watchdog; they are **not** five-successful-run configurations and must be marked incomplete in the report. No B/D promotion; MLX is candidate-only pending real acceptance.

## Remaining gates

1. A+MLX single-engine candidate is live with protected MPS rollback. Fixed HTTP short 20-run p50 3.30s/p95 3.52s, normal 5-run p50 5.42s; cold Metal footprint peaked 17.5 GiB and swap rose ~3 GiB before stabilizing. Four real post-MLX WhatsApp voice turns had TTS 5.947/5.824/7.533/6.420s and one media send each; owner confirms A timbre, visible text and ordinary typed input are normal. One synthetic request hit bounded `503 tts_busy` during a fifth real voice (which still delivered); technical acceptance is now read-only unless benchmark explicitly requested. Monitor memory and rollback on regressions. Then finalize and verify the content-free, machine-checkable `docs/reports/AMADEUS_TTS_PERFORMANCE_2026_09.md` with all 13 required sections, B timeout limitation, memory snapshot, quality verdict and rollback.
2. Run full release tests, type/build, secrets scan and source checks; bump the single version via `scripts/amadeus-version.sh bump patch`, replace single-release Chinese notes, commit/push clean source.
3. Explicit immutable CasaOS release apply with protected checkpoint, health/smoke, owner release notification and post-release WhatsApp voice/typed acceptance; record final evidence. Fast-forward/push canonical `main` only after verified release.

Known non-Voice doctor issue: optional `media-organizer-adapter` is absent. No fallback or second sender. History is in `.agent/checkpoints/` and `docs/history/`, not in this startup file.
