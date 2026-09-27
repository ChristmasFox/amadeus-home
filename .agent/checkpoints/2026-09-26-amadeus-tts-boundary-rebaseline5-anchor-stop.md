# Amadeus TTS boundary benchmark — rebaseline-5 free-swap safety stop — 2026-09-26 UTC

## Scope and control

Measurement-only continuation of `docs/AMADEUS_TTS_PRODUCTION_BOUNDARY_STRESS_GOAL.md`. Production TTS configuration, model, voice, language, worker/queue policy, timeout, output format, `MAX_TEXT`, and production policy were not changed. No restart or deployment occurred.

- Protected run: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-stress-2026-09-rebaseline-5` (root mode 0700; raw evidence files mode 0600).
- Predecessor: `boundary-stress-2026-09-rebaseline-4`; no prior samples/audio were imported.
- Control ID `prod-1.6.2-a-mlx-auto-interactive`; Git baseline `858eaea783d51a2183732697bce059d8c03c8137`, Amadeus `1.6.2`.
- Fixture SHA-256 `2342110427127531e30f18b7c8d350d367d5b2364b7329a6d8117155729a505c`; frozen schedule SHA-256 `ccf30683b6b1cf0d6c7ce69ec9876466d1c09393857c220bafa4ffeed0141a3f`, seed `20260927`.
- Control: protected A unchanged; MLX / Auto / Interactive / MP3; one worker plus one pending slot; 5-second admission wait; 120-second external timeout; `MAX_TEXT=1200`; PID `50062`, LaunchAgent runs=1, `/healthz=ready`; 9Router route ready.
- This attempt records the benchmark-only passive swap-growth confirmation cap as 12 × 30 seconds. The +512 MiB persistent-growth trigger, 512 MiB free-swap hard stop, <10% memory stop, ≥20 GiB footprint stop, and ≥2 GiB immediate swap-growth stop were unchanged. It only waits without adding synthesis requests.

## Warmups, anchor, and stop

- All three required 50-codepoint A warmups returned valid MP3 responses: 7,050.0, 6,167.1, and 6,409.0 ms. They are excluded from quantiles.
- One 50-codepoint A pre-stress anchor returned a valid MP3 at 6,589.4 ms. This is one point only; it is not the required n=20 control distribution and is not a length-matrix sample.
- For that anchor row, free swap was 923,921,285 bytes before synthesis and 396,886,016 bytes afterward (~378.6 MiB), below the run-manifest hard threshold of 536,870,912 bytes (512 MiB). The run stopped before any further TTS request. System memory free after the row was 69%.
- The saved phase marker text says `system_free_swap_below_256_mib_safety_guard`. This is a stale error label: the immutable run manifest and source both configure a 512 MiB stop, and the saved row measured free swap below 512 MiB. The original external marker is preserved; source now reports the correct 512 MiB label for future runs.
- At 2026-09-26 21:36:43 UTC, after stop, `/healthz` remained ready, PID `50062`, memory free was 72%, and swap was 7,077.50/8,192 MiB used (1,114.50 MiB free). The sanitized service-event scan found no synthesis/busy/failure log event after the saved benchmark cursor; the benchmark session exited. No restart occurred.
- No probe beyond the 50-character anchor, matrix bucket, soak, contention, recovery anchor, or representative listening sample was collected in this run.

## Evidence and disposition

- Keep the control manifest, frozen schedule, warmup rows, anchor row, and stop marker in the protected external run directory above. Do not edit the historical marker or resume this stopped run.
- The generated public report/data include this as a separate attempt; warmups and the single anchor are not pooled with matrix statistics. The stale threshold label is explicitly noted.
- This repeated host swap/free-swap stop blocks further safe measurement. Do not weaken the experiment guard, stop/restart OrbStack production services, change TTS configuration, or choose an output policy. Resume only after additional safe host swap headroom is available and a fresh ambient control is captured.
