# Amadeus TTS — Production Boundary & Stress Characterization Goal

Date: 2026-09-27

## Status

- Type: measurement / characterization only
- Canonical baseline: released `main`, Amadeus `1.6.2`
- Production control ID: `prod-1.6.2-a-mlx-auto-interactive`
- Agent runtime: OpenClaw only
- TTS backend: selected community MLX 1.7B Base 8-bit
- Voice profile: existing protected A / ~46s `kurisu-v1`
- Language: `Auto`
- launchd scheduling: `ProcessType=Interactive`
- Response format: MP3 for endpoint latency measurements
- Worker policy: one inference worker + one bounded pending slot
- Pending-start timeout: existing 5s
- External TTS timeout: unchanged 120s
- Current service input ceiling: unchanged `MAX_TEXT=1200`
- Production configuration changes in this Goal: **forbidden**
- Version bump / release: **forbidden**
- Final production boundary decision: **deferred until the owner reviews the completed results**

This Goal exists to measure the real production envelope before choosing any new output-length or pressure policy. It must not change the accepted voice, backend, scheduler, worker, timeout, format, hard limit, model lifecycle, or automatic fallback behavior.

---

## 1. Questions this Goal must answer

At completion, provide measured evidence for:

1. How does production TTS latency scale with requested Japanese text length?
2. For each tested length, what are `p50`, `p95`, and `max` endpoint latency under the exact current production configuration?
3. For each tested length, what are `p50`, `p95`, and `max` model-generation time, output audio duration, and RTF?
4. At what length does latency variance, failure rate, or host memory pressure become materially worse?
5. Does sustained sequential synthesis cause progressive latency degradation, Metal/physical-footprint growth, or swap growth?
6. Under contention, does the existing one-worker/bounded-pending design continue to fail fast instead of creating an unbounded wait?
7. After long/stress workloads, does the same short control fixture return to approximately its pre-test latency distribution?
8. For every tested length, what does one representative real production synthesis sound like when paired with the exact text that produced it?

This Goal does **not** decide the future `MAX_TEXT`, preferred spoken length, warning threshold, segmentation policy, or restart/eviction policy. The owner will decide those after reviewing the completed tables and representative listening artifacts.

---

## 2. Control-group rule

The exact current production service is the control group. Before any benchmark data is collected, verify and record a sanitized control manifest containing at least:

- Git commit SHA and `VERSION`;
- service source SHA;
- `infra/macos/qwen3-tts-engine.json` source/model/dependency revisions;
- engine=`mlx`;
- profile=`kurisu-v1` / protected A reference verified unchanged locally;
- language=`Auto`;
- `ProcessType=Interactive`;
- MP3 response format;
- worker count / pending-slot count / 5s admission wait;
- `MAX_TEXT=1200`;
- external timeout=120s;
- Mac model / unified-memory size / macOS version;
- LaunchAgent PID/start state and `/healthz=ready`;
- current ambient swap and memory-pressure snapshot.

Private reference hashes, token values, transcripts, real user content, and audio bytes must remain outside Git. It is sufficient for the public report to say the protected production profile was verified unchanged.

### Comparison invariant

Any future candidate configuration that is compared with this control must reuse:

1. the exact same fixture manifest;
2. the exact same fixture text bytes;
3. the exact same sample counts;
4. the exact same benchmark schedule/order/seed;
5. the same warmup/exclusion rules;
6. the same endpoint and response format;
7. the same statistical implementation;
8. the same representative-listening-artifact selection rule.

Do not compare a future candidate against a different prompt corpus or different run count and call it an A/B result.

---

## 3. Unit of input length

Use **Python Unicode codepoints**, exactly matching the production `len(text)` semantics used by the service.

Do not use linguistic Japanese word segmentation for the primary boundary axis. Japanese “word count” is tokenizer-dependent and would not match the production request limit.

Report the user-facing tables as `characters/codepoints`.

Whitespace/newlines should be avoided in primary fixtures unless intentionally part of the fixture. Punctuation counts because production `len(text)` counts it.

