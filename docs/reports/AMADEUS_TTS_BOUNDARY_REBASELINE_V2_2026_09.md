# Amadeus TTS — Production Boundary Rebaseline v2

Generated: 2026-09-27T08:54:05.298651+00:00 UTC<br>
Control ID: `prod-1.6.2-a-mlx-auto-interactive`<br>
Overall V2 status: **incomplete-safety-stopped**

Measurement-only. Production Amadeus 1.6.2 configuration and output policy were not changed. This report does not select a new text limit, segmentation rule, or lifecycle policy.

## Immutable production control

- Canonical production baseline: `bb9cfb8533c0e17a4a9e0c94a2b830a7b06eb4a6` / Amadeus `1.6.2`; measurement branch commit `bb9cfb8533c0e17a4a9e0c94a2b830a7b06eb4a6`.
- Service SHA-256 `de6780fc0b96a6dea1be790a64b9f9c72bc299f433f968ef5bfb5ade16ce393a`; engine-config SHA-256 `91e9b7383047ad59e11cc0c919604f45f0c05fa1ee729ed2cafe36ce26a9f2aa`.
- Engine/profile/language: `mlx` / `kurisu-v1` / `Auto`; protected A reference verified unchanged: `True`.
- LaunchAgent: `Interactive` / `interactive`; MP3; workers=1, pending=1, admission wait=5s.
- OpenClaw timeout=120000ms; `MAX_TEXT=1200`; port=18792; bind=`0.0.0.0`.
- Live TTS config: `{"baseUrl": "http://9router:20128/v1", "maxTextLength": 1200, "model": "amadeus-tts", "provider": "openai", "responseFormat": "mp3", "speakerVoice": "kurisu-v1", "timeoutMs": 120000}`.
- Control capture: disk plist valid `True`; active MLX mapped `True`; no production configuration change `False`.
- Host: Mac18,5, 24 GB, macOS 27.0; 9Router route `ready`.

### Three-snapshot admission baseline

| snapshot | health | PID/runs | memory free | TTS footprint | swap used/free | startup disk free | 9Router route |
| :---: | :--- | :---: | ---: | ---: | :--- | ---: | :---: |
| 1 | ready | 50062/1 | 73% | 3.30 GiB | 5.34 GiB / 1.66 GiB | 248.89 GiB | True |
| 2 | ready | 50062/1 | 73% | 3.30 GiB | 5.34 GiB / 1.66 GiB | 248.89 GiB | True |
| 3 | ready | 50062/1 | 74% | 3.30 GiB | 5.34 GiB / 1.66 GiB | 248.89 GiB | True |
Admission status: `passed`; snapshots spaced 30s; swap was accepted as stable/declining without an absolute-free-swap admission floor.

## Preserved historical safety-stop evidence

- Original evidence remains on `codex/tts-boundary-stress-2026-09` at `a6a704d5e633bd38fff8526161eb3f4c09628640`. Previous report SHA-256 `1209e8dc3870ef7f2d933d3b397ade147da288215a98309970247142c8527b80`; data SHA-256 `5a7a89cf7fceabc1288fdb85ca1c56bbe1ab2e6f0e496b07d04d978ca2da0292`. The old report/raw roots were not rewritten, and none of their rows were pooled into V2.
- Historical primary 50-character A control: 20/20 successes; endpoint p50/p95/max 5795.1 ms / 5950.1 ms / 5950.4 ms (n=20).
- Historical progressive probes passed through 600. The 800-codepoint A request took 110002.5 ms and hit `watchdog_timeout` at the 110.0s watchdog. 1000/1200: `not-retested-after-800-watchdog` / `not-retested-after-800-watchdog`.
- Historical primary matrix stop: 1 persisted row; memory free 10%, swap free 563.4 MiB. These partial 200-character observations remain excluded from percentiles and representatives.

