# Amadeus TTS — Production Boundary Rebaseline v2 Goal

Date: 2026-09-27

## Status

- Type: measurement / characterization continuation only
- Canonical production baseline: released Amadeus `1.6.2`
- Production control ID: `prod-1.6.2-a-mlx-auto-interactive`
- Production TTS parameters: immutable
- Previous measurement branch/evidence: `codex/tts-boundary-stress-2026-09` at `a6a704d5e633bd38fff8526161eb3f4c09628640`
- Previous Goal: `docs/AMADEUS_TTS_PRODUCTION_BOUNDARY_STRESS_GOAL.md`
- This Goal supersedes only the benchmark safety policy and executable range for the next fresh run; it does not erase or reinterpret prior evidence.
- Version bump / production deployment / policy change: forbidden

## 1. Mission

Complete a fresh, controlled production TTS boundary dataset for **25–600 Unicode codepoints** using the unchanged 1.6.2 production service, while correcting the benchmark's overly conservative use of host-wide macOS swap as a standalone stop signal.

The previous run established useful evidence but could not finish the matrix because host-wide swap guards repeatedly stopped otherwise healthy short requests, while a separate 800-codepoint probe independently exceeded the 110-second watchdog and therefore remains a genuine long-input safety signal.

This Goal must:

1. preserve all previous safety-stopped attempts and reports as immutable historical evidence;
2. reuse the exact frozen fixture corpus for the overlapping 25–600 buckets;
3. keep production TTS completely unchanged;
4. change only benchmark/test tooling and safety classification;
5. complete n=20 warmed samples per safe bucket from 25 through 600;
6. retain one representative real production MP3 + text + metadata for every completed bucket;
7. run bounded sequential and contention characterization only after the ordinary matrix succeeds;
8. publish p50 / p95 / max and memory observations without choosing a new production hard limit.

Stop after measurement and reporting. Do not implement a new output-length policy.

---

## 2. Immutable production control

The live control remains exactly:

```text
voice/profile     = protected A / ~46s kurisu-v1
backend           = community MLX Qwen3-TTS 1.7B Base 8-bit
language          = Auto
launchd           = ProcessType=Interactive
response format   = MP3
worker            = 1
pending slot      = 1
admission wait    = 5s
external timeout  = 120s
service MAX_TEXT  = 1200
```

Do not change model, model revision, voice reference, language, scheduling, queue policy, timeout, encoder, model lifecycle, automatic restart/fallback behavior, OpenClaw behavior, 9Router behavior, or `VERSION`.

No service restart may be performed merely to reduce swap or make the benchmark pass. A restart is allowed only for genuine production recovery after a health failure, in which case the active dataset is invalidated and must not be resumed.

---

## 3. Prior evidence that must remain intact

Before new work, read the previous branch/report and record the following as historical facts, not samples to pool into the new quantiles:

- 50-character pre-stress control previously completed at n=20 with approximately p50 5795 ms / p95 5950 ms / max 5950 ms.
- single ascending probes succeeded through 600 codepoints;
- the 800-codepoint fixture-A probe exceeded the 110-second experimental watchdog;
- 1000 and 1200 were not probed after that stop;
- multiple short warmup/control attempts were stopped because host-wide swap crossed benchmark-only thresholds even when `/healthz` remained ready, PID remained stable, and system memory free later recovered to roughly the 70% range;
- one matrix attempt did observe real memory pressure around 10% system memory free, so memory protection must remain active;
- host diagnostics showed system-wide swap cannot be attributed solely to TTS; OrbStack Helper and other workloads are material contributors, while the TTS process had a current footprint around 3.3 GiB and a process-lifetime peak around 19.1 GiB.

Do not delete, rewrite, combine, or "fix" old raw evidence. The new run must use a fresh protected run root and fresh control manifest.

---

## 4. Executable range for this Goal

