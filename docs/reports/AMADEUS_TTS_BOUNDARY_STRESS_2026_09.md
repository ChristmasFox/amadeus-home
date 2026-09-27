# Amadeus TTS — Production Boundary & Stress Characterization

Generated: 2026-09-26T21:57:51.102495+00:00<br>
Control: `prod-1.6.2-a-mlx-auto-interactive`<br>
Result type: controlled measurement only; production TTS configuration and policy were not changed.
Overall Goal status: **incomplete-safety-stopped**. No complete Phase C length matrix exists in this attempt.

## Control group

- Canonical source: `858eaea783d51a2183732697bce059d8c03c8137` / Amadeus `1.6.2`.
- Service source SHA-256: `de6780fc0b96a6dea1be790a64b9f9c72bc299f433f968ef5bfb5ade16ce393a`.
- Engine config SHA-256: `91e9b7383047ad59e11cc0c919604f45f0c05fa1ee729ed2cafe36ce26a9f2aa`; MLX model/dependency revisions are recorded below.
- Engine/profile/language: `mlx` / `kurisu-v1` / `Auto`; active `libmlx` mapping verified, protected A reference verified unchanged against the private baseline.
- Scheduling/format: loaded launchd spawn type `interactive` (`Interactive`) / `mp3`; workers=1, pending=1, admission wait=5s.
- LaunchAgent disk plist valid at this control capture: `True`. Same-value recovery checkpoint: `boundary-plist-repair-2026-09-26`; no engine/model/profile/timeout/worker/output-limit parameter changed.
- OpenClaw live TTS timeout=120000ms; service ceiling=`MAX_TEXT=1200` codepoints.
- Host: Mac18,5, 24 GB, macOS 27.0; baseline LaunchAgent PID=50062, state=running, `/healthz`=ready.
- Baseline swap used: 6.63 GiB; system memory free: 72%.
- 9Router→host TTS health route: `ready`. The protected profile is reported only as verified unchanged; reference bytes/text and hashes are not published.

## Fixture and statistical contract

- Public synthetic fixture manifest SHA-256: `2342110427127531e30f18b7c8d350d367d5b2364b7329a6d8117155729a505c`; schedule seed `20260927`, SHA-256 `ccf30683b6b1cf0d6c7ce69ec9876466d1c09393857c220bafa4ffeed0141a3f`.
- Input length is Python Unicode codepoints (`len(text)`). Each target has fixed fixture A and B; both were validated at their exact declared length.
- Matrix design: five cycles × two fixture families × two repetitions per cycle = 20 measured requests per complete length; 2.0s quiet interval; three 50-character A warmups excluded.
- Quantiles: Hyndman-Fan type 7 (linear interpolation; h=(n-1)p). p95 is descriptive for n=20, not an SLA or a high-confidence production tail estimate.
- Runtime-log correlation records numeric timings only. Any uncontrolled concurrent TTS log event stops or invalidates the affected phase; request text is never logged.

## Preserved preflight attempt history

Earlier preflight attempts are preserved separately and are excluded from every quantile:
- `boundary-stress-2026-09-rebaseline-1` stopped during an excluded 50-character A warmup: `swap_growth_persisted_512_mib_after_30s_idle_confirmation`; successful warmups=1; anchor/matrix samples=0; first sample swap delta=0.78 GiB.
  Later idle observation: swap delta from that run's control=-0.11 GiB, memory free=73%, health=ready, PID=50062.
- Between attempts, an explicitly authorized same-value LaunchAgent plist repair was applied and verified from checkpoint `boundary-plist-repair-2026-09-26`; PID 26512→50062, same MLX/Interactive settings, no TTS parameter change.
- The primary measurement run is a fresh protected attempt with the same fixture/schedule hashes (`2342110427127531e30f18b7c8d350d367d5b2364b7329a6d8117155729a505c`, `ccf30683b6b1cf0d6c7ce69ec9876466d1c09393857c220bafa4ffeed0141a3f`) and its own captured control; predecessor warmups are not merged.

## Additional protected attempts (excluded from primary statistics)

These separately captured runs use the same fixture, schedule, and verified production configuration. They are preserved as attempt history only; no warmup or partial row is pooled into matrix percentiles.