| preserved run root | stopped phase | original stop reason | excluded warmups | anchor / matrix evidence |
| :--- | :--- | :--- | :---: | :--- |
| `boundary-stress-2026-09` | first excluded 50-character A warmup | `swap_growth_reached_512_mib_safety_guard` | 1 | anchor 0; matrix 0/0 |
| `boundary-stress-2026-09-rebaseline-1` | first excluded 50-character A warmup | `swap_growth_persisted_512_mib_after_30s_idle_confirmation` | 1 | anchor 0; matrix 0/0 |
| `boundary-stress-2026-09-rebaseline-2` | matrix | `A live read-only system snapshot during the post-request idle swap-confirmation wait showed memory free at 10% and 563.44 MiB free swap; the active matrix phase was stopped conservatively.` | 3 | anchor 20; matrix 1/1 |
| `boundary-stress-2026-09-rebaseline-3` | warmup | `swap_growth_over_512_mib_persisted_without_clear_decline_after_120s_idle_confirmation` | 2 | anchor 0; matrix 0/0 |
| `boundary-stress-2026-09-rebaseline-4` | warmup | `swap_growth_over_512_mib_persisted_without_clear_decline_after_120s_idle_confirmation` | 1 | anchor 0; matrix 0/0 |
| `boundary-stress-2026-09-rebaseline-5` | anchor-pre | `system_free_swap_below_256_mib_safety_guard` | 3 | anchor 1; matrix 0/0 |
| `boundary-stress-2026-09-rebaseline-6` | anchor-pre | `system_free_swap_below_512_mib_safety_guard` | 3 | anchor 2; matrix 0/0 |

## Revised V2 swap and memory policy

- Host-wide swap is telemetry/corroboration, not proof of TTS failure and never a standalone hard stop. Low free swap (<512 MiB) or >=512 MiB growth from the fresh run baseline starts a passive-confirmation episode: finish the current healthy request, pause new synthesis, then sample every 30s for up to 180s.
- After stable/recovering snapshots acknowledge a warning, redundant pauses are suppressed until >=512 MiB additional swap-used growth, a new crossing below 512 MiB free, or >=128 MiB further free-swap decline while already below that warning level. The change is recorded below and applies from `anchor-pre`; the three excluded warmups were completed under the prior repeated-confirmation implementation.
- Hard stops remain: health not ready; PID or LaunchAgent run-count change; memory free <=10%; TTS footprint >=20 GiB; a request reaches the 110s watchdog; repeated same-bucket synthesis failures; host/route instability; low startup-disk space combined with a swap warning; or >=2 GiB fresh swap growth corroborated by memory free <=20% or TTS footprint >=18 GiB.
- A hard stop ends the active dataset. High but stable/recovering swap with healthy PID/health and safe memory does not by itself stop the run.

### Tooling revision ledger

- Recorded in protected evidence at `anchor-pre`; prior/current benchmark and runtime source hashes are in the JSON report (`tooling_revisions`). Hard-stop thresholds remained unchanged.

## Frozen fixtures and statistics

- Fixture manifest SHA-256: `2342110427127531e30f18b7c8d350d367d5b2364b7329a6d8117155729a505c`. Historical corpus lengths: 25, 50, 100, 150, 200, 250, 320, 400, 500, 600, 800, 1000, 1200.
- Executed V2 lengths only: 25, 50, 100, 150, 200, 250, 320, 400, 500, 600; fixed seed 20260927; 200 rows; V2 schedule SHA-256 `6c307496951095b0c377e17efc78aa048f6df1e03679f9c47dd12dcbdddf7f80`.
- Schedule derivation: `preserve_relative_order_of_original_seeded_schedule_for_25_to_600`. Five cycles; fixture A=10 and B=10 measured requests per complete bucket; three excluded A-50 warmups; 2s quiet interval. Input length uses Python Unicode codepoints (`len(text)`).
- Quantile method: Hyndman-Fan type 7 (linear interpolation; h=(n-1)p). p95 is descriptive for n=20, not an SLA or a high-confidence tail estimate.

## Pre-matrix control anchor

| status | successes/attempts | endpoint p50 / p95 / max |
| :--- | :---: | :--- |
| `complete` | 20/20 | 5898.1 ms / 6680.5 ms / 6822.6 ms (n=20) |

## Progressive safety probes (excluded from quantiles)

