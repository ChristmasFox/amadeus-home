# Amadeus TTS boundary benchmark — rebaseline-6 anchor safety stop — 2026-09-26 UTC

## Scope and control

Measurement-only continuation of `docs/AMADEUS_TTS_PRODUCTION_BOUNDARY_STRESS_GOAL.md`. Production TTS parameters and policy remain unchanged; no service restart, deployment, or version change occurred.

- Protected run: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-stress-2026-09-rebaseline-6` (root 0700; evidence files 0600).
- Control ID `prod-1.6.2-a-mlx-auto-interactive`; Git baseline `858eaea783d51a2183732697bce059d8c03c8137`, Amadeus `1.6.2`.
- Fixture SHA-256 `2342110427127531e30f18b7c8d350d367d5b2364b7329a6d8117155729a505c`; schedule SHA-256 `ccf30683b6b1cf0d6c7ce69ec9876466d1c09393857c220bafa4ffeed0141a3f`, seed `20260927`.
- Protected A unchanged; MLX / Auto / Interactive / MP3; one worker / one pending slot; 5-second admission wait; 120-second external timeout; `MAX_TEXT=1200`; PID `50062`, LaunchAgent runs=1, `/healthz=ready`; 9Router route ready.
- This run used the benchmark-only 12 × 30-second passive swap confirmation. The configured 512-MiB free-swap hard stop and all other immediate safety limits remained unchanged.

## Samples and safety stop

- Three required excluded 50-codepoint A warmups completed and remain excluded from quantiles.
- Two 50-character A pre-stress anchor requests succeeded at 6,323.4 and 6,397.7 ms. These are only two observations, not the required n=20 control distribution, not length-matrix rows, and not representative-listening selections.
- After the second anchor, free swap measured 456,067,645 bytes (~435.2 MiB), below the configured 536,870,912-byte (512 MiB) hard stop. The phase stopped before a third anchor request. System memory free in that row was 70%.
- At 2026-09-26 21:56:36 UTC, the same service remained ready at PID `50062`; memory free was 72%; system swap was 7,629.06/8,192 MiB used (562.94 MiB free). The sanitized service-event scan found no TTS event after the benchmark cursor; the benchmark session exited. No service restart occurred.
- No probes, matrix, soak, contention, recovery anchor, or representative listening artifact were collected in this run.

## Evidence and disposition

- Keep the frozen manifest, control, warmups, anchor rows, and stop marker in the protected external run directory; do not resume it.
- The public report/data list this as a separate stop; the two anchor points are excluded from the 20-sample distribution and matrix statistics.
- The repeated hard free-swap stop blocks safe continuation under current host headroom. Do not weaken the guard, change production TTS parameters, or choose a boundary policy. Resume only after additional safe host swap headroom is available and a fresh control is captured.