| run | stop phase/reason | excluded warmups (endpoint ms) | min memory free | max observed swap growth from control | min free swap | idle confirmation cap | anchor/matrix rows |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: | :--- |
| `boundary-stress-2026-09-rebaseline-3` | warmup: `swap_growth_over_512_mib_persisted_without_clear_decline_after_120s_idle_confirmation` | 2/2 (6752.7, 6132.4; excluded) | 66% | 1.30 GiB | 1.16 GiB | 4 × 30s | anchor 0; matrix 0/0 |
| `boundary-stress-2026-09-rebaseline-4` | warmup: `swap_growth_over_512_mib_persisted_without_clear_decline_after_120s_idle_confirmation` | 1/1 (6782.9; excluded) | 67% | 1.05 GiB | 1.21 GiB | 4 × 30s | anchor 0; matrix 0/0 |
| `boundary-stress-2026-09-rebaseline-5` | anchor-pre: `system_free_swap_below_256_mib_safety_guard` | 3/3 (7050.0, 6167.1, 6409.0; excluded) | 69% | 1.71 GiB | 0.37 GiB | 12 × 30s | anchor 1; matrix 0/0 |
| `boundary-stress-2026-09-rebaseline-6` | anchor-pre: `system_free_swap_below_512_mib_safety_guard` | 3/3 (6136.1, 6428.1, 5905.1; excluded) | 68% | 1.19 GiB | 0.42 GiB | 12 × 30s | anchor 2; matrix 0/0 |
- Stop-marker label mismatch for `boundary-stress-2026-09-rebaseline-5`: recorded reason says 256 MiB, but its manifest configured 512 MiB and the lowest persisted free-swap observation was 0.37 GiB. The original marker is preserved; the runtime reason label is corrected for future runs.

## Safety stop and production recovery

- Phase B stopped at 800 codepoints after the 110-second experimental watchdog; no larger safety probes were sent.
- The 800-character fixture-A probe recorded 110002.5 ms from the client and `watchdog_timeout`. A later service `RuntimeError` log was observed; because the unchanged service has no request ID, attribution is time-correlated rather than exact.
- Phase C then sampled only the preflight-passed set. It was stopped during the scheduled 200-character A/B batch after a live snapshot showed 10% system memory free and 563.4 MiB swap free. The harness was interrupted before issuing any more requests.
- Matrix rows persisted: 1; a second B-200 MP3 response existed but its client latency row was not committed. Both 200-character point observations are excluded from percentiles and representative selection.
- The process-lifetime vmmap footprint peak after the stop was 19.10 GiB; this is a high-water mark, not an 800-character attribution.
- Post-stop service state: `/healthz` `ready`, PID 50062, LaunchAgent runs 1, memory free 72%, swap free 0.79 GiB, physical footprint 3.40 GiB, process peak 19.10 GiB. No service restart and no additional TTS request followed the stop.

### Partial matrix points (not percentiles)

| length | fixture | client total ms | model ms | audio ms | RTF | eligibility |
| ---: | :--- | ---: | ---: | ---: | ---: | :--- |
| 200 | A | 15024.1 | 14703.5 | 24960.0 | 0.589 | excluded; not representative |
| 200 | B | — | 15812.5 | 32320.0 | 0.489 | excluded; not representative |

The B-200 audio bytes remain in the protected external run directory only to preserve stop evidence; they are not published or indexed as a listening sample.

## Single safety-probe observations (excluded from quantiles)

These are one-time ascending preflight points, not matrix samples, not p50/p95/max, and not representative listening artifacts.