| codepoints | status | attempts | endpoint observations |
| ---: | :--- | ---: | :--- |
| 25 | passed | 1 | 4770.9 ms (ok) |
| 50 | passed | 1 | 5793.2 ms (ok) |
| 100 | passed | 1 | 8161.2 ms (ok) |
| 150 | passed | 1 | 11332.7 ms (ok) |
| 200 | passed | 1 | 13743.8 ms (ok) |
| 250 | passed | 1 | 15930.7 ms (ok) |
| 320 | passed | 1 | 20522.2 ms (ok) |
| 400 | passed | 1 | 22075.5 ms (ok) |
| 500 | passed | 1 | 29288.3 ms (ok) |
| 600 | passed | 1 | 33761.4 ms (ok) |

Historical 800 watchdog evidence is listed above and was not re-probed. 1000 and 1200 were not included in the V2 execution scope.

## Production matrix — 25–600 codepoints

All reported complete buckets require exactly 20 successful rows (10 A + 10 B). Incomplete buckets have null distributions, never fabricated percentiles.

| chars | status | reason | success/attempts | endpoint p50/p95/max ms | model p50/p95/max ms | audio p50/p95/max ms | RTF p50/p95/max |
| ---: | :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| 25 | incomplete | matrix stopped at 250 codepoints after a request watchdog; this bucket had 12/20 successful partial rows and no bucket-specific hard stop | 12/12 | not reported | not reported | not reported | not reported |
| 50 | incomplete | matrix stopped at 250 codepoints after a request watchdog; this bucket had 12/20 successful partial rows and no bucket-specific hard stop | 12/12 | not reported | not reported | not reported | not reported |
| 100 | incomplete | matrix stopped at 250 codepoints after a request watchdog; this bucket had 12/20 successful partial rows and no bucket-specific hard stop | 12/12 | not reported | not reported | not reported | not reported |
| 150 | incomplete | matrix stopped at 250 codepoints after a request watchdog; this bucket had 12/20 successful partial rows and no bucket-specific hard stop | 12/12 | not reported | not reported | not reported | not reported |
| 200 | incomplete | matrix stopped at 250 codepoints after a request watchdog; this bucket had 12/20 successful partial rows and no bucket-specific hard stop | 12/12 | not reported | not reported | not reported | not reported |
| 250 | safety-incomplete | inflight_request_exceeded_110s_watchdog | 14/15 | not reported | not reported | not reported | not reported |
| 320 | incomplete | matrix stopped at 250 codepoints after a request watchdog; this bucket had 12/20 successful partial rows and no bucket-specific hard stop | 12/12 | not reported | not reported | not reported | not reported |
| 400 | incomplete | matrix stopped at 250 codepoints after a request watchdog; this bucket had 12/20 successful partial rows and no bucket-specific hard stop | 12/12 | not reported | not reported | not reported | not reported |
| 500 | incomplete | matrix stopped at 250 codepoints after a request watchdog; this bucket had 12/20 successful partial rows and no bucket-specific hard stop | 12/12 | not reported | not reported | not reported | not reported |
| 600 | incomplete | matrix stopped at 250 codepoints after a request watchdog; this bucket had 12/20 successful partial rows and no bucket-specific hard stop | 12/12 | not reported | not reported | not reported | not reported |

## V2 matrix hard stop and post-stop verification

- Matrix stopped immediately on `B-250` at 110002.4 ms with `watchdog_timeout`; hard-stop reason `inflight_request_exceeded_110s_watchdog`.
- Persisted matrix rows: 123; successful rows: 122; failures: 1; no request was submitted after stop by the harness.
- Post-stop service: health `ready` (HTTP 200), PID/runs 50062/1, memory free 78%, current TTS footprint 3.90 GiB, lifetime peak 19.60 GiB, swap free 0.75 GiB, route `True`. Restart: `False`.
- A late log event after the saved matrix cursor was observed: `[{'error_category': 'RuntimeError', 'type': 'synthesis_failed'}]`. Attribution is time-correlated only (the unchanged service has no request ID); it was not pooled as a successful client sample and no retry was sent.

### Fixture-family summaries

| chars | family | endpoint p50/p95/max ms | model p50/p95/max ms |
| ---: | :---: | :--- | :--- |

## Representative listening artifacts