---

## 4. Immutable fixture corpus

Before running the benchmark, add a source-controlled public synthetic Japanese fixture manifest dedicated to this Goal. Do not use private WhatsApp text or historical user messages.

Required target lengths:

```text
25
50
100
150
200
250
320
400
500
600
800
1000
1200
```

For every target length, create **two fixed natural Japanese fixtures**:

- `A`: ordinary conversational/explanatory Japanese;
- `B`: information-dense Japanese with normal punctuation and sentence boundaries.

Requirements:

- both A and B must have exactly the target Python `len(text)` codepoint count;
- do not achieve length primarily by meaningless repeated kana or punctuation;
- no personally identifying/private text;
- no safety-sensitive or emotionally extreme content that may alter synthesis style unusually;
- fixture text is frozen before the first measured run;
- a test must validate every declared length;
- record a SHA-256 of the complete fixture manifest in the run metadata.

Once measured data collection begins, changing a fixture invalidates the corresponding dataset and requires a complete rerun of all affected groups.

---

## 5. Statistical sample design

For every length bucket:

- 2 immutable fixtures (`A`, `B`);
- 10 warmed successful measured syntheses per fixture;
- **20 successful measured samples per length** in the primary latency table.

A small number of explicit preflight/warmup requests are allowed but must be marked `excluded_from_quantiles=true` and never enter `p50/p95/max`.

### Quantiles

Use one deterministic quantile implementation for all groups. The report must state the method. Do not change percentile methods between groups.

With 20 samples, `p95` is descriptive rather than a high-confidence production tail estimate. Preserve the raw numeric evidence outside Git and state `n=20` next to every p50/p95 row.

### Required metrics per successful sample

Record at minimum:

- length bucket;
- fixture id A/B;
- run index;
- success/failure;
- HTTP status/error category;
- endpoint `total_ms`;
- production log-correlated `queue_wait_ms` when available;
- `generate_or_model_ms`;
- `wav_serialize_ms`;
- `encode_ms`;
- `audio_duration_ms`;
- `rtf`;
- process RSS snapshot;
- host physical footprint where practical;
- host swap-used snapshot;
- `memory_pressure -Q` snapshot or normalized free percentage;
- service PID/restart count.

Do not log request text in the runtime log. The public fixtures already live in Git; benchmark result rows should refer to fixture ids/hashes rather than duplicate text.

---

## 6. Execution schedule and thermal/cache fairness

Do not run all 20 samples for one length and then move permanently upward. That would confound input length with thermal/cache/time drift.

Create a deterministic schedule file/seed before the benchmark. Preferred structure:

```text
5 cycles
  × fixture A and B
  × 2 repetitions per fixture per cycle
  × all length buckets in deterministic shuffled/rotated order
= 20 measured samples per length
```

The exact order may differ if the harness is cleaner, but it must:

- distribute short and long buckets across the entire run;
- avoid making all longest requests occur only at the end;
- use a fixed reproducible seed;
- be stored in the private run manifest and summarized by hash in the report;
- remain identical for any later candidate comparison.

For the **latency characterization matrix**, insert a short fixed quiet interval between requests so the matrix measures ordinary warmed request latency rather than deliberate queue pressure. Queue pressure is tested separately in the stress phase.

Do not run other intentional ML/GPU benchmarks at the same time. Keep normal HomeLab production services running so the control remains representative of the actual production host.

---

## 7. Phase A — preflight and control anchors

Before the full matrix:

1. verify Git clean and `main` canonical;
2. verify `VERSION=1.6.2`;
3. verify LaunchAgent engine/profile/scheduler match the control manifest;
4. verify `/healthz=ready`;
5. verify 9Router host route remains healthy;
6. record PID, uptime/restart state, swap and memory pressure;
7. run 3 excluded warmup requests with the 50-character A fixture;
8. run a **20-sample 50-character A control anchor** and compute pre-test p50/p95/max.

