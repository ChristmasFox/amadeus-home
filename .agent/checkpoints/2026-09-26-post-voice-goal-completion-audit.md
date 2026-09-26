# Post-Voice Goal requirement audit — 2026-09-26

This is a **non-completion audit**, not a waiver. Source of truth: clean/pushed canonical `main`, live M204/CasaOS/TTS, the active Goal, `docs/reports/AMADEUS_TTS_PERFORMANCE_2026_09.md` plus numeric JSON, and dated protected checkpoints. Historical chat alone is not evidence.

| Goal item | Current evidence | Determination |
| --- | --- | --- |
| Phase 0 branch/source hygiene | 1.5.9 source verified against original live image; main fast-forwarded to 1.6.0; both merged work branches removed. | Proven |
| Phase 1 reduced ceremony/context | AGENTS/checkpoint policy, 21-line current task, concise context/project state, history retained. | Proven |
| Phase 2 offline targeted verification | `verify:voice` ~4s, `verify:amadeus`, `verify:openclaw-patch`, read-only `accept:voice --apply`, workflow tests; full suite separate. | Proven |
| Phase 3 hot-path timing and bounded queue | Sanitized queue/model/WAV/encode/total/RTF, explicit unsplittable library boundary, one worker+one pending, 503 busy/shutdown tests and live contention. | Proven |
| Phase 4 reference/language matrix | A/C/D/E × Auto/Japanese × three fixtures have five warmed successes; B Auto short and B Japanese long complete. Four B configs ended after 0–2 successes and a protected 110s watchdog stop; B crop transcript alignment was tentative. | **Incomplete**: explicit five-runs-per-config/clean B requirement not proven. Do not impute or lengthen timeout. |
| Phase 5 1.7B MLX PoC | Pinned community 8-bit source/model, A/D same fixtures, 12 configs × five warmed runs, startup/RTF/memory/quality and isolated engine contract; owner ultimately accepted A+MLX. | Proven for selected A; 0.6B not needed. |
| Phase 6 narrow pinned patch | Script 419→264 lines, pure policy/lease modules tested, pinned core/TTS transformed SHA byte-identical, module bundle/anchor fail-closed tests. | Proven |
| Phase 7 Docker cache | Protected host logs: patch-only 39s→3s, plugin dist-only 1s with OS/glibc/npm cached; immutable release image and no-build Compose switch. | Proven |
| Phase 8 optional packaging | Direct Opus not selected because MP3 encode tens–hundreds of ms and cross-channel PTT equivalence unproven; optional by Goal. | Explicitly deferred |
| Candidate, quality, report, release | A+MLX single backend, original A/Auto, owner handset voice/typed/one-PTT confirmation both candidate and post-release; numeric report verifier passes; full build/typecheck/test/secrets, immutable 1.6.0 image, protected rollback, health, owner notice, `main` push. | Proven within observed acceptance scope |
| Performance/memory claim | Short HTTP 20-run p50 3.30s/p95 3.52s; one post-release real turn 22.772s end-to-end. MLX footprint peak 18.4 GiB, swap transiently rose then declined. Report does not claim real p95 or zero long-term memory risk. | Evidence bounded honestly |

The full Goal must remain **active** because the Phase 4 B requirement is not proven. Follow `.agent/tasks/2026-09-26-b-icl-reference-matrix.md` in a safe isolated window; do not claim completion from the successful release or a verifier that intentionally labels the four missing cells.