Primary matrix buckets:

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
```

The existing frozen A/B fixture text for these buckets must be reused byte-for-byte from the previous Goal/tooling. Validate exact Python `len(text)` codepoint lengths and record the existing fixture manifest hash.

### 800 / 1000 / 1200

Do **not** include 800, 1000, or 1200 in the new ordinary matrix, soak, or contention test.

Preserve the previous 800-codepoint `>110s` watchdog result as `historical-safety-incomplete` in the new report. Mark 1000/1200 as `not-retested-after-800-watchdog`.

If the owner later wants to study ultra-long input, that requires a separate Goal focused on segmentation/chunking or long-text model behavior.

---

## 5. Revised macOS memory/swap safety policy

The previous benchmark treated host-wide swap too strongly. In v2, **swap is telemetry and a corroborating signal, not by itself proof of TTS failure**.

### 5.1 Warning / passive-confirmation signals

The following no longer stop the run by themselves:

- host free swap below 512 MiB;
- host swap used increasing by more than 512 MiB from the fresh run baseline;
- host swap remaining elevated for several minutes while health/PID/memory pressure are otherwise stable.

When these occur:

1. finish the current request if it is healthy;
2. pause new synthesis requests;
3. capture repeated read-only snapshots at 30-second intervals for up to 180 seconds;
4. record swap, `memory_pressure -Q`, TTS current physical footprint, TTS lifetime peak, PID/runs, and `/healthz`;
5. continue only if hard-stop conditions below are absent and the host is stable or recovering.

Do not wait indefinitely for swap to return to the original byte value. macOS may retain swap after pressure has cleared.

### 5.2 Hard stops

Stop the active dataset immediately if any of these occur:

- `/healthz` is not ready;
- LaunchAgent PID changes or `runs` indicates an unexpected restart;
- system memory free percentage is **<=10%**;
- current TTS physical footprint reaches **>=20 GiB**;
- one synthesis request reaches the existing **110-second experimental watchdog**;
- repeated model/synthesis failures occur for the same bucket;
- the host becomes visibly/operationally unstable;
- OrbStack/9Router loses required host-TTS connectivity;
- available startup-disk capacity becomes low enough that continued swap growth could threaten host stability;
- a large swap increase is accompanied by clear active memory distress rather than occurring alone.

For the last item, treat approximately **>=2 GiB fresh swap growth plus system memory free <=20% or current TTS footprint >=18 GiB** as a hard-stop combination. A >=2 GiB swap rise without those corroborating pressure signals is a pause-and-confirm event, not an automatic failure.

Do not weaken the 110-second request watchdog.

---

## 6. Fresh-run admission baseline

Do not start a measured run merely because free swap exceeds an arbitrary number.

A new run may start when all of the following are true across **three read-only snapshots 30 seconds apart**:

- `/healthz=ready`;
- same expected TTS PID / no restart;
- system memory free >=25%;
- current TTS physical footprint <10 GiB;
- no rising critical-memory trend;
- OrbStack/9Router route ready;
- enough startup-disk free space remains for ordinary macOS operation;
- swap may be high, but is stable or declining and no hard-stop condition exists.

Capture this as the new control manifest. Do not restart TTS solely to improve the baseline.

---

## 7. Statistical contract

For every bucket 25–600:

- fixture A: 10 warmed successful measured requests;
- fixture B: 10 warmed successful measured requests;
- total: n=20 successful samples per bucket;
- warmups, safety probes, aborted requests, and old-run rows are excluded from quantiles.

Use the same deterministic quantile method as the previous Goal (Hyndman-Fan type 7) and publish `n` beside every row.

Required per-bucket owner-facing metrics:

- endpoint total_ms p50 / p95 / max;
- generate_or_model_ms p50 / p95 / max;
- audio_duration_ms p50 / p95 / max;
- RTF p50 / p95 / max;
- success/failure counts;
- A/B family sub-results when materially different.

Keep the fixture content and statistical implementation unchanged for future candidate comparisons.

---

## 8. Fair execution order

Do not execute all 20 samples for one length before moving to the next.

Create a deterministic v2 schedule containing only the 25–600 buckets, preserving the previous corpus and fixed seed philosophy. Prefer deriving it by filtering the previous frozen schedule and preserving the relative order of surviving entries so content/thermal fairness remains comparable.

Record the v2 schedule hash.

Use the same quiet interval between ordinary matrix requests unless changing the interval is required solely for safety confirmation; any such pause must not become part of request latency.

Keep normal HomeLab production services running. Do not stop OrbStack workloads to manufacture a benchmark-only environment.

---

## 9. Pre-test control anchor

Before the matrix:

1. capture the fresh admission baseline;
2. run exactly 3 excluded 50-character A warmups;
3. run 20 measured 50-character A anchor requests;
4. compute endpoint p50 / p95 / max;
5. capture before/after footprint, memory free, swap, PID, health.

If a swap warning occurs but hard-stop conditions are absent, use the revised pause-and-confirm behavior rather than aborting solely because swap is high.

The pre-anchor is separate from the 50-character matrix bucket.

---

## 10. Progressive safety probes

Before the full matrix, run one excluded probe at:

```text
25 → 50 → 100 → 150 → 200 → 250 → 320 → 400 → 500 → 600
```

Apply the revised safety policy.

A probe that hits a hard-stop condition marks that bucket and all higher buckets as `safety-incomplete` for this fresh run. Do not fabricate percentile data.

Do not re-probe 800 under this Goal.

---

## 11. Full production matrix

Run the primary matrix against the actual unchanged production HTTP endpoint:

```text
http://127.0.0.1:18792/v1/audio/speech
```

with the protected Bearer token and MP3 response format.

Record per request at minimum:

- bucket;
- fixture A/B;
- run index;
- HTTP result/error category;
- client endpoint total_ms;
- queue_wait_ms where available;
- generate_or_model_ms;
- wav_serialize_ms;
- encode_ms;
- audio_duration_ms;
- RTF;
- TTS RSS;
- TTS current physical footprint;
- TTS lifetime physical-footprint peak;
- host swap used/free;
- system memory free percentage;
- PID / runs / health.

Never log token values, protected A reference bytes/text, real user content, or private WhatsApp audio.

---

## 12. Representative listening artifact

For every completed bucket 25–600, retain exactly one representative real production result.

Selection rule remains:

1. use only that bucket's 10 warmed successful fixture-A measured rows;
2. calculate fixture-A `total_ms` p50;
3. choose the actual measured row whose `total_ms` is closest to that p50;
4. preserve the exact MP3 returned by that request.

Store outside Git in a protected directory:

```text
listening/<chars>/sample.mp3
listening/<chars>/sample.txt
listening/<chars>/sample.json
```

`sample.json` must include the bucket, fixture id, run index, timing metrics, text hash, audio hash, and control ID.

Do not regenerate a nicer-sounding sample after measurement.

---

## 13. Sequential soak

Run this only after the ordinary matrix completes without a hard stop.

Lengths:

```text
50
150
320
```

For each:

- 30 sequential requests;
- deterministic A/B rotation;
- no service restart between requests;
- record p50/p95/max;
- compare first 10 vs last 10 p50;
- record max current footprint, lifetime peak, swap delta, worst memory-free percentage, restart/failure count.

If 320 became safety-incomplete in the matrix, use the largest complete lower bucket instead and explain why.

Apply the revised swap warning policy. Do not call high swap alone a memory leak.

---

## 14. Bounded-queue contention

Run only after the sequential soak remains healthy.

Lengths:

```text
50
150
320 (or largest safe lower bucket)
```

For each length:

- 10 bursts;
- 3 requests launched as simultaneously as practical;
- keep the existing one-worker / one-pending / 5-second admission policy unchanged;
- record 200 / `503 tts_busy` / unexpected failures and response latency.

Desired property is bounded behavior, not universal success.

No unbounded queue, no worker deadlock, no duplicate synthesis, no 120-second pile-up, and the next ordinary request must recover normally.

---

## 15. Post-stress recovery anchor

After matrix + soak + contention:

1. wait until no request is in flight;
2. confirm expected PID/runs and `/healthz=ready`;
3. capture memory/swap/footprint snapshots;
4. run the exact same 20-sample 50-character A control anchor;
5. compare pre vs post p50/p95/max and host/process metrics.

Do not auto-restart, evict, clear caches, or change backend in response to ordinary drift. Report the drift for owner review.

---

## 16. Evidence and publication

Previous protected raw roots remain untouched.

Create a **new** protected external run root for v2, mode 0700 with evidence files 0600. Do not pool previous raw rows into v2 statistics.

Public outputs:

```text
docs/reports/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_2026_09.md
docs/reports/data/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_2026_09.json
```

The report must include:

- exact immutable production control;
- prior safety evidence summary;
- revised safety-policy explanation;
- fixture hash and v2 schedule hash;
- pre-anchor p50/p95/max;
- complete 25–600 per-length p50/p95/max table;
- model/audio/RTF distributions;
- representative-listening index;
- sequential-soak results;
- contention results;
- pre/post control comparison;
- memory/swap/footprint trends;
- explicit historical 800-codepoint watchdog evidence;
- 1000/1200 not-retested status;
- limitations;
- no final output-length recommendation.

Do not rewrite the previous safety-stopped report to make it look complete.

---

## 17. Implementation discipline

1. Start from latest canonical `main` and read `AGENTS.md`, `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, this Goal, the previous Goal, and the previous benchmark branch/report.
2. Create a new short-lived benchmark branch for v2.
3. Reuse/cherry-pick only the measurement tooling needed from `codex/tts-boundary-stress-2026-09`; do not merge its safety-stopped report blindly into production history.
4. Add focused tests proving the new warning-vs-hard-stop semantics.
5. Verify production service source/config/profile remained unchanged before the first live request.
6. Capture a fresh protected control and fresh run root.
7. Execute phases in order; never resume a hard-stopped dataset.
8. Keep raw evidence and representative MP3/text outside Git.
9. Generate public report/JSON programmatically from protected raw evidence.
10. Run focused tests, `git diff --check`, secrets checks, and repository workflow validation appropriate for test/tooling/docs changes.
11. Do not bump `VERSION` and do not deploy a new TTS runtime.
12. Stop after publishing verified measurement results. Await owner/ChatGPT review before changing any production length policy.

---

## 18. Definition of done

This Goal is complete when:

- production 1.6.2 remained unchanged;
- previous safety-stopped evidence remains preserved;
- revised benchmark safety logic is tested;
- a fresh v2 control baseline exists;
- every safe bucket from 25 through 600 has n=20 successful measured samples;
- each complete bucket has endpoint/model/audio/RTF p50/p95/max;
- each complete bucket has one real representative MP3/text/metadata artifact outside Git;
- soak and contention results exist unless a genuine hard-stop condition prevented them;
- pre/post 50-character anchors exist when the full stress sequence completes;
- 800 is recorded as historical watchdog safety-incomplete and 1000/1200 are not re-stressed;
- aggregate report and JSON are reproducible from protected evidence;
- no final production hard limit or segmentation policy has been selected.

After completion, stop and return the report for owner review.