One actual measured fixture-A MP3 nearest that bucket's fixture-A type-7 p50 is selected. MP3/text/metadata stay in the protected external run root, not Git; hashes and exact pairing are verified before report generation.

| chars | fixture | run index | endpoint ms | MP3 path | paired text | metadata |
| ---: | :--- | ---: | ---: | :--- | :--- | :--- |

Verified artifacts: 0 / 10 complete buckets. Partial measured MP3s retained outside Git: 122; no incomplete bucket was assigned a representative.

## Sequential soak

Status: `not_run`; reason: `inflight_request_exceeded_110s_watchdog`.

| chars | successes/attempts | p50/p95/max ms | first10 vs last10 p50 ms | max footprint | swap delta | min memory free | failures |
| ---: | :---: | :--- | :--- | ---: | ---: | ---: | ---: |

## Bounded-queue contention

Status: `not_run`; bursts: 10 per length; 3 simultaneous requests per burst; unchanged one-worker/one-pending/5s admission policy.

| chars | bursts | HTTP 200 | 503 tts_busy | unexpected | successful latency p50/p95/max ms | rejected latency p50/p95/max ms |
| ---: | ---: | ---: | ---: | ---: | :--- | :--- |

## Post-stress recovery anchor

| anchor | successes/attempts | endpoint p50/p95/max ms | PID | memory free | swap used | footprint |
| :--- | :---: | :--- | ---: | ---: | ---: | ---: |
| pre | 20/20 | 5898.1 / 6680.5 / 6822.6 (n=20) | 50062 | 69% | 7.78 GiB | 3.30 GiB |
| post | 0/0 | not reported | None | None% | — | — |
Post-stress median change: not comparable/incomplete. No automatic restart/eviction policy is inferred.

## Memory, swap, and footprint observations

- Matrix point-sampled TTS footprint max 14.00 GiB; process lifetime peak 19.60 GiB; RSS max 0.18 GiB.
- Matrix system memory-free minimum 67%; swap used min/max 7.08 GiB / 8.82 GiB.
- Preflight/anchor memory-free minimum 65%; swap used min/max 5.34 GiB / 8.43 GiB.
- Passive confirmation episodes: 42; individual 30-second confirmation snapshots: 84. Full sanitized telemetry is retained in the protected run root and summarized in the JSON.
- `vmmap` footprint and host `vm.swapusage` are point/system-wide measurements, not per-request Metal allocation or per-process swap attribution; short-lived peaks between observations may be missed.

## Phase status

| phase | status | reason |
| :--- | :--- | :--- |
| warmup | complete | — |
| anchor-pre | complete | — |
| probes | complete | — |
| matrix | stopped | inflight_request_exceeded_110s_watchdog |
| soak | not_run | matrix_not_complete_without_hard_stop:inflight_request_exceeded_110s_watchdog |
| contention | not_run | soak_not_complete_without_hard_stop:matrix_not_complete_without_hard_stop:inflight_request_exceeded_110s_watchdog |
| recovery | not_run | contention_not_completed_after_matrix_safety_stop |

## Limitations and disposition

- This is one host, one protected voice profile, one selected MLX model revision, Auto Japanese fixtures, and MP3 endpoint responses.
- The workload is a controlled synthetic benchmark and not real WhatsApp user traffic or a production SLA sample.
- The unchanged MLX HTTP service does not expose separate Metal-driver allocation counters; physical footprint/RSS are point-sampled process/host proxies, not direct Metal allocation traces.
- Model/decode work is exposed as generate_or_model_ms; the current MLX API does not provide a separate decode-stage boundary.
- The experimental 110-second watchdog is below the unchanged 120-second OpenClaw timeout.
- The report does not select a MAX_TEXT value, preferred spoken length, production warning threshold, segmentation policy, or lifecycle policy.
- Host swap is system-wide and cannot be attributed byte-for-byte to the TTS process; v2 treats it as telemetry unless corroborated by active memory/footprint distress.
- This is one host/configuration and synthetic Japanese text, not real WhatsApp traffic or an SLA sample.
- Contention success/rejection latency is client-observed; the unchanged service has no per-request identifier, so log correlation is burst-level.
- No final production hard limit, segmentation rule, warning threshold, or lifecycle policy is selected. Results are for owner review only.