The dedicated control-anchor samples are separate from the main matrix and exist to detect drift before versus after stress.

Do not restart the model merely to manufacture a cold baseline. The primary question is warmed production behavior.

---

## 8. Phase B — progressive safety preflight by length

Before spending 20 measured samples on a bucket, run one excluded safety probe for each target length in ascending order.

A safety probe is not included in quantiles.

Stop the current bucket and do not automatically continue to larger buckets if any of these occur:

- request exceeds the existing 110-second experimental safety watchdog;
- service becomes unhealthy or LaunchAgent restarts;
- synthesis fails twice while validating the same bucket;
- the host reaches obvious critical memory pressure or becomes operationally unstable;
- protected profile/model integrity check fails.

If a bucket is stopped for safety, the report must show:

```text
status = safety-incomplete
p50/p95/max = not reported
reason = <measured stop reason>
```

Never fabricate a percentile from an incomplete/safety-aborted bucket. A safety stop is itself a valid boundary result.

---

## 9. Phase C — full production length matrix

Run the immutable schedule against the actual production HTTP endpoint:

```text
http://127.0.0.1:18792/v1/audio/speech
```

using the protected Bearer token and `response_format=mp3`.

Do not benchmark only the in-process MLX engine for the primary table. The control must include the real production HTTP service, worker/admission path, WAV serialization, and MP3 encoding.

The existing `endpoint_benchmark.py` may be extended or a new dedicated harness may be added. Any harness change must remain test-only/tooling-only and must not alter `service.py` behavior during control collection.

### Required final per-length latency table

For every complete bucket, produce at minimum:

| chars | n | success | total p50 | total p95 | total max | model p50 | model p95 | model max | audio p50 | audio p95 | audio max | RTF p50 | RTF p95 | RTF max |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

This is the core owner-facing result.

Also provide A/B fixture sub-results if the two fixture families differ materially, so content sensitivity is not hidden by aggregation.

### Representative listening artifact per length

For every **complete** length bucket, preserve exactly one representative production audio sample paired with the exact fixture text that produced it.

The artifact must come from the actual measured Phase C production HTTP requests. **Do not re-synthesize after the benchmark and do not hand-pick the nicest sounding run.**

Use this deterministic selection rule:

1. consider only the 10 successful warmed measured samples for `fixture A` at that length;
2. compute the fixture-A `total_ms` p50 with the same quantile implementation used elsewhere;
3. choose the successful sample whose `total_ms` has the smallest absolute distance from that fixture-A p50;
4. break an exact tie by the lower `run_index`;
5. preserve the exact MP3 bytes returned by that measured request.

This intentionally produces a representative, non-cherry-picked listening sample while keeping the content family consistent across every length.

The harness may temporarily retain measured audio outside Git until selection is complete. After selection, keep only the required representative artifacts unless other raw audio is explicitly required for debugging. Do not alter the measured request path merely to capture audio.

Store the retained artifacts under the protected external benchmark root using a stable logical layout such as:

```text
listening/
  25/
    sample.mp3
    sample.txt
    sample.json
  50/
    sample.mp3
    sample.txt
    sample.json
  ...
  1200/
    sample.mp3
    sample.txt
    sample.json
```

Requirements:

- external listening root/directory mode `0700`;
- retained files mode `0600`;
- `sample.mp3` = exact response bytes from the selected measured production request;
- `sample.txt` = exact immutable fixture-A text used for that request;
- `sample.json` = content-safe metadata including control id, length, fixture id, run index, total/model/audio/RTF metrics, and SHA-256 of the text and MP3;
- never include Bearer tokens, protected reference audio/text, user content, or private identifiers;
- do not commit the generated voice MP3 files to Git.

The aggregate report must include a listening-artifact index mapping each complete length to its logical external artifact path and selected run metadata, without embedding audio bytes.

If a bucket is `safety-incomplete`, it has no representative p50 sample. If its excluded safety probe successfully produced audio and retaining that artifact is useful, it may be kept separately and must be labeled `safety-probe`, **never** `representative` and never presented as a p50-derived sample.

