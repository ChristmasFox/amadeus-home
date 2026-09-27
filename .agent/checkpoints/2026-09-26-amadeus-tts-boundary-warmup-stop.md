# Amadeus TTS boundary benchmark — warmup safety stop — 2026-09-26 UTC

## Scope

Measurement-only continuation of `docs/AMADEUS_TTS_PRODUCTION_BOUNDARY_STRESS_GOAL.md`. No production service configuration, model, voice, language, output contract, worker/queue limit, timeout, or `MAX_TEXT` changed. No deployment or version change occurred.

## Protected run and immutable control

- External run root: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-stress-2026-09-rebaseline-3` (private mode 0700; evidence files private mode 0600).
- Fixture manifest SHA-256: `2342110427127531e30f18b7c8d350d367d5b2364b7329a6d8117155729a505c`.
- Frozen schedule SHA-256: `ccf30683b6b1cf0d6c7ce69ec9876466d1c09393857c220bafa4ffeed0141a3f`, seed `20260927`.
- Control commit `858eaea783d51a2183732697bce059d8c03c8137`, Amadeus `1.6.2`; original protected A reference verified unchanged; MLX / Auto / Interactive / MP3; one worker plus one pending slot; 5-second admission wait; 120-second external timeout; `MAX_TEXT=1200`.
- Same service PID `50062`, LaunchAgent `runs=1`, `/healthz=ready`; 9Router host route ready at control capture.

## Workload and stop

- Three excluded 50-codepoint A warmups are required before the anchor. Two were submitted and returned valid MP3 responses: client times 6,752.7 ms and 6,132.4 ms. Both are excluded from all quantiles and are not length-matrix samples.
- The second warmup’s post-request safety checks recorded swap growth above 512 MiB. The harness waited through four 30-second confirmations. Before a third warmup, the persistent-growth guard did not observe the required clear decline across its next 120-second idle confirmation and stopped the phase with `swap_growth_over_512_mib_persisted_without_clear_decline_after_120s_idle_confirmation`.
- Maximum recorded swap growth from this run’s control was 1,393,232,445 bytes (1.30 GiB); minimum memory-free sample was 66%. No anchor, probes, matrix, soak, contention, or recovery requests were sent in this run.
- At 2026-09-26 20:58 UTC, after the stop, the same LaunchAgent remained healthy at PID `50062`, `runs=1`; memory free was 73%; swap was 6,782,063,738 / 8,589,934,592 bytes used (1,807,870,853 bytes free), approximately 0.77 GiB above this run’s control baseline. No TTS request or service restart followed the stop; the sanitized service-event scan found no parsed synthesis/busy/failure event after the benchmark cursor, and the benchmark session exited. A later read-only observation at 2026-09-26 21:04 UTC still showed health ready/PID `50062`, 73% system memory free, and swap 6,403.88/7,168 MiB used (764.12 MiB free), 724 MiB above the fresh control baseline; no new phase was started.

## Evidence and recovery

- The stop marker and two excluded warmup rows are preserved in the external run root above. No raw audio or private voice/user content is copied to Git.
- Reproducible content-free report and JSON include this as a separate attempt, not pooled with the primary partial matrix: `docs/reports/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.md` and `docs/reports/data/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.json`.
- This is an experiment stop, not a production policy decision. Keep all protected attempts; do not restart the LaunchAgent or submit more requests to this run. Any later measurement requires a fresh control/root after ambient memory/swap has settled.