| chars | probe status | attempt | HTTP | client ms | model ms | audio ms | RTF | result/reason |
| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| 25 | passed | 1 | 200 | 4889.6 | 4846.6 | 4560.0 | 1.063 | success |
| 50 | passed | 1 | 200 | 5899.7 | 5848.9 | 8627.0 | 0.678 | success |
| 100 | passed | 1 | 200 | 8212.5 | 8154.0 | 14400.0 | 0.566 | success |
| 150 | passed | 1 | 200 | 11227.4 | 11154.7 | 23120.0 | 0.483 | success |
| 200 | passed | 1 | 200 | 13401.2 | 13309.7 | 28400.0 | 0.469 | success |
| 250 | passed | 1 | 200 | 15259.9 | 15167.1 | 32720.0 | 0.464 | success |
| 320 | passed | 1 | 200 | 20757.3 | 20651.3 | 47399.0 | 0.436 | success |
| 400 | passed | 1 | 200 | 27136.8 | 27000.0 | 58960.0 | 0.458 | success |
| 500 | passed | 1 | 200 | 29667.6 | 29532.1 | 70991.0 | 0.416 | success |
| 600 | passed | 1 | 200 | 33955.7 | 33790.0 | 81680.0 | 0.414 | success |
| 800 | safety-incomplete | 1 | — | 110002.5 | — | — | — | watchdog_timeout |
| 1000 | not_probed_after_stop | — | — | — | — | — | — | progressive safety probes stopped at 800 codepoints |
| 1200 | not_probed_after_stop | — | — | — | — | — | — | progressive safety probes stopped at 800 codepoints |

## Production length matrix

Times are milliseconds; audio duration is milliseconds; RTF is unitless. Incomplete buckets have no reported percentile.

| chars | status | success/attempts (failure rate) | endpoint p50 / p95 / max | model p50 / p95 / max | audio p50 / p95 / max | RTF p50 / p95 / max |
| ---: | :--- | ---: | ---: | ---: | ---: | ---: |
| 25 | matrix-not-run-after-safety-stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 50 | matrix-not-run-after-safety-stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 100 | matrix-not-run-after-safety-stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 150 | matrix-not-run-after-safety-stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 200 | safety-incomplete | 1/1 (0.0%) | not reported | not reported | not reported | not reported |
| 250 | matrix-not-run-after-safety-stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 320 | matrix-not-run-after-safety-stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 400 | matrix-not-run-after-safety-stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 500 | matrix-not-run-after-safety-stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 600 | matrix-not-run-after-safety-stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 800 | safety-incomplete | 0/0 (—) | not reported | not reported | not reported | not reported |
| 1000 | not_probed_after_stop | 0/0 (—) | not reported | not reported | not reported | not reported |
| 1200 | not_probed_after_stop | 0/0 (—) | not reported | not reported | not reported | not reported |

For complete rows, each triplet uses n=20 successful samples and type-7 quantiles. Failure rates are reported separately; failed requests are not mixed into successful percentiles.

### A/B fixture family results

Endpoint/model medians and descriptive p95 are shown by family for every complete bucket.

| chars | A endpoint p50/p95 ms | B endpoint p50/p95 ms | A model p50/p95 ms | B model p50/p95 ms |
| ---: | ---: | ---: | ---: | ---: |

## Safety probes and representative listening artifacts

Safety probes are excluded from quantiles. No percentile is fabricated for a failed or safety-incomplete bucket.

| chars | safety-probe status | attempts / reason | listening artifact | selected A run |
| ---: | :--- | :--- | :--- | ---: |
| 25 | passed | 1 / Phase C stopped at the 200-codepoint matrix batch | — | — |
| 50 | passed | 1 / Phase C stopped at the 200-codepoint matrix batch | — | — |
| 100 | passed | 1 / Phase C stopped at the 200-codepoint matrix batch | — | — |
| 150 | passed | 1 / Phase C stopped at the 200-codepoint matrix batch | — | — |
| 200 | passed | 1 / matrix phase stopped after memory-free fell to 10% during swap confirmation | — | — |
| 250 | passed | 1 / Phase C stopped at the 200-codepoint matrix batch | — | — |
| 320 | passed | 1 / Phase C stopped at the 200-codepoint matrix batch | — | — |
| 400 | passed | 1 / Phase C stopped at the 200-codepoint matrix batch | — | — |
| 500 | passed | 1 / Phase C stopped at the 200-codepoint matrix batch | — | — |
| 600 | passed | 1 / Phase C stopped at the 200-codepoint matrix batch | — | — |
| 800 | safety-incomplete | 1 / probe_measurement_or_connection_integrity_failed | — | — |
| 1000 | not_probed_after_stop | 0 / progressive safety probes stopped at 800 codepoints | — | — |
| 1200 | not_probed_after_stop | 0 / progressive safety probes stopped at 800 codepoints | — | — |