For any future candidate A/B comparison, generate the listening counterpart from the same fixture-A text at each length using the same representative-selection rule. This preserves a same-text listening comparison across control and candidate configurations.

---

## 10. Phase D — sustained sequential-load characterization

After the ordinary latency matrix, test sustained production-style sequential work without changing engine settings.

Use three representative lengths selected **before execution** from the fixed matrix:

```text
50   = short control
150  = routine spoken-reply region
320  = extended candidate region
```

If the progressive boundary matrix shows 320 is already unsafe, replace the third soak length with the largest complete lower bucket and record why.

For each soak length:

- 30 sequential requests;
- no artificial model restart between requests;
- use the same fixture corpus, rotating A/B deterministically;
- record every latency/internal/memory metric;
- sample swap and memory pressure before, periodically during, and after the batch.

Report at minimum:

- p50/p95/max total latency;
- first 10 vs last 10 p50 comparison;
- max physical footprint;
- max RSS;
- swap delta from batch start to batch end;
- lowest observed memory-free percentage / worst pressure observation;
- service restart/failure count.

Do not declare a memory leak from one high watermark. Look for progressive growth and failure to stabilize across repeated requests.

---

## 11. Phase E — bounded-queue contention

Verify the existing production admission behavior rather than changing it.

Run controlled concurrent bursts at:

```text
50 chars
150 chars
320 chars (or largest safe lower bucket)
```

For each length:

- 10 independent bursts;
- 3 requests launched as simultaneously as practical;
- preserve current one-worker / one-pending-slot / 5s admission policy;
- do not increase timeout;
- allow and expect `503 tts_busy` when bounded admission cannot start within the production window.

For each burst record:

- number of 200 responses;
- number of `503 tts_busy` responses;
- any unexpected `synthesis_failed` / timeout / connection error;
- successful request latency;
- rejected request latency;
- service health after the burst.

Acceptance is not “all concurrent requests succeed.” The desired property is **bounded behavior**: no unbounded queue growth, no 120-second pile-up, no duplicate synthesis, no worker deadlock, and subsequent requests recover normally.

---

## 12. Phase F — post-stress recovery control

After all matrix/soak/contention work:

1. wait until no benchmark request is in flight;
2. verify service still has the expected PID/restart state or explicitly record any restart;
3. verify `/healthz=ready`;
4. record memory pressure/swap/footprint;
5. run the same dedicated **20-sample 50-character A control anchor** used in Phase A.

Compare pre-test versus post-stress control:

| control | n | p50 | p95 | max | footprint | swap | memory pressure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pre | 20 | ... | ... | ... | ... | ... | ... |
| post | 20 | ... | ... | ... | ... | ... | ... |

Flag material latency or memory drift for owner review. Do not automatically introduce restart-on-idle, eviction, cache clearing, or fallback as a response inside this Goal.

---

## 13. Raw evidence and report outputs

Raw benchmark evidence and retained listening artifacts must remain outside Git in a protected 0700/0600 directory. It may include numeric JSONL/CSV, host snapshots, sanitized logs, schedule, private run manifests, and the per-length representative MP3/text/metadata pairs. Do not store tokens, actual protected A reference bytes/text, real user messages, or generated production voice audio in Git.

Commit only:

1. public synthetic fixture manifest + fixture-length validation tests;
2. benchmark harness / analysis tooling;
3. content-free aggregate report;
4. content-free aggregate numeric JSON suitable for machine verification.

Required report paths:

```text
docs/reports/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.md
docs/reports/data/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.json
```

The report must include:

- exact control configuration;
- fixture manifest hash and schedule seed/hash;
- quantile method;
- per-length p50/p95/max table;
- per-length model/audio/RTF table;
- failed/safety-incomplete buckets without fabricated percentiles;
- representative-listening-artifact index for every complete length;
- sequential soak results;
- queue-contention results;
- pre/post stress control comparison;
- memory/swap observations with accounting caveats;
- all known limitations;
- **no recommendation for final hard limit**.

