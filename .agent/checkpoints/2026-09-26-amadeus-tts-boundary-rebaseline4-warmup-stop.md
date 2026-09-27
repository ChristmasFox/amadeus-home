# Amadeus TTS boundary benchmark — rebaseline-4 warmup safety stop — 2026-09-26 UTC

## Scope and control

Measurement-only continuation of `docs/AMADEUS_TTS_PRODUCTION_BOUNDARY_STRESS_GOAL.md`. Production TTS configuration remained immutable; no version, deployment, or policy change occurred.

- Protected run: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-stress-2026-09-rebaseline-4` (root mode 0700; evidence files mode 0600).
- Predecessor stop: `boundary-stress-2026-09-rebaseline-3`, preserved separately with two excluded warmups; this run contains no imported rows/audio.
- Control ID `prod-1.6.2-a-mlx-auto-interactive`; Git baseline `858eaea783d51a2183732697bce059d8c03c8137`, Amadeus `1.6.2`.
- Fixture SHA-256 `2342110427127531e30f18b7c8d350d367d5b2364b7329a6d8117155729a505c`; frozen schedule SHA-256 `ccf30683b6b1cf0d6c7ce69ec9876466d1c09393857c220bafa4ffeed0141a3f`, seed `20260927`.
- Verified control: protected A unchanged; MLX / Auto / Interactive / MP3; one worker plus one pending slot; 5-second admission wait; 120-second external timeout; `MAX_TEXT=1200`; PID `50062`, LaunchAgent `runs=1`, `/healthz=ready`; 9Router host route ready.
- Before this attempt, the prior control’s swap had returned below its +512 MiB guard and remained so across 30-second snapshots without growth; no service restart was used to achieve the recovery.

## Warmup stop

- One required excluded 50-character A warmup was submitted and returned a valid MP3: endpoint 6,782.9 ms. It is excluded from quantiles and is not a matrix observation.
- Swap increased by 1,124,010,558 bytes (~1.05 GiB) over the fresh control. The post-request safety confirmation saw 67% minimum system memory free and a declining, but still elevated, swap delta. Before a second warmup, the next safety check did not observe the required clear decline across its 120-second idle confirmation and stopped the phase with `swap_growth_over_512_mib_persisted_without_clear_decline_after_120s_idle_confirmation`.
- No anchor, probes, matrix, soak, contention, or recovery requests were submitted in this run.
- At 2026-09-26 21:18 UTC, after the stop, the same service remained ready at PID `50062`, `runs=1`, with 71% memory free and swap 6,611.75/8,192 MiB used (1,580.25 MiB free), approximately 730 MiB above this run’s control. The sanitized service-event scan found no parsed TTS event after the benchmark cursor; no benchmark process remained active.

## Evidence and recovery

- Stop marker, control manifest, and the single excluded warmup row are preserved only in the protected external run root above.
- Reproducible public report/data record this as a separate stop; no warmup is pooled into matrix quantiles. Raw audio, token, protected voice bytes, and user content remain outside Git.
- Keep this run intact. Do not send more requests to it or restart the service. Further measurement requires ambient swap to clear and stabilize, followed by a fresh protected control/run; do not change production parameters or policy.