No Phase C bucket completed in this safety-stopped run; no representative MP3/text pair was produced. The protected index explicitly lists the incomplete lengths.

## Sustained sequential soak

Status: not_run; reason: not available.

## Bounded-queue contention

Status: not_run; reason: not available.

## Pre/post stress 50-character control

Both anchors use the same fixture-A bytes, separate from the matrix. Warmups are excluded.

| control | success/attempts | p50 ms | p95 ms | max ms | before footprint | after footprint | swap before→after | memory free before→after | PID before→after |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| pre | 20/20 | 5795.1 | 5950.1 | 5950.4 | 3.30 GiB | 3.30 GiB | 7.07 GiB → 7.12 GiB | 74% → 73% | 50062 → 50062 |
| post | 0/0 | — | — | — | — | — | — → — | —% → —% | — → — |

Post-stress minus pre-stress median: not comparable; one or both anchors incomplete. This is descriptive drift evidence, not an automatic restart/eviction trigger.

## Memory and accounting caveats

- Baseline point sample: RSS 0.04 GiB; physical footprint 3.30 GiB; process-lifetime peak 17.30 GiB.
- Matrix observed max point-sampled physical footprint 3.80 GiB, max RSS 0.13 GiB, lowest system memory free 70%, swap min/max 7.03 GiB/7.66 GiB.
- Preflight/anchor-only sampled max physical footprint 13.40 GiB, max RSS 0.19 GiB, minimum memory-free 67%, swap min/max 6.75 GiB/7.98 GiB.
- Highest observed process-lifetime vmmap physical-footprint peak across control/preflight/stop observations: 19.10 GiB.
- Physical footprint and RSS were sampled around each HTTP request; a short-lived peak may be missed. The reported `vmmap` peak is cumulative since process start and cannot be attributed to an individual request.
- Swap-used is system-wide and encrypted; a high starting value can reflect workload before this study. Safety guards were memory-free below 10%, current footprint at/above 20 GiB, swap growth at/above 2 GiB immediately, free swap below 512 MiB, or growth at/above 512 MiB without a clear decline across up to 4 30-second idle confirmations. A brief spike that retreats is recorded but not labeled runaway. These are experiment stop guards, not production policy.

## Known limitations

- This is one host, one protected voice profile, one selected MLX model revision, Auto Japanese fixtures, and MP3 endpoint responses.
- The workload is a controlled synthetic benchmark and not real WhatsApp user traffic or a production SLA sample.
- The unchanged MLX HTTP service does not expose separate Metal-driver allocation counters; physical footprint/RSS are point-sampled process/host proxies, not direct Metal allocation traces.
- Model/decode work is exposed as generate_or_model_ms; the current MLX API does not provide a separate decode-stage boundary.
- The experimental 110-second watchdog is below the unchanged 120-second OpenClaw timeout.
- The report does not select a MAX_TEXT value, preferred spoken length, warning threshold, segmentation policy, or lifecycle policy.
- No physical LAN peer was used for the direct loopback benchmark; the 9Router container-to-host `/healthz` route was verified before measurement and between major phases.
- Contention success timings are client-observed per request; timing-log correlation is validated by event counts per burst because the unchanged production service has no per-request identifier.

## Neutral decision inputs (measured facts only)

- **Routine 150-character comparison point:** not complete; see safety status above. The separate 50-character pre/post control is listed above.
- **Extended comparison point:** 320 was not complete; stress substitution, if any, is identified in the soak table.
- **Highest descriptive dispersion:** no complete bucket available.
- **Safety-incomplete/not-probed region:** 200 chars: safety-incomplete (matrix phase stopped after memory-free fell to 10% during swap confirmation; 1/1 matrix successes), 800 chars: safety-incomplete (probe_measurement_or_connection_integrity_failed; 0/0 matrix successes), 1000 chars: not_probed_after_stop (progressive safety probes stopped at 800 codepoints; 0/0 matrix successes), 1200 chars: not_probed_after_stop (progressive safety probes stopped at 800 codepoints; 0/0 matrix successes).
- **Probe-passed but matrix not run:** none. These single preflight points do not define a stable operating region.
- These categories summarize the observed matrix only. **No final hard limit or production output-length policy is selected here.** Owner review of the tables and representative listening samples is the next decision point.