End the report with a neutral decision-input section listing candidate boundary regions supported by data, for example:

```text
Routine low-latency region: measured facts only
Extended but stable region: measured facts only
High-variance / pressure region: measured facts only
Safety-incomplete region: measured facts only
```

Do not select the production policy. The owner and ChatGPT will discuss the policy after measurement and listening review are complete.

---

## 14. Statistical correctness rules

- Never mix warmup/preflight samples into measured quantiles.
- Never mix failed/timeout samples into a successful-latency percentile without explicitly defining a censored-failure metric separately.
- Always publish `n` beside p50/p95/max.
- Use the exact same percentile implementation across all groups.
- Do not call 20 samples a production SLA or a true long-tail p95 estimate; call it a controlled descriptive p95.
- Do not compare old historical MPS or QoS numbers against the new length matrix as if they were same-sample A/B measurements.
- Historical 1.6.0/1.6.2 data may be shown only as contextual background.
- Future candidate comparisons must rerun this exact corpus/schedule against the candidate and the control if host/runtime drift could materially affect results.

---

## 15. Safety / stop conditions

Immediately stop active stress execution and preserve evidence if any of the following occurs:

- LaunchAgent crashes or repeatedly restarts;
- `/healthz` does not recover normally;
- model returns repeated synthesis failures;
- an in-flight request breaches the 110s experimental watchdog;
- Mac becomes visibly unstable or reaches critical memory pressure;
- swap/footprint growth is clearly runaway rather than stabilizing;
- OrbStack/9Router loses host-TTS connectivity;
- real WhatsApp voice traffic is accidentally mixed into the benchmark in a way that invalidates controlled samples;
- any secret/private voice/user content would be written to Git.

Do not hide a safety stop by restarting the service and continuing the same dataset. Mark the affected phase incomplete, recover the production service, and report exactly where the stop occurred.

---

## 16. Implementation discipline for Codex

1. Start from clean canonical `main` at released 1.6.2.
2. Create a short-lived benchmark branch.
3. Build fixture/harness/tests first; no live TTS behavior changes.
4. Freeze fixture manifest and schedule before measurement.
5. Capture control manifest before the first measured request.
6. Keep raw results and retained listening artifacts outside Git.
7. Run safety probes before expensive long buckets.
8. Run the full matrix only against unchanged production configuration.
9. Select and preserve one deterministic representative measured fixture-A MP3/text/metadata artifact per complete length.
10. Run sequential soak and bounded contention only after ordinary latency characterization.
11. Re-run the exact short control after stress.
12. Generate aggregate report/JSON from raw evidence programmatically.
13. Verify report numbers and listening-artifact selections are reproducible from the protected raw data.
14. Run focused tests, `git diff --check`, architecture/secrets checks as appropriate.
15. Merge/push tooling/report only after the dataset is internally consistent.
16. Do not bump `VERSION`, do not release/deploy a new runtime, and do not change `MAX_TEXT` under this Goal.

---

## 17. Definition of done

This Goal is complete only when:

- the production control manifest is verified;
- immutable exact-length fixtures exist for all declared buckets;
- every complete bucket has 20 successful measured samples and p50/p95/max;
- every complete bucket has exactly one deterministic representative measured production MP3 plus its exact paired fixture text and metadata retained outside Git;
- every safety-aborted bucket is explicitly marked incomplete with no fabricated percentile;
- sequential-soak results exist;
- queue-contention results exist;
- pre/post stress control comparison exists;
- memory/swap/pressure observations are documented honestly;
- aggregate report and machine-readable JSON are generated;
- listening-artifact index exists for owner review;
- no production TTS parameter was changed;
- the owner can inspect one concise table and compare every tested character length directly, then listen to one representative production sample for each complete length.

After completion, stop. Do not implement a new output-length policy until the owner reviews the data and listening artifacts and explicitly chooses the next production strategy.